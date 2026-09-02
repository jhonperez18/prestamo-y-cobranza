import { activeLoans, loansForClient, type LoanRow, type RouteRow, type RouteStop } from "@/lib/mock-data";
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
  const target = cuotaTarget(loan);
  if (target && target.remaining > 0) return target.remaining;
  if (loan.installment && loan.installment > 0) {
    return Math.min(loan.installment, loan.balance);
  }
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

export function validateCollectorPayment(
  draft: CollectorPaymentDraft,
  route: RouteRow | undefined,
  loan: LoanRow | undefined,
  existingKeys: Set<string>,
) {
  if (existingKeys.has(draft.idempotencyKey)) {
    return { duplicate: true as const, error: null };
  }
  if (!route) return { duplicate: false as const, error: "Ruta no encontrada." };
  const stop = findRouteStop(route, draft.clientRef);
  if (!stop) return { duplicate: false as const, error: "Cliente no está en esta ruta." };
  if (stop.visitStatus === "cobrado") {
    return { duplicate: false as const, error: "Esta visita ya fue cobrada." };
  }
  if (!loan || loan.ref !== draft.loanRef) {
    return { duplicate: false as const, error: "Préstamo no válido para este cliente." };
  }
  const payError = validatePay(loan, draft.kind, draft.amount);
  if (payError) return { duplicate: false as const, error: payError };
  const evidenceError = validatePaymentEvidence(draft.method, draft.evidence);
  if (evidenceError) return { duplicate: false as const, error: evidenceError };
  return { duplicate: false as const, error: null, stop };
}

export function nextStopStatus(stop: RouteStop, amount: number) {
  if (amount >= stop.amountDue) return "cobrado" as const;
  if (amount > 0) return "parcial" as const;
  return stop.visitStatus;
}

export function applyPayToRouteStop(stop: RouteStop, amount: number, paymentRef: string) {
  const remaining = Math.max(0, stop.amountDue - amount);
  return {
    ...stop,
    amountDue: remaining,
    visitStatus: nextStopStatus(stop, amount),
    paymentRef,
  };
}

export type CollectorPaymentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      pay: ApplyPaySuccess;
      updatedStop: RouteStop;
      updatedRoute: RouteRow;
    };

export function applyCollectorPaymentResult(
  loan: LoanRow,
  draft: CollectorPaymentDraft,
  route: RouteRow,
): CollectorPaymentResult {
  const pay = applyPay(loan, draft.kind, draft.amount);
  if (!pay.ok) return { ok: false, error: pay.error };
  const stop = findRouteStop(route, draft.clientRef);
  if (!stop) return { ok: false, error: "Visita no encontrada." };
  const updatedStop = applyPayToRouteStop(stop, draft.amount, draft.idempotencyKey);
  const updatedStops = route.stops.map((entry) =>
    entry.clientRef === draft.clientRef ? updatedStop : entry,
  );
  const allDone = updatedStops.every(
    (entry) => entry.visitStatus === "cobrado" || entry.amountDue === 0,
  );
  return {
    ok: true,
    pay,
    updatedStop,
    updatedRoute: {
      ...route,
      stops: updatedStops,
      status: allDone ? "Cerrada" : route.status,
      kind: allDone ? ("paid" as const) : route.kind,
    },
  };
}
