/**
 * Libro de caja de A / N con la nube completa (lo que ve el supervisor): un día por fecha,
 * desde `ROUTE_CASH_BOOK_FROM` hasta ayer. Solo lee; no escribe nada.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { previousCalendarIso, type OperationalDayState } from "@/lib/collector-day-auto-close";
import {
  independentRouteDay,
  isIndependentSaldoRoute,
  ROUTE_CASH_BOOK_FROM,
  type RouteCashBook,
  type RouteCashBookDay,
} from "@/lib/independent-route-cash";
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
  if (!collectorRef || !isIndependentSaldoRoute(routeKey)) return { ok: false, error: "route_not_independent" };
  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const days = routeCashBookFromState(loaded.state, collectorRef, routeKey, businessTodayIso(now));
  if (!days) return { ok: false, error: "collector_not_found" };
  return { ok: true, collectorRef, route: routeKey, days };
}

/** Cada día parte del cierre del anterior (mismo cálculo que `independentRouteDay` sin libro). */
export function routeCashBookFromState(
  state: OperationalDayState,
  collectorRef: string,
  route: string,
  today: string,
): RouteCashBookDay[] | null {
  const collector = state.collectors.find((row) => row.ref === collectorRef);
  if (!collector) return null;
  const book: RouteCashBook = new Map();
  const last = previousCalendarIso(today);
  for (let date = ROUTE_CASH_BOOK_FROM; date <= last; date = nextIso(date)) {
    const day = independentRouteDay(
      {
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
      },
      route,
      book,
    );
    book.set(date, {
      date,
      opening: day.opening,
      closing: day.closing,
      efectivo: day.efectivo,
      gastos: day.gastos,
      prestamos: day.prestamos,
    });
  }
  return [...book.values()];
}

function nextIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1)).toISOString().slice(0, 10);
}
