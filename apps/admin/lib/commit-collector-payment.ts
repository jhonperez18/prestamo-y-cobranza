/**
 * Commit atómico de cobro de ruta:
 * pago + visita planilla + ruta + préstamo (+ clientes).
 * Una sola fuente de verdad: el dinero y la planilla no pueden divergir.
 */
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
import { pesos } from "@/lib/finance";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  applyPaymentToAssignments,
  buildDispatchRoute,
  dispatchRouteRef,
  upsertDispatchRoute,
} from "@/lib/collector-dispatch-sync";
import { chargeLabel, syncLoan } from "@/lib/loan-preview";
import { cuotaTarget, loanRowAfterPay, paymentRowKind } from "@/lib/loan-pay";
import { buildPaymentRow } from "@/lib/payment-detail";
import { validatePaymentEvidence } from "@/lib/payment-evidence";
import { rememberPaymentEvidence } from "@/lib/payment-evidence-store";
import { normalizePaymentMethod } from "@/lib/payment-method";
import {
  nextPaymentCode,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import { reconcilePaymentsOntoPlanilla } from "@/lib/planilla-payment-reconcile";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import {
  applyCollectorPaymentResult,
  resolveCollectorPaymentContext,
  type CollectorPaymentDraft,
} from "@/lib/route-sync";
import { isCollectorDayClosedForPayments } from "@/lib/collector-day-auto-close";
import {
  encodeComboChargeLabel,
} from "@/lib/payment-combo";

export type CollectorPaymentCommitInput = {
  draft: CollectorPaymentDraft;
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
  collectors: CollectorRow[];
  /**
   * Segundo tramo de un cobro combinado: permite otro PG- el mismo día
   * solo si ya existe un vivo con el mismo comboGroupId.
   */
  allowComboSibling?: boolean;
};

export type CollectorPaymentCommitResult =
  | { ok: false; error: string; duplicate?: boolean }
  | {
      ok: true;
      payment: PaymentRow;
      payments: PaymentRow[];
      loans: LoanRow[];
      clients: ClientRow[];
      routes: RouteRow[];
      assignments: DailyCollectionAssignment[];
    };

export type CollectorCombinedPaymentCommitResult =
  | { ok: false; error: string; duplicate?: boolean }
  | {
      ok: true;
      payment: PaymentRow;
      paymentsCreated: [PaymentRow, PaymentRow];
      payments: PaymentRow[];
      loans: LoanRow[];
      clients: ClientRow[];
      routes: RouteRow[];
      assignments: DailyCollectionAssignment[];
    };

export function paymentsFromCollectorCommit(
  committed: Extract<
    CollectorPaymentCommitResult | CollectorCombinedPaymentCommitResult,
    { ok: true }
  >,
): PaymentRow[] {
  if ("paymentsCreated" in committed) {
    return [committed.paymentsCreated[0], committed.paymentsCreated[1]];
  }
  return [committed.payment];
}

export {
  reconcilePaymentsOntoPlanilla,
  dedupeDailyPaymentsByVisit,
} from "@/lib/planilla-payment-reconcile";

function stampRouteStopPaid(
  routes: RouteRow[],
  input: {
    collectorRef: string;
    dispatchDate: string;
    clientRef: string;
    loanRef: string;
    paymentRef: string;
  },
): RouteRow[] {
  const ref = dispatchRouteRef(input.collectorRef, input.dispatchDate);
  return routes.map((route) => {
    if (route.ref !== ref) return route;
    const stops = route.stops.map((stop) => {
      const sameClient = stop.clientRef === input.clientRef;
      const sameLoan = !stop.loanRef || stop.loanRef === input.loanRef;
      if (!sameClient || !sameLoan) return stop;
      return {
        ...stop,
        loanRef: stop.loanRef || input.loanRef,
        amountDue: 0,
        visitStatus: "cobrado" as const,
        paymentRef: input.paymentRef,
      };
    });
    const pending = stops.filter(
      (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
    ).length;
    return {
      ...route,
      stops,
      status: pending === 0 && stops.length > 0 ? "Cerrada" : route.status,
      kind: pending === 0 && stops.length > 0 ? ("paid" as const) : route.kind,
    };
  });
}

/**
 * Commit único de cobro. Ambos shells (admin preview y app cobrador) deben usarlo.
 */
export function commitCollectorPayment(
  input: CollectorPaymentCommitInput,
): CollectorPaymentCommitResult {
  const {
    draft,
    payments,
    loans,
    clients,
    routes,
    assignments,
    collectors,
  } = input;

  const keys = new Set(payments.map((row) => row.idempotencyKey).filter(Boolean) as string[]);
  if (draft.idempotencyKey && keys.has(draft.idempotencyKey)) {
    return { ok: false, duplicate: true, error: "Pago ya sincronizado (sin duplicar)." };
  }

  const evidenceError = validatePaymentEvidence(draft.method, draft.evidence);
  if (evidenceError) return { ok: false, error: evidenceError };

  const dispatchDate = draft.dispatchDate?.trim() || todayIso();
  const resolved = resolveCollectorPaymentContext(draft, loans, routes, dispatchDate);
  const loan = resolved.loan ? (syncLoan(resolved.loan, payments) as LoanRow) : null;
  const route = resolved.route;
  if (!loan || loan.balance <= 0) {
    return { ok: false, error: "No hay préstamo activo para este cliente. No se registró el cobro." };
  }

  if (isCollectorDayClosedForPayments(dispatchDate)) {
    return {
      ok: false,
      error: "La jornada de ese día ya cerró a las 23:30. No se registran más cobros.",
    };
  }

  const safeDraft: CollectorPaymentDraft = {
    ...draft,
    loanRef: loan.ref,
    routeRef: route?.ref ?? draft.routeRef,
    dispatchDate,
  };

  const result = applyCollectorPaymentResult(loan, safeDraft, route, payments);
  if (!result.ok) return { ok: false, error: result.error };

  const paymentRef = nextPaymentCode(payments);
  const paidTime =
    draft.paidTime?.trim() ||
    new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const assignment = assignments.find(
    (row) =>
      row.collectorRef === draft.collectorRef &&
      row.dispatchDate === dispatchDate &&
      (row.loanRef === loan.ref || row.clientRef === draft.clientRef),
  );
  const payTarget = cuotaTarget(loan);
  const baseChargeLabel =
    assignment?.chargeLabel ?? (payTarget?.kind ? chargeLabel(payTarget.kind) : undefined);
  const comboGroupId = draft.comboGroupId?.trim() || undefined;
  const payment = buildPaymentRow(
    {
      ref: paymentRef,
      loanRef: loan.ref,
      when: `${isoToDispatchLabel(dispatchDate)} · ${paidTime}`,
      paidDate: dispatchDate,
      paidTime,
      dueDate: assignment?.chargeDate ?? payTarget?.date,
      chargeLabel: comboGroupId
        ? encodeComboChargeLabel(baseChargeLabel, comboGroupId)
        : baseChargeLabel,
      client: draft.clientName,
      collector: draft.collectorName,
      collectorRef: draft.collectorRef,
      routeRef: safeDraft.routeRef,
      idempotencyKey: draft.idempotencyKey,
      amount: pesos(draft.amount),
      type: result.pay.type,
      kind: paymentRowKind(result.pay),
      method: normalizePaymentMethod(draft.method),
      evidence: draft.evidence?.length ? draft.evidence : undefined,
      source: "pwa",
      gps: true,
      comboGroupId,
    },
    loan,
    result.pay,
  );

  if (payment.evidence?.length) {
    rememberPaymentEvidence(payment.ref, payment.evidence);
  }

  const nextPayments = [payment, ...payments];
  const nextLoans = loans.map((row) =>
    row.ref === loan.ref ? loanRowAfterPay(row, result.pay, nextPayments) : row,
  );
  const nextClients = clients.map((entry) => {
    if (entry.ref !== draft.clientRef) return entry;
    return { ...entry, pending: Math.max(0, entry.pending - draft.amount) };
  });

  let nextAssignments = applyPaymentToAssignments(
    assignments,
    payment,
    dispatchDate,
    draft.clientRef,
  );
  nextAssignments = reconcilePaymentsOntoPlanilla(nextAssignments, [payment]);

  let nextRoutes = result.updatedRoute
    ? routes.map((row) => (row.ref === result.updatedRoute!.ref ? result.updatedRoute! : row))
    : routes;
  nextRoutes = stampRouteStopPaid(nextRoutes, {
    collectorRef: draft.collectorRef,
    dispatchDate,
    clientRef: draft.clientRef,
    loanRef: loan.ref,
    paymentRef: payment.ref,
  });

  const planilla = syncPermanentRoutePlanilla(
    dispatchDate,
    nextRoutes,
    nextClients,
    nextLoans,
    collectors,
    nextAssignments,
    nextPayments,
  );
  nextAssignments = reconcilePaymentsOntoPlanilla(planilla.assignments, nextPayments);

  const collector = collectors.find((row) => row.ref === draft.collectorRef);
  if (collector) {
    const existing = planilla.routes.find(
      (row) => row.ref === dispatchRouteRef(draft.collectorRef, dispatchDate),
    );
    const rebuilt = buildDispatchRoute(
      draft.collectorRef,
      collector.name,
      dispatchDate,
      nextAssignments,
      nextLoans,
      nextClients,
      existing,
    );
    nextRoutes = upsertDispatchRoute(planilla.routes, rebuilt);
  } else {
    nextRoutes = planilla.routes;
  }
  nextRoutes = stampRouteStopPaid(nextRoutes, {
    collectorRef: draft.collectorRef,
    dispatchDate,
    clientRef: draft.clientRef,
    loanRef: loan.ref,
    paymentRef: payment.ref,
  });

  return {
    ok: true,
    payment,
    payments: nextPayments,
    loans: nextLoans,
    clients: nextClients,
    routes: nextRoutes,
    assignments: nextAssignments,
  };
}

/**
 * Cobro combinado atómico: dos PG- misma fecha/hora, métodos distintos.
 * El mismo día admite más abonos, con o sin este vínculo.
 */
export function commitCollectorCombinedPayment(input: {
  parts: [CollectorPaymentDraft, CollectorPaymentDraft];
  comboGroupId: string;
  paidTime: string;
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
  collectors: CollectorRow[];
}): CollectorCombinedPaymentCommitResult {
  const [a, b] = input.parts;
  const methodA = normalizePaymentMethod(a.method);
  const methodB = normalizePaymentMethod(b.method);
  if (methodA === methodB) {
    return { ok: false, error: "Combinado requiere dos métodos distintos." };
  }
  if (!(a.amount > 0) || !(b.amount > 0)) {
    return { ok: false, error: "Cada tramo del combinado debe tener valor." };
  }
  const comboGroupId = input.comboGroupId.trim();
  if (!comboGroupId) {
    return { ok: false, error: "Falta el vínculo del cobro combinado." };
  }
  const paidTime = input.paidTime.trim();
  if (!paidTime) {
    return { ok: false, error: "Falta la hora compartida del cobro combinado." };
  }

  const first = commitCollectorPayment({
    draft: {
      ...a,
      method: methodA,
      comboGroupId,
      paidTime,
    },
    payments: input.payments,
    loans: input.loans,
    clients: input.clients,
    routes: input.routes,
    assignments: input.assignments,
    collectors: input.collectors,
  });
  if (!first.ok) return first;

  const second = commitCollectorPayment({
    draft: {
      ...b,
      method: methodB,
      comboGroupId,
      paidTime,
      // Tras el 1.er tramo el saldo/cuota ya bajó: el 2.º es abono del resto.
      kind: "abono",
    },
    payments: first.payments,
    loans: first.loans,
    clients: first.clients,
    routes: first.routes,
    assignments: first.assignments,
    collectors: input.collectors,
    allowComboSibling: true,
  });
  if (!second.ok) {
    return {
      ok: false,
      error: `Primer tramo ok, segundo falló: ${second.error}. Revisá el cobro ${first.payment.ref}.`,
    };
  }

  return {
    ok: true,
    payment: first.payment,
    paymentsCreated: [first.payment, second.payment],
    payments: second.payments,
    loans: second.loans,
    clients: second.clients,
    routes: second.routes,
    assignments: second.assignments,
  };
}
