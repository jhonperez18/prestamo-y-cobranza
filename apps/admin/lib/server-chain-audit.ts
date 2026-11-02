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
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { buildDayCashLedger, isChainCollectorDay, type DayCashSources } from "@/lib/day-cash-ledger";
import {
  independentRouteDay,
  independentRouteForCollectorDay,
} from "@/lib/independent-route-cash";
import {
  findLatestFullDayCieBefore,
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
  // Regla de inicio: Inicial = último CIE sellado **antes de hoy** (no el calendario
  // de ayer). Domingo sin cobro → ancla al viernes/sábado; un `[]` vacío no es OK.

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
    .filter((row): row is NonNullable<typeof row> => {
      if (!row) return false;
      return !isPlanillaCashCloseRef(row.ref);
    });

  const rows: ChainAuditRow[] = [];
  for (const collector of collectors) {
    const cie = findLatestFullDayCieBefore(dayCloses, collector.ref, businessDate);
    if (!cie) continue;
    const priorDate = normalizeHistoryDate(cie.date) || cie.date;
    const yesterdayCieFloat = Number(cie.cashFloat) || 0;

    const fig = await readDayCashFigure(collector.ref, businessDate);
    if (fig.ok && fig.ready && fig.chain) {
      const open = await readChainMOpening(collector.ref, businessDate);
      const todayOpening =
        open.ok && open.ready ? open.opening : fig.opening;
      rows.push({
        collectorRef: collector.ref,
        collectorName: collector.name,
        yesterday: priorDate,
        yesterdayCieFloat,
        todayOpening,
        todayMClosing: fig.mClosing,
        todayFinal: fig.dayFinal,
        ok: todayOpening === yesterdayCieFloat,
        kind: "chain",
      });
      continue;
    }

    const own = await readIndependentPair(collector.ref, priorDate, businessDate);
    if (!own) continue;
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: priorDate,
      yesterdayCieFloat: own.yesterdayClosing,
      todayOpening: own.todayOpening,
      todayMClosing: own.todayClosing,
      todayFinal: own.todayClosing,
      ok: own.todayOpening === own.yesterdayClosing,
      kind: "independent",
    });
  }

  if (!rows.length) {
    return {
      ok: false,
      businessDate,
      rows: [],
      error: "sin_cie_previo",
    };
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
  const rows: ChainAuditRow[] = [];
  for (const collector of state.collectors) {
    const cie = findLatestFullDayCieBefore(state.dayCloses, collector.ref, businessDate);
    if (!cie) continue;
    const priorDate = normalizeHistoryDate(cie.date) || cie.date;
    const todaySrc = sourcesOf(state, collector, businessDate);
    const priorSrc = sourcesOf(state, collector, priorDate);
    if (isChainCollectorDay(todaySrc) || isChainCollectorDay(priorSrc)) {
      const ledger = buildDayCashLedger(todaySrc);
      const todayOpening = ledger.mOpening.kind === "chain" ? ledger.mOpening.opening : null;
      const yesterdayCieFloat = Number(cie.cashFloat) || 0;
      rows.push({
        collectorRef: collector.ref,
        collectorName: collector.name,
        yesterday: priorDate,
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
      independentRouteForCollectorDay(priorSrc) ??
      independentRouteForCollectorDay(todaySrc);
    if (!route) continue;
    const yDay = independentRouteDay(priorSrc, route);
    const tDay = independentRouteDay(todaySrc, route);
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: priorDate,
      yesterdayCieFloat: yDay.closing,
      todayOpening: tDay.opening,
      todayMClosing: tDay.closing,
      todayFinal: tDay.closing,
      ok: tDay.opening === yDay.closing,
      kind: "independent",
    });
  }

  if (!rows.length) {
    return { ok: false, businessDate, rows: [], error: "sin_cie_previo" };
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
