/**
 * Día del supervisor, leído de la base. Solo lectura.
 * No sella, no escribe y no toca `cash_float`.
 * El Inicial lo sigue armando `openingCashForChainedPlanilla` con estos CIE
 * (Inicial de M = CIE de ayer). No baja el libro entero de cobros.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import type { CollectorDayCloseRecord, CollectorDayExpenseDraft } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { PaymentRow } from "@/lib/mock-data";
import { fetchPaymentsFromSupabase, mirrorRowToPaymentRow } from "@/lib/supabase/payment-mirror";
import {
  fetchOpsTable,
  fetchOpsTableSince,
  rowToAssignment,
  rowToDayClose,
  rowToDayExpense,
} from "@/lib/supabase/ops-mirror";

export type SupervisorTodayPayload = {
  date: string;
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  expenses: CollectorDayExpenseDraft[];
};

export async function loadSupervisorToday(
  date = businessTodayIso(),
): Promise<{ ok: true; payload: SupervisorTodayPayload } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "bad_date" };
  const [paymentsT, assignsT, closesT, expensesT] = await Promise.all([
    fetchPaymentsFromSupabase({ fromDate: date, toDate: date }),
    fetchOpsTableSince("daily_assignments", "dispatch_date", date, date),
    fetchOpsTable("day_closes"),
    fetchOpsTableSince("day_expenses", "expense_date", date, date),
  ]);
  if (!paymentsT.ok || ("skipped" in paymentsT && paymentsT.skipped)) {
    return { ok: false, error: "error" in paymentsT ? paymentsT.error : "payments_failed" };
  }
  if (!assignsT.ok || ("skipped" in assignsT && assignsT.skipped)) {
    return { ok: false, error: "error" in assignsT ? assignsT.error : "assignments_failed" };
  }
  if (!closesT.ok || ("skipped" in closesT && closesT.skipped)) {
    return { ok: false, error: "error" in closesT ? closesT.error : "closes_failed" };
  }
  if (!expensesT.ok || ("skipped" in expensesT && expensesT.skipped)) {
    return { ok: false, error: "error" in expensesT ? expensesT.error : "expenses_failed" };
  }

  return {
    ok: true,
    payload: {
      date,
      payments: paymentsT.rows
        .map(mirrorRowToPaymentRow)
        .filter((row): row is PaymentRow => Boolean(row)),
      assignments: assignsT.rows
        .map(rowToAssignment)
        .filter((row): row is DailyCollectionAssignment => Boolean(row)),
      dayCloses: closesT.rows
        .map(rowToDayClose)
        .filter((row): row is CollectorDayCloseRecord => Boolean(row)),
      expenses: expensesT.rows
        .map(rowToDayExpense)
        .filter((row): row is CollectorDayExpenseDraft => Boolean(row)),
    },
  };
}
