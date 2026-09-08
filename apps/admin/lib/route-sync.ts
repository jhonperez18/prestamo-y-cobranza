import { activeLoans, loansForClient, type LoanRow, type PaymentRow, type RouteRow, type RouteStop } from "@/lib/mock-data";
import { applyPay, cuotaTarget, validatePay, type ApplyPaySuccess, type PayKind } from "@/lib/loan-pay";
import type { PaymentMethod } from "@/lib/payment-method";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import { validatePaymentEvidence } from "@/lib/payment-evidence";

export function primaryLoanForClient(clientRef: string, loans: LoanRow[]) {
  const active = activeLoans(loansForClient(clientRef, loans));
  return active[0] ?? null;
}

export function amountDueForClient(clientRef: string, loans: LoanRow[]) {
  const loan = primaryLoanForClient(clientRef, loans);
  if (!loan || loan.balance <= 0) return 0;
  // Cuota diaria fija: el excedente solo baja saldo; no adelanta cuotas.
  if (loan.installment && loan.installment > 0) {
    return Math.min(loan.installment, loan.balance);
  }
  const target = cuotaTarget(loan);
  if (target && target.remaining > 0) return Math.min(target.remaining, loan.balance);
  return Math.min(10000, loan.balance);
}

export function buildRouteStop(
  clientRef: string,
  visitOrder: number,
  loans: LoanRow[],
  coords?: { lat?: number; lng?: number },
): RouteStop {
  const loan = primaryLoanForClient(clientRef, loans);
  const amountDue = amountDueForClient(clientRef, loans);
  return {
    clientRef,
    visitOrder,
    loanRef: loan?.ref,
    amountDue,
    visitStatus: amountDue > 0 ? "pendiente" : "cobrado",
    lat: coords?.lat,
    lng: coords?.lng,
  };
}

export function routeTotalDue(stops: RouteStop[]) {
  return stops
    .filter((stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial")
    .reduce((sum, stop) => sum + stop.amountDue, 0);
}

export function routePendingCount(stops: RouteStop[]) {
  return stops.filter((stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial").length;
}

export type CollectorPaymentDraft = {
  idempotencyKey: string;
  routeRef: string;
  clientRef: string;
  loanRef: string;
  /** Día de la visita en planilla (ISO). Obligatorio para cerrar la fila correcta. */
  dispatchDate?: string;
  amount: number;
  kind: PayKind;
  method?: PaymentMethod;
  evidence?: PaymentEvidenceRef[];
  collectorRef: string;
  collectorName: string;
  clientName: string;
};

export function findRouteStop(route: RouteRow, clientRef: string) {
  return route.stops.find((stop) => stop.clientRef === clientRef) ?? null;
}

/**
 * Regla de negocio: un cliente / préstamo = un solo cobro por día (único e irrepetible).
 * Devuelve el pago existente si ya hay registro ese día.
 */
export function findDailyClientPayment(
  payments: PaymentRow[],
  input: {
    loanRef: string;
    clientRef?: string;
    dispatchDate: string;
    loans?: LoanRow[];
  },
): PaymentRow | null {
  const day = input.dispatchDate.trim();
  if (!day || !input.loanRef) return null;
  const loanRefs = new Set<string>([input.loanRef]);
  if (input.clientRef && input.loans?.length) {
    for (const loan of input.loans) {
      if (loan.clientRef === input.clientRef) loanRefs.add(loan.ref);
    }
  }
  return (
    payments.find((row) => {
      if (!row.loanRef || !loanRefs.has(row.loanRef)) return false;
      const paid = (row.paidDate || "").trim();
      return paid === day;
    }) ?? null
  );
}

/** True si la visita del día ya tiene cobro (planilla o pago). */
export function visitAlreadyPaidToday(
  assignments: {
    dispatchDate: string;
    clientRef: string;
    loanRef?: string;
    collectorRef?: string;
    visitStatus?: string;
    paymentRef?: string;
  }[],
  payments: PaymentRow[],
  input: {
    loanRef: string;
    clientRef: string;
    dispatchDate: string;
    collectorRef?: string;
    loans?: LoanRow[];
  },
) {
  const existingPay = findDailyClientPayment(payments, input);
  if (existingPay) return existingPay;
  const visit = assignments.find((row) => {
    if (row.dispatchDate !== input.dispatchDate) return false;
    if (input.collectorRef && row.collectorRef && row.collectorRef !== input.collectorRef) {
      return false;
    }
    const sameClient = row.clientRef === input.clientRef;
    const sameLoan = Boolean(row.loanRef) && row.loanRef === input.loanRef;
    if (!sameClient && !sameLoan) return false;
    return row.visitStatus === "cobrado" || Boolean(row.paymentRef);
  });
  return visit ? ({ ref: visit.paymentRef || "COBRADO" } as PaymentRow) : null;
}

export function validateCollectorPayment(
  draft: CollectorPaymentDraft,
  route: RouteRow | undefined,
  loan: LoanRow | undefined,
  existingKeys: Set<string>,
  payments: PaymentRow[] = [],
) {
  if (existingKeys.has(draft.idempotencyKey)) {
    return { duplicate: true as const, error: null };
  }
  if (!route) return { duplicate: false as const, error: "Ruta no encontrada." };
  const stop = findRouteStop(route, draft.clientRef);
  if (!stop) return { duplicate: false as const, error: "Cliente no está en esta ruta." };
  if (!loan || loan.ref !== draft.loanRef) {
    return { duplicate: false as const, error: "Préstamo no válido para este cliente." };
  }
  if (loan.balance <= 0) {
    return { duplicate: false as const, error: "Este préstamo ya no tiene saldo por cobrar." };
  }
  const day = draft.dispatchDate?.trim() || "";
  if (day) {
    const existing = findDailyClientPayment(payments, {
      loanRef: draft.loanRef,
      clientRef: draft.clientRef,
      dispatchDate: day,
    });
    if (existing) {
      return {
        duplicate: true as const,
        error: `Ya existe el cobro ${existing.ref} de este cliente hoy. Un cliente = un pago = un código.`,
      };
    }
  }
  if (stop.visitStatus === "cobrado" || stop.paymentRef) {
    return {
      duplicate: true as const,
      error: "Esta visita ya tiene cobro hoy. Un cliente = un pago = un código.",
    };
  }
  const payError = validatePay(loan, draft.kind, draft.amount);
  if (payError) return { duplicate: false as const, error: payError };
  const evidenceError = validatePaymentEvidence(draft.method, draft.evidence);
  if (evidenceError) return { duplicate: false as const, error: evidenceError };
  return { duplicate: false as const, error: null, stop };
}

export function nextStopStatus(stop: RouteStop, amount: number) {
  const due = Number(stop.amountDue) || 0;
  if (due <= 0 || amount >= due) return "cobrado" as const;
  if (amount > 0) return "parcial" as const;
  return stop.visitStatus;
}

export function applyPayToRouteStop(stop: RouteStop, amount: number, paymentRef: string) {
  const due = Number(stop.amountDue) || 0;
  const remaining = Math.max(0, due - amount);
  return {
    ...stop,
    amountDue: remaining,
    visitStatus: nextStopStatus({ ...stop, amountDue: due }, amount),
    paymentRef,
  };
}

export type CollectorPaymentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      pay: ApplyPaySuccess;
      updatedStop: RouteStop;
      /** null si no hay ruta de despacho: el cobro igual se aplica al préstamo. */
      updatedRoute: RouteRow | null;
    };

/**
 * Aplica el pago al préstamo. La ruta/parada se actualiza si existe;
 * si falta, no se bloquea el cobro (el dinero no se puede perder).
 */
export function applyCollectorPaymentResult(
  loan: LoanRow,
  draft: CollectorPaymentDraft,
  route: RouteRow | null | undefined,
): CollectorPaymentResult {
  const pay = applyPay(loan, draft.kind, draft.amount);
  if (!pay.ok) return { ok: false, error: pay.error };

  const fallbackStop: RouteStop = {
    clientRef: draft.clientRef,
    visitOrder: 0,
    loanRef: loan.ref,
    amountDue: 0,
    visitStatus: "cobrado",
    paymentRef: draft.idempotencyKey,
  };

  if (!route) {
    return { ok: true, pay, updatedStop: fallbackStop, updatedRoute: null };
  }

  const stop =
    route.stops.find(
      (entry) =>
        entry.clientRef === draft.clientRef &&
        (entry.loanRef === loan.ref || !entry.loanRef || entry.loanRef === draft.loanRef),
    ) ??
    findRouteStop(route, draft.clientRef) ??
    route.stops.find((entry) => entry.loanRef === loan.ref) ??
    null;

  if (!stop) {
    const seed: RouteStop = {
      ...fallbackStop,
      visitOrder: route.stops.length + 1,
      amountDue: draft.amount,
      visitStatus: "pendiente",
    };
    const updatedStop = applyPayToRouteStop(seed, draft.amount, draft.idempotencyKey);
    const updatedStops = [...route.stops, updatedStop];
    const allDone = updatedStops.every(
      (entry) => entry.visitStatus === "cobrado" || entry.visitStatus === "omitido",
    );
    return {
      ok: true,
      pay,
      updatedStop,
      updatedRoute: {
        ...route,
        stops: updatedStops,
        clients: updatedStops.length,
        status: allDone ? "Cerrada" : "En curso",
        kind: allDone ? ("paid" as const) : "pending",
      },
    };
  }

  if (stop.visitStatus === "cobrado" || stop.paymentRef) {
    return {
      ok: false,
      error: "Esta visita ya tiene cobro hoy. Un cliente = un pago = un código.",
    };
  }

  const updatedStop = applyPayToRouteStop(stop, draft.amount, draft.idempotencyKey);
  const updatedStops = route.stops.map((entry) => {
    if (entry === stop) return updatedStop;
    if (entry.clientRef === stop.clientRef && entry.loanRef === stop.loanRef) return updatedStop;
    return entry;
  });
  const allDone = updatedStops.every(
    (entry) => entry.visitStatus === "cobrado" || entry.visitStatus === "omitido",
  );
  return {
    ok: true,
    pay,
    updatedStop,
    updatedRoute: {
      ...route,
      stops: updatedStops,
      status: allDone ? "Cerrada" : "En curso",
      kind: allDone ? ("paid" as const) : "pending",
    },
  };
}

/** Resuelve préstamo y ruta de despacho antes de registrar un cobro móvil. */
export function resolveCollectorPaymentContext(
  draft: CollectorPaymentDraft,
  loans: LoanRow[],
  routes: RouteRow[],
  dispatchDate: string,
) {
  const loan =
    (draft.loanRef
      ? loans.find((row) => row.ref === draft.loanRef && row.clientRef === draft.clientRef)
      : null) ??
    (draft.loanRef ? loans.find((row) => row.ref === draft.loanRef) : null) ??
    primaryLoanForClient(draft.clientRef, loans);

  const route =
    routes.find((row) => row.ref === draft.routeRef) ??
    routes.find((row) => row.ref === `RUT-D-${draft.collectorRef}-${dispatchDate}`) ??
    null;

  return { loan, route };
}
