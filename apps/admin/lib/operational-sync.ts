/**
 * Sincronización única del estado operativo con el registro canónico de pagos.
 * Una sola pasada: préstamos (saldo + Alerta/Mora) → cierres CIE → banco Debe/Haber.
 */
import { syncBankLedger } from "@/lib/bank-ledger-sync";
import type { BankAccount, BankMovement } from "@/lib/bank";
import {
  alignDayClosesCollectedToPayments,
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import { syncAllLoans } from "@/lib/loan-preview";
import type { MiscPayment } from "@/lib/misc-payments";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
} from "@/lib/mock-data";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { reconcilePaymentsOntoPlanilla } from "@/lib/planilla-payment-reconcile";

export type OperationalSyncInput = {
  loans: LoanRow[];
  payments: PaymentRow[];
  collectors: CollectorRow[];
  clients?: ClientRow[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts?: CollectorDayExpenseDraft[];
  bankAccounts: BankAccount[];
  bankMovements: BankMovement[];
  miscPayments?: MiscPayment[];
  assignments?: DailyCollectionAssignment[];
  dailyLogs?: CollectorDailyLogRow[];
};

export type OperationalSyncResult = {
  loans: LoanRow[];
  dayCloses: CollectorDayCloseRecord[];
  bankMovements: BankMovement[];
  assignments: DailyCollectionAssignment[];
  dailyLogs: CollectorDailyLogRow[];
};

function alignDailyLogsCollected(
  logs: CollectorDailyLogRow[],
  payments: PaymentRow[],
  collectors: CollectorRow[],
): CollectorDailyLogRow[] {
  if (!logs.length) return logs;
  let changed = false;
  const next = logs.map((row) => {
    const day = normalizeHistoryDate(row.date) || row.date;
    const collectorRef = row.collectorRef;
    let total = 0;
    let count = 0;
    for (const pay of payments) {
      if ((Number(pay.amount) || 0) <= 0) continue;
      if (normalizeHistoryDate(pay.paidDate || "") !== day) continue;
      const sameCollector =
        pay.collectorRef === collectorRef ||
        (!pay.collectorRef &&
          collectors.some(
            (c) => c.ref === collectorRef && c.name === pay.collector,
          ));
      if (!sameCollector) continue;
      total += Number(pay.amount) || 0;
      count += 1;
    }
    if (row.collected === total && (row.paymentsCount ?? count) === count) return row;
    changed = true;
    return {
      ...row,
      collected: total,
      paymentsCount: count,
    };
  });
  return changed ? next : logs;
}

/**
 * Cruza todo con pagos reales:
 * - préstamos: saldo + Alerta 1–3 / Mora
 * - cierres CIE.collected = suma PG- del día
 * - banco Debe = mismos PG-
 * - planilla marca visitas cobradas según paymentRef
 * - logs diarios.collected alineados
 */
export function synchronizeOperationalState(
  input: OperationalSyncInput,
): OperationalSyncResult {
  const payments = input.payments ?? [];
  const collectors = input.collectors ?? [];

  const loans = syncAllLoans(input.loans, payments) as LoanRow[];

  const dayCloses = alignDayClosesCollectedToPayments(
    input.dayCloses,
    payments,
    collectors,
  );

  const bankMovements = syncBankLedger({
    payments,
    movements: input.bankMovements,
    accounts: input.bankAccounts,
    miscPayments: input.miscPayments ?? [],
    dayExpenseDrafts: input.dayExpenseDrafts ?? [],
    dayCloses,
  });

  const assignments = input.assignments?.length
    ? reconcilePaymentsOntoPlanilla(input.assignments, payments)
    : (input.assignments ?? []);

  const dailyLogs = alignDailyLogsCollected(
    input.dailyLogs ?? [],
    payments,
    collectors,
  );

  return {
    loans,
    dayCloses,
    bankMovements,
    assignments,
    dailyLogs,
  };
}
