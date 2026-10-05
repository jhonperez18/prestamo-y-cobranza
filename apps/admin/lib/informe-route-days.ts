/**
 * Informe del supervisor → historial diario de Cobrado / Préstamo / Gasto por ruta (M · T · N).
 * Solo lee a los dueños de cada cifra; aquí no hay fórmula propia:
 *   Cobrado  = `routeCollectedByMethod` (todos los medios, por ruta del cliente).
 *   Préstamo = efectivo del libro (`buildDayCashLedger().m/.t`, N: `independentRouteMovement`)
 *              + Banco / Nequi (`dayDigitalLoanRows`, por ruta del cliente).
 *   Gasto    = gastos operativos del libro (M / T) o de la caja de N (sin capital prestado).
 * A lleva dinero aparte y no entra.
 */
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { chainDayMovements, routeCollectedByMethod, type DayCashSources } from "@/lib/day-cash-ledger";
import { dayDigitalLoanRows } from "@/lib/day-digital-loans";
import { pesos } from "@/lib/finance";
import {
  collectorGastosGoToChain,
  independentRouteMovement,
} from "@/lib/independent-route-cash";

export const INFORME_HISTORY_ROUTES = ["T", "M", "N"] as const;
export type InformeHistoryRoute = (typeof INFORME_HISTORY_ROUTES)[number];
export type InformeHistoryKind = "cobrado" | "prestamo" | "gasto";

export type InformeDayRow = Record<InformeHistoryRoute, number> & { date: string; total: number };
export type InformeHistory = Record<InformeHistoryKind, { days: InformeDayRow[]; total: number }>;

export type InformeHistorySources = Omit<DayCashSources, "collectorRef" | "collectorName" | "date" | "fallbackOpening">;

type DayAcc = Record<InformeHistoryKind, Record<InformeHistoryRoute, number>>;

function nextIsoDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1)).toISOString().slice(0, 10);
}

function groupByDay<Row>(
  rows: readonly Row[],
  dateOf: (row: Row) => string,
  start: string,
  end: string,
): Map<string, Row[]> {
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const raw = dateOf(row);
    const day = normalizeHistoryDate(raw) || raw;
    if (!day || day < start || day > end) continue;
    const list = byDay.get(day);
    if (list) list.push(row);
    else byDay.set(day, [row]);
  }
  return byDay;
}

function emptyDay(): DayAcc {
  const zero = () => ({ T: 0, M: 0, N: 0 });
  return { cobrado: zero(), prestamo: zero(), gasto: zero() };
}

function collectorDay(src: DayCashSources, acc: DayAcc) {
  for (const route of INFORME_HISTORY_ROUTES) {
    const by = routeCollectedByMethod(src, route);
    acc.cobrado[route] += by.efectivo + by.banco + by.nequi;
  }
  if (collectorGastosGoToChain(src)) {
    const { m, t } = chainDayMovements(src);
    acc.prestamo.M += m.prestamos;
    acc.prestamo.T += t.prestamos;
    acc.gasto.M += m.gastos;
    acc.gasto.T += t.gastos;
  }
  const n = independentRouteMovement(src, "N");
  acc.prestamo.N += n.prestamos;
  acc.gasto.N += n.gastos;
}

/** Días de `from` a `to` (ISO) con movimiento, del más reciente al más viejo. */
export function informeRouteHistory(
  src: InformeHistorySources,
  collectorRefs: readonly string[],
  from: string,
  to: string,
): InformeHistory {
  const out: InformeHistory = {
    cobrado: { days: [], total: 0 },
    prestamo: { days: [], total: 0 },
    gasto: { days: [], total: 0 },
  };
  const start = normalizeHistoryDate(from) || from;
  const end = normalizeHistoryDate(to) || to;
  // Cada lectura filtra la planilla por cobrador + `dispatchDate` y los cobros por `paidDate`:
  // darle solo los de ese cobrador y día da lo mismo y evita recorrer todo el mes en cada cuenta.
  const assignmentsByDay = groupByDay(src.assignments, (row) => row.dispatchDate, start, end);
  const paymentsByDay = groupByDay(src.payments, (row) => row.paidDate || "", start, end);
  for (let date = start; date <= end; date = nextIsoDay(date)) {
    const acc = emptyDay();
    const dayAssignments = assignmentsByDay.get(date) ?? [];
    const payments = paymentsByDay.get(date) ?? [];
    // Un cobrador con varias rutas (M, T, A) llega una vez por ruta: se cuenta una sola vez.
    for (const collectorRef of new Set(collectorRefs)) {
      const collector = src.collectors.find((row) => row.ref === collectorRef);
      if (!collector) continue;
      collectorDay(
        {
          ...src,
          assignments: dayAssignments.filter((row) => row.collectorRef === collectorRef),
          payments,
          collectors: [collector],
          collectorRef,
          collectorName: collector.name,
          date,
        },
        acc,
      );
    }
    for (const route of INFORME_HISTORY_ROUTES) {
      for (const row of dayDigitalLoanRows(date, route, src.loans, src.clients)) {
        acc.prestamo[route] += row.capital;
      }
    }
    for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
      const day = acc[kind];
      if (day.T === 0 && day.M === 0 && day.N === 0) continue;
      const total = pesos(day.T + day.M + day.N);
      out[kind].days.push({ date, T: pesos(day.T), M: pesos(day.M), N: pesos(day.N), total });
      out[kind].total = pesos(out[kind].total + total);
    }
  }
  for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
    out[kind].days.sort((a, b) => b.date.localeCompare(a.date));
  }
  return out;
}

export type InformeRouteDayRow = { date: string; total: number };
export type InformeRouteHistory = Record<InformeHistoryKind, { days: InformeRouteDayRow[]; total: number }>;

/**
 * Informe de una planilla con caja propia (A · Angélica), día a día de `from` a `to`:
 *   Cobrado  = `routeCollectedByMethod` (todos los medios, clientes de la ruta).
 *   Préstamo = caja propia (`independentRouteMovement`) + Nequi / Banco (`dayDigitalLoanRows`).
 *   Gasto    = gastos de su caja (`independentRouteMovement`; los de A van a M/T → 0).
 */
export function informeOwnRouteHistory(
  src: InformeHistorySources,
  collectorRefs: readonly string[],
  route: string,
  from: string,
  to: string,
): InformeRouteHistory {
  const out: InformeRouteHistory = {
    cobrado: { days: [], total: 0 },
    prestamo: { days: [], total: 0 },
    gasto: { days: [], total: 0 },
  };
  const start = normalizeHistoryDate(from) || from;
  const end = normalizeHistoryDate(to) || to;
  const assignmentsByDay = groupByDay(src.assignments, (row) => row.dispatchDate, start, end);
  const paymentsByDay = groupByDay(src.payments, (row) => row.paidDate || "", start, end);
  for (let date = start; date <= end; date = nextIsoDay(date)) {
    const acc: Record<InformeHistoryKind, number> = { cobrado: 0, prestamo: 0, gasto: 0 };
    const dayAssignments = assignmentsByDay.get(date) ?? [];
    const payments = paymentsByDay.get(date) ?? [];
    for (const collectorRef of new Set(collectorRefs)) {
      const collector = src.collectors.find((row) => row.ref === collectorRef);
      if (!collector) continue;
      const day: DayCashSources = {
        ...src,
        assignments: dayAssignments.filter((row) => row.collectorRef === collectorRef),
        payments,
        collectors: [collector],
        collectorRef,
        collectorName: collector.name,
        date,
      };
      const by = routeCollectedByMethod(day, route);
      acc.cobrado += by.efectivo + by.banco + by.nequi;
      const own = independentRouteMovement(day, route);
      acc.prestamo += own.prestamos;
      acc.gasto += own.gastos;
    }
    for (const row of dayDigitalLoanRows(date, route, src.loans, src.clients)) {
      acc.prestamo += row.capital;
    }
    for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
      if (acc[kind] === 0) continue;
      const total = pesos(acc[kind]);
      out[kind].days.push({ date, total });
      out[kind].total = pesos(out[kind].total + total);
    }
  }
  for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
    out[kind].days.sort((a, b) => b.date.localeCompare(a.date));
  }
  return out;
}
