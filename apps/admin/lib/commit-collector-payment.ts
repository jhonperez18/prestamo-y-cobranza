/**
 * Commit atómico de cobro de ruta:
 * pago + visita planilla + ruta + préstamo (+ clientes).
 * Una sola fuente de verdad: el dinero y la planilla no pueden divergir.
 */
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
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
  visitAlreadyPaidToday,
  type CollectorPaymentDraft,
} from "@/lib/route-sync";
import { isCollectorDayClosedForPayments } from "@/lib/collector-day-auto-close";

export type CollectorPaymentCommitInput = {
  draft: CollectorPaymentDraft;
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
  collectors: CollectorRow[];
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
  const { draft, payments, loans, clients, routes, assignments, collectors } = input;

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

  const already = visitAlreadyPaidToday(assignments, payments, {
    loanRef: loan.ref,
    clientRef: draft.clientRef,
    dispatchDate,
    collectorRef: draft.collectorRef,
    loans,
  });
  if (already) {
    return {
      ok: false,
      duplicate: true,
      error:
        already.ref && already.ref !== "COBRADO"
          ? `Ya existe el cobro ${already.ref} de este cliente hoy. Un cliente = un pago = un código.`
          : "Este cliente ya tiene cobro hoy. Un cliente = un pago = un código.",
    };
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

  const result = applyCollectorPaymentResult(loan, safeDraft, route);
  if (!result.ok) return { ok: false, error: result.error };

  const paymentRef = nextPaymentCode(payments);
  const paidTime = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const assignment = assignments.find(
    (row) =>
      row.collectorRef === draft.collectorRef &&
      row.dispatchDate === dispatchDate &&
      (row.loanRef === loan.ref || row.clientRef === draft.clientRef),
  );
  const payTarget = cuotaTarget(loan);
  const payment = buildPaymentRow(
    {
      ref: paymentRef,
      loanRef: loan.ref,
      when: `${isoToDispatchLabel(dispatchDate)} · ${paidTime}`,
      paidDate: dispatchDate,
      paidTime,
      dueDate: assignment?.chargeDate ?? payTarget?.date,
      chargeLabel:
        assignment?.chargeLabel ?? (payTarget?.kind ? chargeLabel(payTarget.kind) : undefined),
      client: draft.clientName,
      collector: draft.collectorName,
      collectorRef: draft.collectorRef,
      routeRef: safeDraft.routeRef,
      idempotencyKey: draft.idempotencyKey,
      amount: draft.amount,
      type: result.pay.type,
      kind: paymentRowKind(result.pay),
      method: normalizePaymentMethod(draft.method),
      evidence: draft.evidence?.length ? draft.evidence : undefined,
      source: "pwa",
      gps: true,
    },
    loan,
    result.pay,
  );

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
