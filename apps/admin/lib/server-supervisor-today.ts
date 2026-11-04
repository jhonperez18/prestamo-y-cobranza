/**
 * Día del supervisor, leído de la base. Solo lectura.
 * No sella, no escribe y no toca `cash_float`.
 * El Inicial lo sigue armando `openingCashForChainedPlanilla` con estos CIE
 * (Inicial de M = CIE de ayer). No baja el libro entero de cobros.
 */
import { businessDaysAgoIso, businessTodayIso } from "@/lib/business-timezone";
import type { CollectorDayCloseRecord, CollectorDayExpenseDraft } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { PaymentRow } from "@/lib/mock-data";
import { fetchPaymentsFromSupabase, mirrorRowToPaymentRow } from "@/lib/supabase/payment-mirror";
import {
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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((v) => v).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function loadSupervisorToday(
  date = businessTodayIso(),
): Promise<{ ok: true; payload: SupervisorTodayPayload } | { ok: false; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "bad_date" };
  // CIE: últimos 14 días. Inicial M puede anclarse a un CIE anterior a “ayer”
  // si hubo días sin sellar (caso nov-2026: último CIE 31/10).
  const closesFrom = businessDaysAgoIso(14, new Date(`${date}T12:00:00-05:00`));
  // Cada pieza con tope propio: una tabla lenta no deja al jefe sin gastos/préstamos.
  const pieceMs = 10_000;
  const [paymentsT, assignsT, closesT, expensesT] = await Promise.all([
    withTimeout(fetchPaymentsFromSupabase({ fromDate: date, toDate: date }), pieceMs),
    withTimeout(fetchOpsTableSince("daily_assignments", "dispatch_date", date, date), pieceMs),
    withTimeout(fetchOpsTableSince("day_closes", "close_date", closesFrom, date), pieceMs),
    withTimeout(fetchOpsTableSince("day_expenses", "expense_date", date, date), pieceMs),
  ]);

  const paymentsOk = Boolean(paymentsT && paymentsT.ok && !("skipped" in paymentsT && paymentsT.skipped));
  const assignsOk = Boolean(assignsT && assignsT.ok && !("skipped" in assignsT && assignsT.skipped));
  const closesOk = Boolean(closesT && closesT.ok && !("skipped" in closesT && closesT.skipped));
  const expensesOk = Boolean(
    expensesT && expensesT.ok && !("skipped" in expensesT && expensesT.skipped),
  );

  // Al menos una pieza útil → OK (el celular mezcla con su copia). Todo falló → error.
  if (!paymentsOk && !assignsOk && !closesOk && !expensesOk) {
    return { ok: false, error: "supervisor_today_all_failed" };
  }

  return {
    ok: true,
    payload: {
      date,
      payments: paymentsOk
        ? paymentsT!.rows
            .map(mirrorRowToPaymentRow)
            .filter((row): row is PaymentRow => Boolean(row))
        : [],
      assignments: assignsOk
        ? assignsT!.rows
            .map(rowToAssignment)
            .filter((row): row is DailyCollectionAssignment => Boolean(row))
        : [],
      dayCloses: closesOk
        ? closesT!.rows
            .map(rowToDayClose)
            .filter((row): row is CollectorDayCloseRecord => Boolean(row))
        : [],
      expenses: expensesOk
        ? expensesT!.rows
            .map(rowToDayExpense)
            .filter((row): row is CollectorDayExpenseDraft => Boolean(row))
        : [],
    },
  };
}
