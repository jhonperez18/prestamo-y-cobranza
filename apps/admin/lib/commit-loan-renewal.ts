import { LOAN_RENEWED_TODAY_REASON } from "@/lib/collector-dispatch-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { buildRenewalLoans } from "@/lib/loan-renew";
import { loanCommandKey, pendingLoanRef, type LoanCommand } from "@/lib/loan-command";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
  RouteRow,
} from "@/lib/mock-data";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";

export type LoanRenewalState = {
  loans: LoanRow[];
  clients: ClientRow[];
  routes: RouteRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  payments: PaymentRow[];
};

export type LoanRenewalCommit =
  | { ok: false; error: string }
  | {
      ok: true;
      closed: LoanRow;
      created: LoanRow;
      /** Orden para la nube: la base cierra el viejo y da el P- del nuevo. */
      command: LoanCommand;
      client: ClientRow | null;
      loans: LoanRow[];
      clients: ClientRow[];
      assignments: DailyCollectionAssignment[];
      routes: RouteRow[];
    };

/** La visita de hoy del préstamo renovado sale de por cobrar como «Renovado hoy». */
function markRenewedVisitToday(
  assignments: DailyCollectionAssignment[],
  loanRef: string,
  today: string,
): DailyCollectionAssignment[] {
  return assignments.map((row) => {
    if (row.dispatchDate !== today || row.loanRef !== loanRef) return row;
    if (row.dayClosedAt || row.visitStatus !== "pendiente") return row;
    return {
      ...row,
      visitStatus: "omitido" as const,
      skipReason: LOAN_RENEWED_TODAY_REASON,
      amountDue: 0,
      alertCount: 0,
      paymentRef: undefined,
    };
  });
}

/**
 * Renovar (cobrador y panel, un solo camino): sin movimiento de plata.
 * Préstamos + cliente + planilla de hoy. El que llama persiste, encola `command` con
 * `created` y sube. El nuevo lleva número pendiente hasta que la nube le da su P-.
 */
export function commitLoanRenewal(
  state: LoanRenewalState,
  loanRef: string,
  today: string,
): LoanRenewalCommit {
  const loan = state.loans.find((row) => row.ref === loanRef);
  if (!loan) return { ok: false, error: "Préstamo no encontrado." };
  const result = buildRenewalLoans(loan, pendingLoanRef(), today);
  if (!result) {
    return { ok: false, error: "La renovación se activa cuando se cumpla el plazo del préstamo." };
  }
  const loans = [result.created, ...state.loans.map((row) => (row.ref === loanRef ? result.closed : row))];
  const clients = state.clients.map((entry) => {
    if (entry.ref !== loan.clientRef) return entry;
    return {
      ...entry,
      total: entry.total + (result.created.total ?? 0),
      pending: Math.max(0, entry.pending - loan.balance + (result.created.total ?? 0)),
    };
  });
  const planilla = syncPermanentRoutePlanilla(
    today,
    state.routes,
    clients,
    loans,
    state.collectors,
    markRenewedVisitToday(state.assignments, loanRef, today),
    state.payments,
  );
  return {
    ok: true,
    closed: result.closed,
    created: result.created,
    command: { op: "renew", key: loanCommandKey(), oldRef: loanRef },
    client: clients.find((entry) => entry.ref === loan.clientRef) ?? null,
    loans,
    clients,
    assignments: planilla.assignments,
    routes: planilla.routes,
  };
}
