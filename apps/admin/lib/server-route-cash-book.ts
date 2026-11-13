/**
 * Libro de caja (M / A / N). Solo lee. No baja planilla + cobros + clientes enteros:
 * usa RPC `day_cash_figure` (M) / `route_own_box` (A/N).
 * Ventana acotada + tope por día: no satura el worker del supervisor.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { previousCalendarIso, type OperationalDayState } from "@/lib/collector-day-auto-close";
import { previousPeriod } from "@/lib/collector-day-close";
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

/** Olas en paralelo: un mes ≈ 4 olas (antes 8). Sin saturar Supabase. */
const RPC_BATCH = 8;
const RPC_DAY_MS = 3_500;
/** Tope duro: un mes calendario (~31) basta para historial; más = app del jefe pegada. */
const MAX_DAYS = 35;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then((v) => v).catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function runRouteCashBook(
  collectorRef: string,
  route: string,
  options?: { fromIso?: string; toIso?: string; now?: Date },
): Promise<RouteCashBookResult> {
  const routeKey = route.trim().toUpperCase();
  const ref = collectorRef.trim();
  if (!ref || !hasRouteCashBook(routeKey)) return { ok: false, error: "route_without_book" };

  const now = options?.now ?? new Date();
  const today = businessTodayIso(now);
  const lastDefault = previousCalendarIso(today);
  const prevMonthStart = `${previousPeriod(today.slice(0, 7))}-01`;
  const defaultFrom =
    prevMonthStart > ROUTE_CASH_BOOK_FROM ? prevMonthStart : ROUTE_CASH_BOOK_FROM;

  let from =
    options?.fromIso && /^\d{4}-\d{2}-\d{2}$/.test(options.fromIso)
      ? options.fromIso
      : defaultFrom;
  let to =
    options?.toIso && /^\d{4}-\d{2}-\d{2}$/.test(options.toIso)
      ? options.toIso
      : lastDefault;
  if (from < ROUTE_CASH_BOOK_FROM) from = ROUTE_CASH_BOOK_FROM;
  if (to > lastDefault) to = lastDefault;
  if (from > to) {
    return { ok: true, collectorRef: ref, route: routeKey, days: [] };
  }

  let dates = datesInclusive(from, to);
  if (dates.length > MAX_DAYS) dates = dates.slice(dates.length - MAX_DAYS);

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
  const rows: RouteCashBookDay[] = [];
  await mapInBatches(dates, RPC_BATCH, async (date) => {
    const fig = await withTimeout(readDayCashFigure(collectorRef, date), RPC_DAY_MS);
    if (!fig || !fig.ok || !fig.ready || !fig.chain) return;
    // Caja final M = mClosing del libro (= Inicial de T). Nunca derivar desde un CIE
    // descuadrado: cie − (dayFinal − mClosing) inventó 417k el 03/11 con CIE 527k.
    rows.push({
      date,
      opening: fig.opening,
      closing: fig.mClosing,
      efectivo: fig.mEfectivo,
      gastos: fig.mGastos,
      prestamos: fig.mPrestamos,
      cobrado: fig.mEfectivo,
      dayFinal: fig.dayFinal,
      cie: fig.cie,
      mClosing: fig.mClosing,
      tEfectivo: fig.tEfectivo,
      tPrestamos: fig.tPrestamos,
      tGastos: fig.tGastos,
    });
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

async function bookIndependent(
  collectorRef: string,
  route: string,
  dates: readonly string[],
): Promise<RouteCashBookDay[]> {
  const rows: RouteCashBookDay[] = [];
  await mapInBatches(dates, RPC_BATCH, async (date) => {
    const box = await withTimeout(readRouteOwnBox(collectorRef, date, route), RPC_DAY_MS);
    if (!box || !box.ok) return;
    rows.push({
      date,
      opening: box.opening,
      closing: box.saldo,
      efectivo: box.efectivo,
      gastos: box.gastos,
      prestamos: box.prestamos,
      cobrado: box.efectivo,
    });
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

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

async function mapInBatches<T>(
  items: readonly T[],
  size: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    await Promise.all(chunk.map((item) => fn(item)));
  }
}
