/**
 * Rollover de jornada en servidor (fuente de verdad 24/7).
 * No depende de que haya un celular o este PC abierto a las 23:30 Bogotá.
 */
import {
  runOperationalDayCycle,
  type OperationalDayState,
} from "@/lib/collector-day-auto-close";
import { businessTodayIso } from "@/lib/business-timezone";
import {
  dayCloseAsPlanillaCashClose,
  isPlanillaCashCloseRef,
  planillaCashCloseAsDayClose,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import { fetchClientsFromSupabase, fetchLoansFromSupabase, mirrorToClientRow, mirrorToLoanRow } from "@/lib/supabase/catalog-mirror";
import { fetchPaymentsFromSupabase, mirrorRowToPaymentRow } from "@/lib/supabase/payment-mirror";
import {
  assignmentToRow,
  dayCloseToRow,
  fetchOpsTable,
  rowToAssignment,
  rowToCollector,
  rowToDayClose,
  rowToDayExpense,
  rowToRoute,
  upsertAssignmentRow,
  upsertDayCloseIdempotent,
} from "@/lib/supabase/ops-mirror";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import type { CollectorMonthCloseRecord } from "@/lib/collector-day-close";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

export type ServerDayRolloverResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  businessDate?: string;
  autoClosed?: Array<{ collectorRef: string; date: string }>;
  sealedAssignments?: number;
  upsertedCloses?: number;
  errors?: string[];
};

async function loadOperationalStateFromCloud(): Promise<
  | { ok: true; state: OperationalDayState }
  | { ok: false; error: string }
> {
  const [collectorsT, routesT, closesT, expensesT, assignsT, paymentsT, clientsT, loansT] =
    await Promise.all([
      fetchOpsTable("collectors"),
      fetchOpsTable("routes"),
      fetchOpsTable("day_closes"),
      fetchOpsTable("day_expenses"),
      fetchOpsTable("daily_assignments"),
      fetchPaymentsFromSupabase({ evidence: false }),
      fetchClientsFromSupabase(),
      fetchLoansFromSupabase(),
    ]);

  for (const part of [collectorsT, routesT, closesT, expensesT, assignsT]) {
    if (!part.ok) {
      return { ok: false, error: "error" in part ? String(part.error) : "ops_fetch_failed" };
    }
  }
  if (!paymentsT.ok) {
    return { ok: false, error: paymentsT.error || "payments_fetch_failed" };
  }
  if (!clientsT.ok) {
    return { ok: false, error: clientsT.error || "clients_fetch_failed" };
  }
  if (!loansT.ok) {
    return { ok: false, error: loansT.error || "loans_fetch_failed" };
  }

  const collectors = (collectorsT.rows ?? [])
    .map(rowToCollector)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const routes = (routesT.rows ?? [])
    .map(rowToRoute)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const dayClosesAll = (closesT.rows ?? [])
    .map(rowToDayClose)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const dayCloses = dayClosesAll.filter((row) => !isPlanillaCashCloseRef(row.ref));
  const planillaCashCloses: PlanillaCashCloseRecord[] = [];
  for (const row of dayClosesAll) {
    const link = dayCloseAsPlanillaCashClose(row);
    if (link) planillaCashCloses.push(link);
  }
  const dayExpenseDrafts = (expensesT.rows ?? [])
    .map(rowToDayExpense)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const assignments = (assignsT.rows ?? [])
    .map(rowToAssignment)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const payments: PaymentRow[] = (paymentsT.rows ?? [])
    .map(mirrorRowToPaymentRow)
    .filter((row): row is PaymentRow => Boolean(row));
  const clients: ClientRow[] = (clientsT.rows ?? [])
    .map(mirrorToClientRow)
    .filter((row): row is ClientRow => Boolean(row));
  const loans: LoanRow[] = (loansT.rows ?? [])
    .map(mirrorToLoanRow)
    .filter((row): row is LoanRow => Boolean(row));

  const state: OperationalDayState = {
    assignments,
    routes,
    logs: [] as CollectorDailyLogRow[],
    dayCloses,
    dayExpenseDrafts,
    payments,
    loans,
    clients,
    collectors,
    planillaCashCloses,
    monthCloses: [] as CollectorMonthCloseRecord[],
  };
  return { ok: true, state };
}

export async function runServerDayRollover(
  now = new Date(),
): Promise<ServerDayRolloverResult> {
  const businessDate = businessTodayIso(now);
  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) {
    return { ok: false, reason: loaded.error, businessDate };
  }

  const result = runOperationalDayCycle(loaded.state, now);
  if (result.autoClosed.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "nothing_to_close",
      businessDate,
      autoClosed: [],
      sealedAssignments: 0,
      upsertedCloses: 0,
    };
  }

  const errors: string[] = [];
  let upsertedCloses = 0;
  let sealedAssignments = 0;

  const closeRefs = new Set(result.autoClosed.map((p) => `${p.collectorRef}::${p.date}`));

  for (const row of result.dayCloses) {
    const key = `${row.collectorRef}::${normalizeDate(row.date)}`;
    if (!closeRefs.has(key) && !result.autoClosed.some((p) => p.collectorRef === row.collectorRef)) {
      continue;
    }
    if (isPlanillaCashCloseRef(row.ref)) continue;
    const mapped = dayCloseToRow(row);
    const up = await upsertDayCloseIdempotent(mapped);
    if (!up.ok) errors.push(`CIE ${row.ref}: ${"error" in up ? up.error : "fail"}`);
    else if (!("skipped" in up && up.skipped)) upsertedCloses += 1;
  }

  for (const row of result.planillaCashCloses ?? []) {
    const key = `${row.collectorRef}::${normalizeDate(row.date)}`;
    if (!closeRefs.has(key)) continue;
    const mapped = dayCloseToRow(planillaCashCloseAsDayClose(row));
    const up = await upsertDayCloseIdempotent(mapped);
    if (!up.ok) {
      const msg = "error" in up ? String(up.error) : "fail";
      // Esquema viejo sin PCE-: no tumbar el rollover; CIE + planilla ya sellan.
      if (/day_closes_ref_format|PCE-/i.test(msg)) continue;
      errors.push(`PCE ${row.ref}: ${msg}`);
    } else if (!("skipped" in up && up.skipped)) upsertedCloses += 1;
  }

  for (const row of result.assignments) {
    if (!row.dayClosedAt) continue;
    const key = `${row.collectorRef}::${normalizeDate(row.dispatchDate)}`;
    if (!closeRefs.has(key)) continue;
    const up = await upsertAssignmentRow(assignmentToRow(row));
    if (!up.ok) errors.push(`assign ${row.itemId}: ${"error" in up ? up.error : "fail"}`);
    else if (!("skipped" in up && up.skipped) && !("kept" in up && up.kept)) {
      sealedAssignments += 1;
    } else {
      sealedAssignments += 1;
    }
  }

  return {
    ok: errors.length === 0,
    businessDate,
    autoClosed: result.autoClosed,
    sealedAssignments,
    upsertedCloses,
    errors: errors.length ? errors : undefined,
    reason: errors.length ? "partial_errors" : undefined,
  };
}

function normalizeDate(raw: string) {
  const t = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return t;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${dd}`;
}
