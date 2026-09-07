/**
 * Retención operativa: historial vivo = últimos 30 días.
 * Cada día cae el más antiguo; maestros (clientes, préstamos, usuarios, rutas) no se tocan.
 */
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { todayIso } from "@/lib/daily-dispatch";
import {
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_PAYMENTS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import type { PaymentRow } from "@/lib/mock-data";
import type { BankMovement } from "@/lib/bank";

/** Días de historial que se conservan (incluye hoy). */
export const DATA_RETENTION_DAYS = 30;

export const DEMO_RETENTION_APPLIED_KEY = "nexo-demo-retention-day";

/** Fecha ISO inclusive más antigua que se conserva. */
export function retentionCutoffIso(today = todayIso(), days = DATA_RETENTION_DAYS) {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - (days - 1));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function keepDate(raw: string | undefined, cutoff: string) {
  const date = normalizeHistoryDate(raw ?? "");
  if (!date) return true; // sin fecha: no borrar a ciegas
  return date >= cutoff;
}

export function applyDataRetention(today = todayIso()) {
  if (typeof window === "undefined") return { cutoff: retentionCutoffIso(today), changed: false };
  const cutoff = retentionCutoffIso(today);
  let changed = false;

  const payments = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const nextPayments = payments.filter((row) => keepDate(row.paidDate, cutoff));
  if (nextPayments.length !== payments.length) {
    writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments);
    changed = true;
  }

  const movements = readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []);
  const nextMovements = movements.filter((row) =>
    keepDate(row.valueDate || row.opDate, cutoff),
  );
  if (nextMovements.length !== movements.length) {
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, nextMovements);
    changed = true;
  }

  const closes = readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []);
  const nextCloses = closes.filter((row) => keepDate(row.date, cutoff));
  if (nextCloses.length !== closes.length) {
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, nextCloses);
    changed = true;
  }

  const expenses = readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []);
  const nextExpenses = expenses.filter((row) => keepDate(row.date, cutoff));
  if (nextExpenses.length !== expenses.length) {
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextExpenses);
    changed = true;
  }

  const logs = readDemoJson<CollectorDailyLogRow[]>(DEMO_DAILY_LOGS_KEY, []);
  const nextLogs = logs.filter((row) => keepDate(row.date, cutoff));
  if (nextLogs.length !== logs.length) {
    writeDemoJson(DEMO_DAILY_LOGS_KEY, nextLogs);
    changed = true;
  }

  const assignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
  const nextAssignments = assignments.filter((row) => {
    const date = normalizeHistoryDate(row.dispatchDate);
    if (!date) return true;
    // Conserva planilla abierta de hoy aunque el filtro falle.
    if (date === today && !row.dayClosedAt) return true;
    return date >= cutoff;
  });
  if (nextAssignments.length !== assignments.length) {
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, nextAssignments);
    changed = true;
  }

  try {
    window.localStorage.setItem(DEMO_RETENTION_APPLIED_KEY, today);
  } catch {
    /* ignore */
  }

  return { cutoff, changed };
}
