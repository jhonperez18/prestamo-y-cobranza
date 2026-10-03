/**
 * Saldo de las planillas fuera de la cadena M→T (A y N) — único dueño.
 *
 * Cada una lleva su propia caja:
 *   Inicial de hoy = saldo real del último ajuste + movimiento de los días siguientes.
 *   Saldo del día  = Inicial + movimiento de hoy.
 * Movimiento del día:
 *   - cobrador de la cadena (A de Cristian): efectivo de la ruta − préstamos a clientes de A
 *     (desde `INDEPENDENT_OWN_LOANS_FROM`; antes iban a M). Los gastos siguen en M / T.
 *   - cobrador sin cadena (N de Yesid): efectivo de la ruta − gastos − préstamos.
 * Sin ajuste previo, el Inicial es el de siempre (`fallbackOpening`).
 *
 * El ajuste vive en el CIE- del cobrador de ese día (`routeCashAdjustments`).
 * No toca la cadena: ni `cashFloat`, ni `cashAdjustment` de T, ni PCE-, ni el libro del día.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { mergeRouteCashAdjustments } from "@/lib/cash-adjustment";
import { sameRoute } from "@/lib/client-route-order";
import { assignmentRouteName } from "@/lib/collector-dispatch-sync";
import {
  expensesForCollectorDay,
  normalizeHistoryDate,
  sumExpenseLines,
  type CollectorDayCloseRecord,
  type RouteCashAdjustment,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import {
  dayLoanDisbursementRows,
  dayLoanDisbursementTotal,
  loanRowsToExpenseLines,
  type DayLoanDisbursementRow,
} from "@/lib/collector-history-planilla";
import {
  isChainCollectorDay,
  routeCashCollected,
  routeClientRefsForDay,
  routeCollectedByMethod,
  type DayCashSources,
} from "@/lib/day-cash-ledger";
import { isPrestamoRutaExpense } from "@/lib/expense-lines";
import { pesos } from "@/lib/finance";
import {
  findFullDayCieClose,
  INDEPENDENT_OWN_LOANS_FROM,
  INDEPENDENT_SALDO_ROUTES,
  isPlanillaCashChainRoute,
} from "@/lib/planilla-cash-chain";

export { INDEPENDENT_SALDO_ROUTES };

export function isIndependentSaldoRoute(route: string | null | undefined): boolean {
  if (!route || isPlanillaCashChainRoute(route)) return false;
  return INDEPENDENT_SALDO_ROUTES.some((name) => sameRoute(route, name));
}

function isoOf(raw: string) {
  return normalizeHistoryDate(raw) || raw;
}

function nextIsoDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return dt.toISOString().slice(0, 10);
}

export function findRouteCashAdjustment(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  date: string,
  route: string,
): RouteCashAdjustment | null {
  const cie = findFullDayCieClose(dayCloses, collectorRef, date);
  return cie?.routeCashAdjustments?.find((adj) => sameRoute(adj.route, route)) ?? null;
}

/** Último día (antes de `date`) con ajuste de esa planilla. */
function latestAnchorBefore(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  route: string,
  date: string,
): { date: string; real: number } | null {
  const days = new Set<string>();
  for (const row of dayCloses) {
    if (row.collectorRef !== collectorRef || !row.routeCashAdjustments?.length) continue;
    const day = isoOf(row.date);
    if (day < date) days.add(day);
  }
  for (const day of [...days].sort().reverse()) {
    const adj = findRouteCashAdjustment(dayCloses, collectorRef, day, route);
    if (adj) return { date: day, real: pesos(adj.real) };
  }
  return null;
}

type RouteMovement = {
  efectivo: number;
  gastos: number;
  prestamos: number;
  /** Gastos operativos de la planilla (A de la cadena: ninguno, van a M). */
  gastoLines: RouteExpenseLine[];
  loanRows: DayLoanDisbursementRow[];
};

/**
 * ¿Los gastos de este cobrador van a M / T ese día? Solo si trabaja una hoja de la cadena.
 * El PCE-T que se proyecta desde cualquier CIE- (también el de Yesid, solo N) no lo hace
 * cobrador de la cadena: con planilla cargada manda la planilla.
 */
function gastosGoToChain(src: DayCashSources): boolean {
  const date = isoOf(src.date);
  const own = src.assignments.filter(
    (row) => row.collectorRef === src.collectorRef && isoOf(row.dispatchDate) === date,
  );
  if (own.length) {
    return own.some((row) => isPlanillaCashChainRoute(assignmentRouteName(row, src.clients)));
  }
  return isChainCollectorDay(src);
}

function routeMovement(src: DayCashSources, route: string): RouteMovement {
  const efectivo = routeCashCollected(src, route);
  const date = isoOf(src.date);
  const chainCollector = gastosGoToChain(src);
  const ownLoans = date >= INDEPENDENT_OWN_LOANS_FROM;
  if (chainCollector && !ownLoans) {
    return { efectivo, gastos: 0, prestamos: 0, gastoLines: [], loanRows: [] };
  }
  const lines = expensesForCollectorDay(src.collectorRef, date, src.dayCloses, src.dayExpenseDrafts);
  const gastoLines = chainCollector
    ? []
    : lines.filter((line) => (Number(line.amount) || 0) > 0 && !isPrestamoRutaExpense(line));
  const refs = routeClientRefsForDay(src, route);
  const loanRows = dayLoanDisbursementRows(date, lines, src.loans, src.clients, {
    collectorRef: src.collectorRef,
    assignments: src.assignments,
  }).filter((row) => refs.has(row.clientRef));
  return {
    efectivo,
    gastos: sumExpenseLines(gastoLines),
    prestamos: pesos(dayLoanDisbursementTotal(loanRows)),
    gastoLines,
    loanRows,
  };
}

/** Movimiento propio de A / N ese día (sin Inicial): mismo que suma su caja. */
export { routeMovement as independentRouteMovement };
/** ¿Los gastos del cobrador van a M / T ese día? (si no, son de su planilla A / N). */
export { gastosGoToChain as collectorGastosGoToChain };

/** Cobrado ese día a clientes de la planilla, por medio de pago (nada de otras rutas). */
export function independentRouteCollected(
  src: DayCashSources,
  route: string,
): { efectivo: number; nequi: number; banco: number } {
  return routeCollectedByMethod(src, route);
}

/** Renglones de gasto y préstamo del día de la planilla (los mismos que suma su caja). */
export function independentRouteDayLines(day: IndependentRouteDay): RouteExpenseLine[] {
  return [...day.gastoLines, ...loanRowsToExpenseLines(day.loanRows)];
}

type HistoryRowLike = { date: string; gasto: number; prestamo: number; saldo: number };

/** Historial de A / N: gasto, préstamo y saldo de la caja propia (misma cifra que la tarjeta). */
export function withIndependentRouteHistory<Row extends HistoryRowLike>(
  rows: Row[],
  src: Omit<DayCashSources, "date">,
  route: string,
): Row[] {
  return rows.map((row) => {
    const day = independentRouteDay({ ...src, date: row.date }, route);
    return { ...row, gasto: day.gastos, prestamo: day.prestamos, saldo: day.closing };
  });
}

/** Historial de A / N: renglón del día + ajuste de esa planilla (si lo hubo). */
export function attachRouteCashAdjustments<Row extends HistoryRowLike>(
  rows: Row[],
  collectorRef: string,
  route: string,
  dayCloses: CollectorDayCloseRecord[],
): Array<{ row: Row; adjustment: RouteCashAdjustment | null }> {
  return rows.map((row) => {
    const adjustment = findRouteCashAdjustment(dayCloses, collectorRef, row.date, route);
    return adjustment
      ? { row: { ...row, saldo: adjustment.calculated }, adjustment }
      : { row, adjustment: null };
  });
}

export type IndependentRouteDay = RouteMovement & {
  route: string;
  date: string;
  /** Hay un ajuste previo: el Inicial sale de él (no del `fallbackOpening`). */
  anchored: boolean;
  opening: number;
  /** Inicial + efectivo − gastos − préstamos. */
  closing: number;
  /** Ajuste hecho ese mismo día (su `real` es el Inicial de mañana). */
  adjustment: RouteCashAdjustment | null;
};

export function independentRouteDay(src: DayCashSources, route: string): IndependentRouteDay {
  const date = isoOf(src.date);
  const today = routeMovement({ ...src, date }, route);
  const anchor = latestAnchorBefore(src.dayCloses, src.collectorRef, route, date);
  let opening = pesos(src.fallbackOpening ?? 0);
  if (anchor) {
    opening = anchor.real;
    for (let day = nextIsoDay(anchor.date); day < date; day = nextIsoDay(day)) {
      const move = routeMovement({ ...src, date: day }, route);
      opening = pesos(opening + move.efectivo - move.gastos - move.prestamos);
    }
  }
  return {
    ...today,
    route,
    date,
    anchored: Boolean(anchor),
    opening,
    closing: pesos(opening + today.efectivo - today.gastos - today.prestamos),
    adjustment: findRouteCashAdjustment(src.dayCloses, src.collectorRef, date, route),
  };
}

export type RouteCashAdjustmentWindow =
  | { open: true; date: string; cie: CollectorDayCloseRecord }
  | { open: false; reason: string };

/** Ventana: planilla A/N ya cerrada hoy (CIE- del cobrador sellado), antes de medianoche. */
export function routeCashAdjustmentWindow(
  collectorRef: string,
  route: string,
  dayCloses: CollectorDayCloseRecord[],
  now = new Date(),
): RouteCashAdjustmentWindow {
  if (!isIndependentSaldoRoute(route)) {
    return { open: false, reason: "El ajuste por planilla es solo para A y N." };
  }
  const date = businessTodayIso(now);
  const cie = findFullDayCieClose(dayCloses, collectorRef, date);
  if (!cie) {
    return {
      open: false,
      reason: `La planilla ${route} aún no cierra hoy. El ajuste se hace después del cierre y antes de medianoche.`,
    };
  }
  return { open: true, date, cie };
}

export type RouteCashAdjustmentInput = {
  collectorRef: string;
  route: string;
  real: number;
  reason: string;
  by: string;
  /** Saldo del día según `independentRouteDay` (sin el ajuste). */
  calculated: number;
  dayCloses: CollectorDayCloseRecord[];
  now?: Date;
};

export type RouteCashAdjustmentResult =
  | { ok: true; record: CollectorDayCloseRecord; dayCloses: CollectorDayCloseRecord[] }
  | { ok: false; error: string };

export function commitRouteCashAdjustment(
  input: RouteCashAdjustmentInput,
): RouteCashAdjustmentResult {
  const now = input.now ?? new Date();
  const adjustWindow = routeCashAdjustmentWindow(input.collectorRef, input.route, input.dayCloses, now);
  if (!adjustWindow.open) return { ok: false, error: adjustWindow.reason };

  const real = Number(input.real);
  if (!Number.isFinite(real) || real < 0 || !Number.isInteger(real)) {
    return { ok: false, error: "Escriba el saldo real contado (pesos, sin decimales)." };
  }
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 3) return { ok: false, error: "Escriba el motivo del ajuste." };
  const by = input.by.trim();
  if (!by) return { ok: false, error: "Falta quién hace el ajuste." };

  const cie = adjustWindow.cie;
  const prev = cie.routeCashAdjustments?.find((adj) => sameRoute(adj.route, input.route));
  const calculated = pesos(prev?.calculated ?? input.calculated);
  if (!prev && pesos(real) === calculated) {
    return { ok: false, error: "El saldo real es igual al calculado: no hay nada que ajustar." };
  }

  const adjustment: RouteCashAdjustment = {
    route: input.route.trim().toUpperCase(),
    calculated,
    real: pesos(real),
    by,
    at: now.toISOString(),
    reason,
  };
  const others = (cie.routeCashAdjustments ?? []).filter(
    (adj) => !sameRoute(adj.route, input.route),
  );
  const record: CollectorDayCloseRecord = {
    ...cie,
    routeCashAdjustments: mergeRouteCashAdjustments(others, [adjustment]),
  };
  const dayCloses = input.dayCloses.map((row) => (row.ref === cie.ref ? record : row));
  return { ok: true, record, dayCloses };
}
