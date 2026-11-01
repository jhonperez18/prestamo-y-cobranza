/**
 * Cajas por ruta — mapa firme (día a día y mes a mes).
 *
 * ╔══════════════════════════════════════════════════════════╗
 * ║ 1) CADENA M ↔ T — regla de inicio (NO TOCAR AQUÍ)       ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 *   Día a día:
 *     Inicial M hoy  = final de T ayer  = CIE- (`cash_float`)
 *     Inicial T hoy  = final de M hoy   = caja viva / PCE-M
 *
 *   Mes a mes (es el mismo hilo):
 *     Inicial M del día 1 = CIE- del último día del mes anterior
 *     (final de T de ese día). T del día 1 abre con la caja de M.
 *
 *   Dueños: `openingCashForChainedPlanilla` + `day-cash-ledger`.
 *   Este archivo no calcula ni alinea M/T.
 *
 * ╔══════════════════════════════════════════════════════════╗
 * ║ 2) A y N — independientes (entre sí y de la cadena)     ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 *   Día a día:
 *     Inicial hoy = Saldo de ayer de ESA misma ruta.
 *
 *   Mes a mes (mismo hilo):
 *     Inicial del día 1 = Saldo del último día del mes anterior
 *     de ESA misma ruta.
 *
 *   A no mezcla con N. Ninguna mezcla con M/T.
 *   Dueño del día: `independentRouteDay`.
 *   Cruce de mes (solo A/N): `routeMonthCarryOpening` abajo.
 */
import {
  lastCalendarDayOfPeriod,
  lastCollectionDayOfPeriod,
  normalizeHistoryDate,
  previousPeriod,
  type CollectorDayCloseRecord,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { previousCalendarIso } from "@/lib/collector-day-auto-close";
import { type DayCashSources } from "@/lib/day-cash-ledger";
import { pesos } from "@/lib/finance";
import {
  independentRouteDay,
  independentRouteFinalSaldo,
  isIndependentSaldoRoute,
} from "@/lib/independent-route-cash";
import {
  ROUTE_CASH_BOOK_FROM,
  type PlanillaCashCloseRecord,
  type RouteCashBook,
} from "@/lib/planilla-cash-chain";

export type MonthCarrySources = Omit<DayCashSources, "date"> & {
  planillaCashCloses?: PlanillaCashCloseRecord[];
  monthCloses: CollectorMonthCloseRecord[];
};

/** Día 1 de un período `YYYY-MM`. */
export function periodDay1Iso(period: string): string {
  return `${period}-01`;
}

/** Último día operativo del mes anterior a `period` (cobro; si no, calendario). */
export function previousMonthLastDayIso(period: string): string {
  const prev = previousPeriod(period);
  return lastCollectionDayOfPeriod(prev) || lastCalendarDayOfPeriod(prev) || "";
}

/**
 * Solo A / N — día a día:
 * Inicial de `dateIso` = Saldo (closing) del día calendario anterior de ESA ruta.
 * Devuelve null en M/T (ahí manda la cadena).
 */
export function routePriorDayCarryOpening(
  src: MonthCarrySources,
  route: string,
  dateIso: string,
  book?: RouteCashBook | null,
): number | null {
  if (!isIndependentSaldoRoute(route)) return null;
  const date = normalizeHistoryDate(dateIso) || dateIso;
  if (!date || date <= ROUTE_CASH_BOOK_FROM) return null;
  const prior = previousCalendarIso(date);
  if (!prior || prior < ROUTE_CASH_BOOK_FROM) return null;
  // Ajuste del día previo (si lo hubo) = Inicial de hoy; si no, su closing.
  return independentRouteFinalSaldo(
    independentRouteDay({ ...src, date: prior }, route, book),
  );
}

/**
 * Solo A / N — mes a mes (mismo hilo que día a día):
 * Inicial del día 1 de `period` = Saldo del último día del mes anterior
 * de ESA ruta. Null en M/T.
 */
export function routeMonthCarryOpening(
  src: MonthCarrySources,
  route: string,
  period: string,
  book?: RouteCashBook | null,
): number | null {
  if (!isIndependentSaldoRoute(route)) return null;

  const lastDay = previousMonthLastDayIso(period);
  if (!lastDay || lastDay < ROUTE_CASH_BOOK_FROM) return null;

  // Misma regla día a día: AJUSTE@A/N.real del cierre manda sobre el closing calculado.
  return independentRouteFinalSaldo(
    independentRouteDay({ ...src, date: lastDay }, route, book),
  );
}

/** ¿`dateIso` es el día 1 del mes? */
export function isPeriodDay1(dateIso: string): boolean {
  const date = normalizeHistoryDate(dateIso) || dateIso;
  return Boolean(date && Number(date.slice(8, 10)) === 1);
}

/**
 * Solo A / N: alinea el renglón del día 1 en reposo al arrastre del mes.
 * No usar en M ni T.
 */
export function alignIndependentDay1ToCarry<
  Row extends {
    date: string;
    cobro?: number;
    gasto?: number;
    prestamo?: number;
    saldo?: number;
  },
>(rows: Row[], period: string, carry: number): Row[] {
  const day1 = periodDay1Iso(period);
  const amount = pesos(carry);
  return rows.map((row) => {
    if (row.date !== day1) return row;
    const idle =
      !(Number(row.cobro) > 0) &&
      !(Number(row.gasto) > 0) &&
      !(Number(row.prestamo) > 0);
    if (!idle) return row;
    return row.saldo != null ? { ...row, saldo: amount } : row;
  });
}

/**
 * Solo A / N: en el historial, cada día en reposo arrastra el Saldo del día previo
 * (día a día). No toca días con cobro / gasto / préstamo. No usar en M/T.
 */
export function alignIndependentHistoryDayToDay<
  Row extends {
    date: string;
    cobro?: number;
    gasto?: number;
    prestamo?: number;
    saldo: number;
  },
>(rows: Row[]): Row[] {
  if (rows.length < 2) return rows;
  const ascending = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < ascending.length; i += 1) {
    const prev = ascending[i - 1];
    const cur = ascending[i];
    const idle =
      !(Number(cur.cobro) > 0) &&
      !(Number(cur.gasto) > 0) &&
      !(Number(cur.prestamo) > 0);
    if (!idle) continue;
    ascending[i] = { ...cur, saldo: pesos(prev.saldo) };
  }
  const byDate = new Map(ascending.map((row) => [row.date, row]));
  return rows.map((row) => byDate.get(row.date) ?? row);
}

/** Fuentes mínimas para el arrastre de A / N. */
export function monthCarrySrcFrom(
  collectorRef: string,
  collectorName: string,
  parts: {
    payments: DayCashSources["payments"];
    loans: DayCashSources["loans"];
    clients: DayCashSources["clients"];
    collectors: DayCashSources["collectors"];
    assignments: DayCashSources["assignments"];
    dayCloses: CollectorDayCloseRecord[];
    dayExpenseDrafts: DayCashSources["dayExpenseDrafts"];
    planillaCashCloses: PlanillaCashCloseRecord[];
    monthCloses: CollectorMonthCloseRecord[];
  },
): MonthCarrySources {
  return {
    collectorRef,
    collectorName,
    payments: parts.payments,
    loans: parts.loans,
    clients: parts.clients,
    collectors: parts.collectors,
    assignments: parts.assignments,
    dayCloses: parts.dayCloses,
    dayExpenseDrafts: parts.dayExpenseDrafts,
    planillaCashCloses: parts.planillaCashCloses,
    monthCloses: parts.monthCloses,
  };
}
