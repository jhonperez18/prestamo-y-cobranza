/**
 * Libro de caja (M / A / N) desde `ROUTE_CASH_BOOK_FROM` hasta ayer.
 * Solo lee. No baja planilla + cobros + clientes enteros: usa las RPC de la base
 * (`day_cash_figure` para M, `route_own_box` para A/N) — misma cifra que la pantalla.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { previousCalendarIso, type OperationalDayState } from "@/lib/collector-day-auto-close";
import {
  buildDayCashLedger,
  primaryClosingForDay,
  routeCobradoBreakdown,
  type DayCashSources,
} from "@/lib/day-cash-ledger";
import { hasRouteCashBook, independentRouteDay } from "@/lib/independent-route-cash";
import {
  isPlanillaCashChainPrimary,
  PLANILLA_CASH_CHAIN_PRIMARY,
  ROUTE_CASH_BOOK_FROM,
  type RouteCashBook,
  type RouteCashBookDay,
} from "@/lib/planilla-cash-chain";
import { pesos } from "@/lib/finance";
import { readDayCashFigure } from "@/lib/server-day-cash-figure";
import { readRouteOwnBox } from "@/lib/server-route-own-box";

export type RouteCashBookResult =
  | { ok: true; collectorRef: string; route: string; days: RouteCashBookDay[] }
  | { ok: false; error: string };

const RPC_BATCH = 8;

export async function runRouteCashBook(
  collectorRef: string,
  route: string,
  now = new Date(),
): Promise<RouteCashBookResult> {
  const routeKey = route.trim().toUpperCase();
  const ref = collectorRef.trim();
  if (!ref || !hasRouteCashBook(routeKey)) return { ok: false, error: "route_without_book" };

  const today = businessTodayIso(now);
  const last = previousCalendarIso(today);
  const dates = datesInclusive(ROUTE_CASH_BOOK_FROM, last);
  if (dates.length === 0) {
    return { ok: true, collectorRef: ref, route: routeKey, days: [] };
  }

  const days = isPlanillaCashChainPrimary(routeKey)
    ? await bookChainPrimary(ref, dates)
    : await bookIndependent(ref, routeKey, dates);

  return { ok: true, collectorRef: ref, route: routeKey, days };
}

/**
 * Misma lógica en memoria (ensayos / assert). Producción usa `runRouteCashBook` (RPC).
 */
export function routeCashBookFromState(
  state: OperationalDayState,
  collectorRef: string,
  route: string,
  today: string,
): RouteCashBookDay[] | null {
  const collector = state.collectors.find((row) => row.ref === collectorRef);
  if (!collector) return null;
  const sources = (date: string): DayCashSources => ({
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
  });
  const book: RouteCashBook = new Map();
  const last = previousCalendarIso(today);
  for (let date = ROUTE_CASH_BOOK_FROM; date <= last; date = nextIso(date)) {
    const day = isPlanillaCashChainPrimary(route)
      ? chainPrimaryDay(sources(date))
      : independentDay(sources(date), route, book);
    if (day) book.set(date, day);
  }
  return [...book.values()];
}

async function bookChainPrimary(
  collectorRef: string,
  dates: readonly string[],
): Promise<RouteCashBookDay[]> {
  const rows = await mapInBatches(dates, RPC_BATCH, async (date) => {
    const fig = await readDayCashFigure(collectorRef, date);
    if (!fig.ok || !fig.ready || !fig.chain) return null;
    // Misma caja final de M que `primaryClosingOf`: CIE − (dayFinal − mClosing).
    const closing =
      fig.cie != null
        ? pesos(fig.cie - (fig.dayFinal - fig.mClosing))
        : fig.mClosing;
    return {
      date,
      opening: fig.opening,
      closing,
      efectivo: fig.mEfectivo,
      gastos: fig.mGastos,
      prestamos: fig.mPrestamos,
      cobrado: fig.mEfectivo,
    } satisfies RouteCashBookDay;
  });
  return rows.filter((row): row is RouteCashBookDay => Boolean(row));
}

async function bookIndependent(
  collectorRef: string,
  route: string,
  dates: readonly string[],
): Promise<RouteCashBookDay[]> {
  const rows = await mapInBatches(dates, RPC_BATCH, async (date) => {
    const box = await readRouteOwnBox(collectorRef, date, route);
    if (!box.ok) return null;
    return {
      date,
      opening: box.opening,
      closing: box.saldo,
      efectivo: box.efectivo,
      gastos: box.gastos,
      prestamos: box.prestamos,
      /** Historial de caja A/N: COBROS = efectivo (Nequi/Banco van al pool). */
      cobrado: box.efectivo,
    } satisfies RouteCashBookDay;
  });
  return rows.filter((row): row is RouteCashBookDay => Boolean(row));
}

/** M: Inicial = CIE de la víspera; Saldo = caja final de M (CIE − movimiento de T). */
function chainPrimaryDay(src: DayCashSources): RouteCashBookDay | null {
  const ledger = buildDayCashLedger(src);
  if (!ledger.chain || ledger.mOpening.kind !== "chain" || !ledger.mOpening.ready) return null;
  const closing = primaryClosingForDay(src, src.date);
  return {
    date: src.date,
    opening: ledger.mOpening.opening,
    closing: closing ?? ledger.mClosing,
    efectivo: ledger.m.efectivo,
    gastos: ledger.m.gastos,
    prestamos: ledger.m.prestamos,
    cobrado: routeCobradoBreakdown(src, PLANILLA_CASH_CHAIN_PRIMARY).total,
  };
}

/** A / N: cada día parte del cierre del anterior (mismo cálculo que `independentRouteDay`). */
function independentDay(src: DayCashSources, route: string, book: RouteCashBook): RouteCashBookDay {
  const day = independentRouteDay(src, route, book);
  return {
    date: src.date,
    opening: day.opening,
    closing: day.closing,
    efectivo: day.efectivo,
    gastos: day.gastos,
    prestamos: day.prestamos,
    cobrado: routeCobradoBreakdown(src, route).total,
  };
}

function datesInclusive(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  for (let date = from; date <= to; date = nextIso(date)) out.push(date);
  return out;
}

function nextIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1)).toISOString().slice(0, 10);
}

async function mapInBatches<T, R>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    const part = await Promise.all(chunk.map((item) => fn(item)));
    out.push(...part);
  }
  return out;
}
