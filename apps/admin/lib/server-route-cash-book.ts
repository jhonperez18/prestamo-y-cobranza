/**
 * Libro de caja con la nube completa (lo que ve el supervisor): un día por fecha, desde
 * `ROUTE_CASH_BOOK_FROM` hasta ayer. M = libro de la cadena; A / N = caja propia. Solo lee.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { previousCalendarIso, type OperationalDayState } from "@/lib/collector-day-auto-close";
import { buildDayCashLedger, primaryClosingForDay, type DayCashSources } from "@/lib/day-cash-ledger";
import { hasRouteCashBook, independentRouteDay } from "@/lib/independent-route-cash";
import {
  isPlanillaCashChainPrimary,
  ROUTE_CASH_BOOK_FROM,
  type RouteCashBook,
  type RouteCashBookDay,
} from "@/lib/planilla-cash-chain";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";

export type RouteCashBookResult =
  | { ok: true; collectorRef: string; route: string; days: RouteCashBookDay[] }
  | { ok: false; error: string };

export async function runRouteCashBook(
  collectorRef: string,
  route: string,
  now = new Date(),
): Promise<RouteCashBookResult> {
  const routeKey = route.trim().toUpperCase();
  if (!collectorRef || !hasRouteCashBook(routeKey)) return { ok: false, error: "route_without_book" };
  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const days = routeCashBookFromState(loaded.state, collectorRef, routeKey, businessTodayIso(now));
  if (!days) return { ok: false, error: "collector_not_found" };
  return { ok: true, collectorRef, route: routeKey, days };
}

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
  };
}

function nextIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1)).toISOString().slice(0, 10);
}
