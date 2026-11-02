/**
 * Auditoría de la regla de inicio contra Supabase (lo que ve cualquier aparato).
 * Cadena M↔T: Inicial M de hoy = `cash_float` del CIE- de ayer.
 * N / A: Inicial de hoy = caja propia de ayer.
 *
 * Solo lee. No baja cobros / planilla / clientes / préstamos: usa CIE + RPC
 * (`chain_m_opening` / `day_cash_figure` / `route_own_box`).
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { previousCalendarIso, type OperationalDayState } from "@/lib/collector-day-auto-close";
import { buildDayCashLedger, isChainCollectorDay, type DayCashSources } from "@/lib/day-cash-ledger";
import {
  independentRouteDay,
  independentRouteForCollectorDay,
} from "@/lib/independent-route-cash";
import {
  findFullDayCieClose,
  isPlanillaCashCloseRef,
} from "@/lib/planilla-cash-chain";
import type { CollectorRow } from "@/lib/mock-data";
import { fetchOpsTable, rowToCollector, rowToDayClose } from "@/lib/supabase/ops-mirror";
import { readChainMOpening } from "@/lib/server-chain-m-opening";
import { readDayCashFigure } from "@/lib/server-day-cash-figure";
import { readRouteOwnBox } from "@/lib/server-route-own-box";

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

const OWN_ROUTES = ["N", "A"] as const;

export async function runServerChainAudit(now = new Date()): Promise<ChainAuditResult> {
  const businessDate = businessTodayIso(now);
  const yesterday = previousCalendarIso(businessDate);

  const [collectorsT, closesT] = await Promise.all([
    fetchOpsTable("collectors"),
    fetchOpsTable("day_closes"),
  ]);
  if (!collectorsT.ok) {
    return {
      ok: false,
      businessDate,
      rows: [],
      error: "error" in collectorsT ? String(collectorsT.error) : "collectors_fetch_failed",
    };
  }
  if (!closesT.ok) {
    return {
      ok: false,
      businessDate,
      rows: [],
      error: "error" in closesT ? String(closesT.error) : "day_closes_fetch_failed",
    };
  }

  const collectors = (collectorsT.rows ?? [])
    .map(rowToCollector)
    .filter((row): row is CollectorRow => Boolean(row));
  const dayCloses = (closesT.rows ?? [])
    .map(rowToDayClose)
    .filter((row): row is NonNullable<typeof row> => Boolean(row) && !isPlanillaCashCloseRef(row.ref));

  const rows: ChainAuditRow[] = [];
  for (const collector of collectors) {
    const cie = findFullDayCieClose(dayCloses, collector.ref, yesterday);
    if (!cie) continue;
    const yesterdayLabel = normalizeHistoryDate(cie.date) || cie.date;
    const yesterdayCieFloat = Number(cie.cashFloat) || 0;

    const fig = await readDayCashFigure(collector.ref, businessDate);
    if (fig.ok && fig.ready && fig.chain) {
      const open = await readChainMOpening(collector.ref, businessDate);
      const todayOpening =
        open.ok && open.ready ? open.opening : fig.opening;
      rows.push({
        collectorRef: collector.ref,
        collectorName: collector.name,
        yesterday: yesterdayLabel,
        yesterdayCieFloat,
        todayOpening,
        todayMClosing: fig.mClosing,
        todayFinal: fig.dayFinal,
        ok: todayOpening === yesterdayCieFloat,
        kind: "chain",
      });
      continue;
    }

    const own = await readIndependentPair(collector.ref, yesterday, businessDate);
    if (!own) continue;
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: yesterdayLabel,
      yesterdayCieFloat: own.yesterdayClosing,
      todayOpening: own.todayOpening,
      todayMClosing: own.todayClosing,
      todayFinal: own.todayClosing,
      ok: own.todayOpening === own.yesterdayClosing,
      kind: "independent",
    });
  }

  return { ok: rows.every((row) => row.ok), businessDate, rows };
}

async function readIndependentPair(
  collectorRef: string,
  yesterday: string,
  today: string,
): Promise<{
  yesterdayClosing: number;
  todayOpening: number;
  todayClosing: number;
} | null> {
  for (const route of OWN_ROUTES) {
    const [yBox, tBox] = await Promise.all([
      readRouteOwnBox(collectorRef, yesterday, route),
      readRouteOwnBox(collectorRef, today, route),
    ]);
    if (!yBox.ok || !tBox.ok) continue;
    return {
      yesterdayClosing: yBox.saldo,
      todayOpening: tBox.opening,
      todayClosing: tBox.saldo,
    };
  }
  return null;
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
