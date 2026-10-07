/**
 * Auditoría de la regla de inicio contra Supabase (lo que ve cualquier aparato).
 * Cadena M↔T: Inicial M de hoy = `cash_float` del CIE- de ayer.
 * N (Yesid): Inicial de hoy = caja del historial de ayer (no el neto del CIE-).
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { previousCalendarIso, type OperationalDayState } from "@/lib/collector-day-auto-close";
import { buildDayCashLedger, isChainCollectorDay, type DayCashSources } from "@/lib/day-cash-ledger";
import {
  independentRouteDay,
  independentRouteForCollectorDay,
} from "@/lib/independent-route-cash";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import type { CollectorRow } from "@/lib/mock-data";

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
  kind: "chain" | "independent";
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
  return auditChainFromState(loaded.state, businessDate);
}

/** Misma auditoría sobre un estado ya bajado de la nube (revisión de la mañana). */
export function auditChainFromState(
  state: OperationalDayState,
  businessDate: string,
): ChainAuditResult {
  const yesterday = previousCalendarIso(businessDate);

  const rows: ChainAuditRow[] = [];
  for (const collector of state.collectors) {
    const cie = findFullDayCieClose(state.dayCloses, collector.ref, yesterday);
    if (!cie) continue;
    const todaySrc = sourcesOf(state, collector, businessDate);
    const yesterdaySrc = sourcesOf(state, collector, yesterday);
    const yesterdayLabel = normalizeHistoryDate(cie.date) || cie.date;
    if (isChainCollectorDay(todaySrc) || isChainCollectorDay(yesterdaySrc)) {
      const ledger = buildDayCashLedger(todaySrc);
      const todayOpening = ledger.mOpening.kind === "chain" ? ledger.mOpening.opening : null;
      const yesterdayCieFloat = Number(cie.cashFloat) || 0;
      rows.push({
        collectorRef: collector.ref,
        collectorName: collector.name,
        yesterday: yesterdayLabel,
        yesterdayCieFloat,
        todayOpening,
        todayMClosing: ledger.mClosing,
        todayFinal: ledger.dayFinal,
        ok: todayOpening === yesterdayCieFloat,
        kind: "chain",
      });
      continue;
    }
    const route =
      independentRouteForCollectorDay(yesterdaySrc) ??
      independentRouteForCollectorDay(todaySrc);
    if (!route) continue;
    const yDay = independentRouteDay(yesterdaySrc, route);
    const tDay = independentRouteDay(todaySrc, route);
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: yesterdayLabel,
      yesterdayCieFloat: yDay.closing,
      todayOpening: tDay.opening,
      todayMClosing: tDay.closing,
      todayFinal: tDay.closing,
      ok: tDay.opening === yDay.closing,
      kind: "independent",
    });
  }

  return { ok: rows.every((row) => row.ok), businessDate, rows };
}

function sourcesOf(
  state: OperationalDayState,
  collector: CollectorRow,
  date: string,
): DayCashSources {
  return {
    collectorRef: collector.ref,
    collectorName: collector.name,
    date,
    payments: state.payments,
    loans: state.loans,
    clients: state.clients,
    collectors: state.collectors,
    assignments: state.assignments,
    dayCloses: state.dayCloses,
    dayExpenseDrafts: state.dayExpenseDrafts,
    planillaCashCloses: state.planillaCashCloses ?? [],
    monthCloses: state.monthCloses ?? [],
  };
}
