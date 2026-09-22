/**
 * Un cambio de clientes, préstamos o cobros que llega por el canal en vivo.
 * El ref borrado no entra. El registro local más nuevo no se rebobina.
 * Después se recalculan nombres, saldos, planilla y caja.
 */
import type { BankAccount, BankMovement } from "@/lib/bank";
import type { CollectorDayCloseRecord, CollectorDayExpenseDraft } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isDeletedRef, rememberDeletedId } from "@/lib/deleted-ids";
import { mergeFresherByRef } from "@/lib/fresher-row";
import type { MiscPayment } from "@/lib/misc-payments";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
  RouteRow,
  UserRow,
} from "@/lib/mock-data";
import { synchronizeOperationalState } from "@/lib/operational-sync";
import { refreshLabelsFromCatalog } from "@/lib/project-identity";
import { mirrorToClientRow, mirrorToLoanRow, type ClientMirrorRow, type LoanMirrorRow } from "@/lib/supabase/catalog-mirror";
import { mirrorRowToPaymentRow, type PaymentMirrorRow } from "@/lib/supabase/payment-mirror";

export const REALTIME_WORKSPACE_TABLES = ["clients", "loans", "payments"] as const;
export type RealtimeWorkspaceTable = (typeof REALTIME_WORKSPACE_TABLES)[number];

export type WorkspaceLiveSlice = {
  clients: ClientRow[];
  users: UserRow[];
  collectors: CollectorRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  bankAccounts: BankAccount[];
  bankMovements: BankMovement[];
  miscPayments: MiscPayment[];
};

function mapIncoming(
  table: RealtimeWorkspaceTable,
  record: Record<string, unknown> | null,
): ClientRow | LoanRow | PaymentRow | null {
  if (!record || !String(record.ref || "").trim()) return null;
  if (table === "clients") return mirrorToClientRow(record as ClientMirrorRow);
  if (table === "loans") return mirrorToLoanRow(record as LoanMirrorRow);
  const payment = mirrorRowToPaymentRow(record as PaymentMirrorRow);
  if (!payment) return null;
  const updatedAt = String(record.updated_at || "").trim();
  return updatedAt ? { ...payment, updatedAt } : payment;
}

function cascade(state: WorkspaceLiveSlice): WorkspaceLiveSlice {
  const projected = synchronizeOperationalState({
    loans: state.loans,
    payments: state.payments,
    collectors: state.collectors,
    clients: state.clients,
    dayCloses: state.dayCloses,
    dayExpenseDrafts: state.dayExpenseDrafts,
    bankAccounts: state.bankAccounts,
    bankMovements: state.bankMovements,
    miscPayments: state.miscPayments,
    assignments: state.assignments,
  });
  const labeled = refreshLabelsFromCatalog({
    clients: state.clients,
    users: state.users,
    collectors: state.collectors,
    loans: projected.loans,
    payments: state.payments,
    routes: state.routes,
    assignments: projected.assignments,
  });
  return {
    ...state,
    loans: labeled.loans,
    payments: labeled.payments,
    routes: labeled.routes,
    assignments: labeled.assignments,
    dayCloses: projected.dayCloses,
    bankMovements: projected.bankMovements,
  };
}

export function applyWorkspaceRealtimeEvent(
  table: RealtimeWorkspaceTable,
  eventType: "INSERT" | "UPDATE" | "DELETE",
  record: Record<string, unknown> | null,
  state: WorkspaceLiveSlice,
): WorkspaceLiveSlice | null {
  const ref = String(record?.ref || "").trim();
  if (!ref) return null;

  if (eventType === "DELETE") {
    rememberDeletedId(ref);
    const next = cascade({
      ...state,
      clients: table === "clients" ? state.clients.filter((row) => row.ref !== ref) : state.clients,
      loans: table === "loans" ? state.loans.filter((row) => row.ref !== ref) : state.loans,
      payments: table === "payments" ? state.payments.filter((row) => row.ref !== ref) : state.payments,
    });
    return next;
  }

  if (isDeletedRef(ref)) return null;
  const incoming = mapIncoming(table, record);
  if (!incoming) return null;

  if (table === "clients") {
    return cascade({ ...state, clients: mergeFresherByRef(state.clients, [incoming as ClientRow]) });
  }
  if (table === "loans") {
    return cascade({ ...state, loans: mergeFresherByRef(state.loans, [incoming as LoanRow]) });
  }
  return cascade({ ...state, payments: mergeFresherByRef(state.payments, [incoming as PaymentRow]) });
}
