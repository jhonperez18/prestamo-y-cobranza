/**
 * Auditoría de la regla de inicio contra Supabase (lo que ve cualquier aparato).
 * Por cobrador con CIE- de ayer: el Inicial M de hoy que calcula el libro de caja
 * con datos de la nube DEBE ser ese `cash_float`. Si no, `verify:prod` falla.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { previousCalendarIso } from "@/lib/collector-day-auto-close";
import { buildDayCashLedger } from "@/lib/day-cash-ledger";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";

export type ChainAuditRow = {
  collectorRef: string;
  collectorName: string;
  yesterday: string;
  yesterdayCieFloat: number;
  todayOpening: number | null;
  /** Informativo: caja viva de M (= Inicial T) y saldo final si se cerrara ahora. */
  todayMClosing: number;
  todayFinal: number;
  ok: boolean;
};

export type ChainAuditResult = {
  ok: boolean;
  businessDate: string;
  rows: ChainAuditRow[];
  error?: string;
};

export async function runServerChainAudit(now = new Date()): Promise<ChainAuditResult> {
  const businessDate = businessTodayIso(now);
  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) return { ok: false, businessDate, rows: [], error: loaded.error };
  const state = loaded.state;
  const yesterday = previousCalendarIso(businessDate);

  const rows: ChainAuditRow[] = [];
  for (const collector of state.collectors) {
    const cie = findFullDayCieClose(state.dayCloses, collector.ref, yesterday);
    if (!cie) continue;
    const ledger = buildDayCashLedger({
      collectorRef: collector.ref,
      collectorName: collector.name,
      date: businessDate,
      payments: state.payments,
      loans: state.loans,
      clients: state.clients,
      collectors: state.collectors,
      assignments: state.assignments,
      dayCloses: state.dayCloses,
      dayExpenseDrafts: state.dayExpenseDrafts,
      planillaCashCloses: state.planillaCashCloses ?? [],
      monthCloses: state.monthCloses ?? [],
    });
    const todayOpening = ledger.mOpening.kind === "chain" ? ledger.mOpening.opening : null;
    const yesterdayCieFloat = Number(cie.cashFloat) || 0;
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: normalizeHistoryDate(cie.date) || cie.date,
      yesterdayCieFloat,
      todayOpening,
      todayMClosing: ledger.mClosing,
      todayFinal: ledger.dayFinal,
      ok: todayOpening === yesterdayCieFloat,
    });
  }

  return { ok: rows.every((row) => row.ok), businessDate, rows };
}
