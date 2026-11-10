/**
 * Auditoría de la regla de inicio contra Supabase (lo que ve cualquier aparato).
 * Cadena M↔T: Inicial M de hoy = `cash_float` del CIE- de ayer.
 * N / A: Inicial de hoy = caja propia de ayer.
 *
 * Candado sagrado (dueño 10/11): CIE / caja del día ancla = fórmula de ese día.
 *   Caja = Inicial + efectivo − préstamos − gastos (Banco no entra).
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
  /** Fórmula del día ancla (Caja). Debe = CIE / caja sellada. */
  yesterdayFormula: number | null;
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
      const priorFig = await readDayCashFigure(collector.ref, priorDate);
      const yesterdayFormula =
        priorFig.ok && priorFig.ready && priorFig.dayFinal != null
          ? priorFig.dayFinal
          : null;
      // CIE debe = fórmula; si hubo AJUSTE T autorizado, CIE = real contado.
      const adjReal = cie.cashAdjustment?.real;
      const expectedSeal =
        adjReal != null && Number.isFinite(adjReal) ? Number(adjReal) : yesterdayFormula;
      const sealOk =
        expectedSeal == null || expectedSeal === yesterdayCieFloat;
      rows.push({
        collectorRef: collector.ref,
        collectorName: collector.name,
        yesterday: priorDate,
        yesterdayCieFloat,
        yesterdayFormula,
        todayOpening,
        todayMClosing: fig.mClosing,
        todayFinal: fig.dayFinal,
        ok: todayOpening === yesterdayCieFloat && sealOk,
        kind: "chain",
      });
      continue;
    }

    const own = await readIndependentPair(collector.ref, priorDate, businessDate);
    if (!own) continue;
    // Caja del día = fórmula. CIE debe guardar esa misma Caja (prod).
    const formulaOk = own.yesterdayFormula === own.yesterdayClosing;
    const cieOk = yesterdayCieFloat === own.yesterdayClosing;
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: priorDate,
      yesterdayCieFloat: own.yesterdayClosing,
      yesterdayFormula: own.yesterdayFormula,
      todayOpening: own.todayOpening,
      todayMClosing: own.todayClosing,
      todayFinal: own.todayClosing,
      ok: own.todayOpening === own.yesterdayClosing && formulaOk && cieOk,
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
  yesterdayFormula: number;
  todayOpening: number;
  todayClosing: number;
} | null> {
  for (const route of OWN_ROUTES) {
    const [yBox, tBox] = await Promise.all([
      readRouteOwnBox(collectorRef, yesterday, route),
      readRouteOwnBox(collectorRef, today, route),
    ]);
    if (!yBox.ok || !tBox.ok) continue;
    const yesterdayFormula =
      yBox.opening + yBox.efectivo - yBox.prestamos - yBox.gastos;
    return {
      yesterdayClosing: yBox.saldo,
      yesterdayFormula,
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
      const priorLedger = buildDayCashLedger(priorSrc);
      const yesterdayFormula = priorLedger.dayFinal;
      const adjReal = cie.cashAdjustment?.real;
      const expectedSeal =
        adjReal != null && Number.isFinite(adjReal) ? Number(adjReal) : yesterdayFormula;
      rows.push({
        collectorRef: collector.ref,
        collectorName: collector.name,
        yesterday: priorDate,
        yesterdayCieFloat,
        yesterdayFormula,
        todayOpening,
        todayMClosing: ledger.mClosing,
        todayFinal: ledger.dayFinal,
        ok: todayOpening === yesterdayCieFloat && expectedSeal === yesterdayCieFloat,
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
    const formulaSum =
      yDay.opening + yDay.efectivo - yDay.prestamos - yDay.gastos;
    // Con AJUSTE autorizado, closing = real; si no, closing = fórmula.
    const formulaOk =
      yDay.adjustment?.real != null
        ? Number(yDay.adjustment.real) === yDay.closing
        : formulaSum === yDay.closing;
    rows.push({
      collectorRef: collector.ref,
      collectorName: collector.name,
      yesterday: priorDate,
      yesterdayCieFloat: yDay.closing,
      yesterdayFormula: formulaSum,
      todayOpening: tDay.opening,
      todayMClosing: tDay.closing,
      todayFinal: tDay.closing,
      ok: tDay.opening === yDay.closing && formulaOk,
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
