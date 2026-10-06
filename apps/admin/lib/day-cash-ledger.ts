/**
 * Libro de caja del día — ÚNICO dueño del saldo del cobrador (regla de inicio).
 *
 * Nadie más calcula «caja viva de M», «Inicial de T» ni el `cash_float` del CIE-.
 * Cobrador, supervisor, panel, cierre manual, auto-cierre 23:30 y cron servidor
 * leen de aquí. Una sola fórmula ⇒ una sola cifra en todos los aparatos.
 *
 *   Inicial M   = CIE- de ayer (`cash_float`)            → openingCashForChainedPlanilla
 *   Caja viva M = Inicial M + efectivo M − préstamos M − gastos M
 *   Inicial T   = Caja viva M (solo el saldo; T no arrastra préstamos ni gastos de M)
 *   Saldo final = Inicial T + efectivo T − préstamos T − gastos T → `cash_float` del CIE- de hoy
 *
 * Cada planilla tiene lo suyo: préstamo = ruta de su cliente; gasto = planilla donde se anotó.
 *
 * Planilla A (y cualquier ruta fuera de la cadena) no entra al saldo. Desde
 * `INDEPENDENT_OWN_LOANS_FROM`, sus préstamos tampoco: salen de la caja de A.
 */
import {
  expensesForCollectorDay,
  normalizeHistoryDate,
  sumExpenseLines,
  type CashAdjustment,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import {
  dayLoanDisbursementRows,
  dayLoanDisbursementTotal,
  loanRowsToExpenseLines,
  type DayLoanDisbursementRow,
} from "@/lib/collector-history-planilla";
import { assignmentRouteName } from "@/lib/collector-dispatch-sync";
import { collectorDayPayments } from "@/lib/collector-mobile";
import { sameRoute } from "@/lib/client-route-order";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  isPrestamoRutaExpense,
  loanClientOnSide,
  operativeLineOnSide,
  type ChainRouteSplit,
} from "@/lib/expense-lines";
import { pesos } from "@/lib/finance";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow } from "@/lib/mock-data";
import { normalizePaymentMethod } from "@/lib/payment-method";
import {
  findFullDayCieClose,
  INDEPENDENT_OWN_LOANS_FROM,
  INDEPENDENT_SALDO_ROUTES,
  isPlanillaCashChainRoute,
  openingCashForChainedPlanilla,
  planillaCashCloseRef,
  PLANILLA_CASH_CHAIN_PRIMARY,
  PLANILLA_CASH_CHAIN_SECONDARY,
  upsertPlanillaCashClose,
  type ChainOpeningResult,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";

/** Todo lo que el libro necesita leer. Mismos datos en cualquier aparato ⇒ misma cifra. */
export type DayCashSources = {
  collectorRef: string;
  collectorName?: string;
  date: string;
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  planillaCashCloses: PlanillaCashCloseRecord[];
  monthCloses: CollectorMonthCloseRecord[];
  /** Solo si no existe CIE- previo ni PCE-T previo (día época / cobrador nuevo). */
  fallbackOpening?: number;
};

/** Movimiento propio de una planilla de la cadena ese día. */
export type RouteCashDay = {
  efectivo: number;
  gastos: number;
  prestamos: number;
  /** Gastos operativos anotados en esta planilla. */
  gastoLines: RouteExpenseLine[];
  /** Préstamos en efectivo a clientes de esta planilla. */
  loanRows: DayLoanDisbursementRow[];
};

export type DayCashLedger = {
  collectorRef: string;
  date: string;
  /** Cobrador con planillas M/T ese día (o eslabones PCE- previos). */
  chain: boolean;
  mOpening: ChainOpeningResult;
  m: RouteCashDay;
  /** Caja viva / final de M = Inicial de T. */
  mClosing: number;
  t: RouteCashDay;
  /** Saldo final del día según el libro (lo que selló el cierre). */
  dayFinal: number;
  /** Ajuste de saldo real sobre el CIE- de ese día (supervisor). Su `real` es el Inicial M de mañana. */
  cashAdjustment: CashAdjustment | null;
};

function dateIsoOf(raw: string) {
  return normalizeHistoryDate(raw) || raw;
}

function dayExpenseLines(src: DayCashSources): RouteExpenseLine[] {
  return expensesForCollectorDay(src.collectorRef, src.date, src.dayCloses, src.dayExpenseDrafts);
}

/** Clientes de la ruta: catálogo + visitas del cobrador ese día en esa ruta. */
export function routeClientRefsForDay(src: DayCashSources, routeName: string): Set<string> {
  const date = dateIsoOf(src.date);
  const refs = new Set(
    src.clients.filter((row) => sameRoute(row.route, routeName)).map((row) => row.ref),
  );
  for (const row of src.assignments) {
    if (row.collectorRef !== src.collectorRef || !row.clientRef) continue;
    if (dateIsoOf(row.dispatchDate) !== date) continue;
    if (sameRoute(assignmentRouteName(row, src.clients), routeName)) refs.add(row.clientRef);
  }
  return refs;
}

/** Cobrado ese día a clientes de la ruta, por medio de pago (nada de otras rutas). */
/** Cobros del día del cobrador a clientes de la ruta (todos los métodos). */
function routeDayPayments(src: DayCashSources, routeName: string): PaymentRow[] {
  const refs = routeClientRefsForDay(src, routeName);
  return collectorDayPayments(src.collectorRef, src.date, src.payments, src.collectors).filter(
    (pay) => {
      const loan = src.loans.find((row) => row.ref === pay.loanRef);
      return Boolean(loan?.clientRef && refs.has(loan.clientRef));
    },
  );
}

/** Cobros no efectivo (Banco / Nequi) del día a clientes de la ruta. */
export function routeDigitalPayments(src: DayCashSources, routeName: string): PaymentRow[] {
  return routeDayPayments(src, routeName).filter((pay) => {
    const method = normalizePaymentMethod(pay.method);
    return method === "nequi" || method === "banco";
  });
}

export function routeCollectedByMethod(
  src: DayCashSources,
  routeName: string,
): { efectivo: number; nequi: number; banco: number } {
  const out = { efectivo: 0, nequi: 0, banco: 0 };
  for (const pay of routeDayPayments(src, routeName)) {
    const amount = Number(pay.amount) || 0;
    const method = normalizePaymentMethod(pay.method);
    if (method === "nequi") out.nequi += amount;
    else if (method === "banco") out.banco += amount;
    else out.efectivo += amount;
  }
  return { efectivo: pesos(out.efectivo), nequi: pesos(out.nequi), banco: pesos(out.banco) };
}

/** Efectivo cobrado a clientes de la ruta (Nequi / banco no entran a la mano). */
export function routeCashCollected(src: DayCashSources, routeName: string): number {
  return routeCollectedByMethod(src, routeName).efectivo;
}

/** Reparto M↔T del día: préstamos por ruta del cliente; gastos por planilla donde se anotaron. */
export function chainRouteSplit(
  src: DayCashSources,
  side: ChainRouteSplit["side"],
): ChainRouteSplit {
  const ownCashClientRefs = new Set<string>();
  for (const route of INDEPENDENT_SALDO_ROUTES) {
    for (const ref of routeClientRefsForDay(src, route)) ownCashClientRefs.add(ref);
  }
  return {
    side,
    secondaryRoute: PLANILLA_CASH_CHAIN_SECONDARY,
    secondaryClientRefs: routeClientRefsForDay(src, PLANILLA_CASH_CHAIN_SECONDARY),
    ownCashClientRefs,
    ownCashFrom: INDEPENDENT_OWN_LOANS_FROM,
  };
}

function isOwnCashRoute(route: string) {
  return INDEPENDENT_SALDO_ROUTES.some((name) => sameRoute(route, name));
}

/** Mismo reparto M↔T para el Historial (varios días): clientes T del catálogo y de sus visitas. */
export function chainHistorySplit(
  side: ChainRouteSplit["side"],
  collectorRef: string,
  clients: ClientRow[],
  assignments: DailyCollectionAssignment[],
): ChainRouteSplit {
  const refs = new Set(
    clients
      .filter((row) => sameRoute(row.route, PLANILLA_CASH_CHAIN_SECONDARY))
      .map((row) => row.ref),
  );
  const ownCashClientRefs = new Set(
    clients.filter((row) => isOwnCashRoute(row.route)).map((row) => row.ref),
  );
  for (const row of assignments) {
    if (row.collectorRef !== collectorRef || !row.clientRef) continue;
    const route = assignmentRouteName(row, clients);
    if (sameRoute(route, PLANILLA_CASH_CHAIN_SECONDARY)) refs.add(row.clientRef);
    else if (isOwnCashRoute(route)) ownCashClientRefs.add(row.clientRef);
  }
  return {
    side,
    secondaryRoute: PLANILLA_CASH_CHAIN_SECONDARY,
    secondaryClientRefs: refs,
    ownCashClientRefs,
    ownCashFrom: INDEPENDENT_OWN_LOANS_FROM,
  };
}

/** Movimiento propio de una planilla de la cadena (M = principal, T = secundaria). */
function chainRouteDay(
  src: DayCashSources,
  side: ChainRouteSplit["side"],
  efectivo: number,
): RouteCashDay {
  const split = chainRouteSplit(src, side);
  const lines = dayExpenseLines(src);
  const gastoLines = lines.filter(
    (line) =>
      (Number(line.amount) || 0) > 0 &&
      !isPrestamoRutaExpense(line) &&
      operativeLineOnSide(line, split),
  );
  const loanRows = dayLoanDisbursementRows(dateIsoOf(src.date), lines, src.loans, src.clients, {
    collectorRef: src.collectorRef,
    assignments: src.assignments,
  }).filter((row) => loanClientOnSide(row.clientRef, split, dateIsoOf(src.date)));
  return {
    efectivo,
    gastos: sumExpenseLines(gastoLines),
    prestamos: pesos(dayLoanDisbursementTotal(loanRows)),
    gastoLines,
    loanRows,
  };
}

function assignmentOnChainSheet(src: DayCashSources, row: DailyCollectionAssignment): boolean {
  return (
    row.collectorRef === src.collectorRef &&
    isPlanillaCashChainRoute(assignmentRouteName(row, src.clients))
  );
}

/**
 * ¿El cobrador trabaja la cadena M↔T ese día?
 * Visitas M/T de ese día, o (si la hoja no está cargada) un cobrador que sí
 * trabaja M/T y ya tiene CIE-/PCE de ese día. Un PCE-T proyectado desde el
 * CIE- de Yesid no cuenta: él solo tiene N, N cierra N, nunca PCE-M/T.
 */
export function isChainCollectorDay(src: DayCashSources): boolean {
  const date = dateIsoOf(src.date);
  if (
    src.assignments.some(
      (row) => assignmentOnChainSheet(src, row) && dateIsoOf(row.dispatchDate) === date,
    )
  ) {
    return true;
  }
  if (!src.assignments.some((row) => assignmentOnChainSheet(src, row))) return false;
  if (
    src.planillaCashCloses.some(
      (row) => row.collectorRef === src.collectorRef && dateIsoOf(row.date) === date,
    )
  ) {
    return true;
  }
  return Boolean(findFullDayCieClose(src.dayCloses, src.collectorRef, date));
}

/** Inicial de M: CIE- de ayer manda (ver `openingCashForChainedPlanilla`). */
export function primaryOpeningForDay(src: DayCashSources): ChainOpeningResult {
  return openingCashForChainedPlanilla({
    collectorRef: src.collectorRef,
    routeName: PLANILLA_CASH_CHAIN_PRIMARY,
    date: dateIsoOf(src.date),
    records: src.planillaCashCloses,
    monthCloses: src.monthCloses,
    dayCloses: src.dayCloses,
    fallbackOpening: src.fallbackOpening,
  });
}

/** Movimiento propio de M y de T ese día (sin Inicial): lo mismo que suma el libro. */
export function chainDayMovements(src: DayCashSources): { m: RouteCashDay; t: RouteCashDay } {
  return {
    m: chainRouteDay(src, "primary", routeCashCollected(src, PLANILLA_CASH_CHAIN_PRIMARY)),
    t: chainRouteDay(src, "secondary", routeCashCollected(src, PLANILLA_CASH_CHAIN_SECONDARY)),
  };
}

export function buildDayCashLedger(src: DayCashSources): DayCashLedger {
  const date = dateIsoOf(src.date);
  const mOpening = primaryOpeningForDay(src);
  const opening = mOpening.kind === "chain" ? mOpening.opening : 0;
  const { m, t } = chainDayMovements(src);
  const mClosing = pesos(opening + m.efectivo - m.gastos - m.prestamos);
  return {
    collectorRef: src.collectorRef,
    date,
    chain: isChainCollectorDay(src),
    mOpening,
    m,
    mClosing,
    t,
    dayFinal: pesos(mClosing + t.efectivo - t.gastos - t.prestamos),
    cashAdjustment:
      findFullDayCieClose(src.dayCloses, src.collectorRef, date)?.cashAdjustment ?? null,
  };
}

/**
 * Caja final de M (= Inicial de T). Día con CIE-: saldo sellado (antes de un ajuste) menos el
 * movimiento propio de T, así Inicial T + movimiento T = CIE. Sin CIE: caja viva de M del libro.
 */
function primaryClosingOf(ledger: DayCashLedger, dayCloses: CollectorDayCloseRecord[]): number {
  const sealed = sealedDaySaldo(dayCloses, ledger.collectorRef, ledger.date);
  if (sealed != null) return pesos(sealed - (ledger.dayFinal - ledger.mClosing));
  return ledger.mClosing;
}

/** Saldo final sellado del día (CIE-), antes de un ajuste de saldo real. Sin CIE: null. */
export function sealedDaySaldo(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  date: string,
): number | null {
  const cie = findFullDayCieClose(dayCloses, collectorRef, dateIsoOf(date));
  if (!cie) return null;
  const sealed = Number(cie.cashAdjustment?.calculated ?? cie.cashFloat ?? cie.cashExpected);
  return Number.isFinite(sealed) ? pesos(sealed) : null;
}

/**
 * Historial · T: días ya cerrados leen su CIE- (saldo final del día). No se recalculan
 * con la caja de M + movimiento de T. Hoy lo pone `withLedgerTodaySaldo`.
 */
export function withSealedDaySaldos<T extends { date: string; saldo: number }>(
  rows: T[],
  collectorRef: string,
  dayCloses: CollectorDayCloseRecord[],
  todayIso: string,
): T[] {
  const today = dateIsoOf(todayIso);
  return rows.map((row) => {
    if (dateIsoOf(row.date) >= today) return row;
    const sealed = sealedDaySaldo(dayCloses, collectorRef, row.date);
    return sealed == null ? row : { ...row, saldo: sealed };
  });
}

/** Caja final de M de un día (Historial · M, fila de ayer). */
export function primaryClosingForDay(
  src: Omit<DayCashSources, "date">,
  date: string,
): number | null {
  if (!date) return null;
  const ledger = buildDayCashLedger({ ...src, date });
  if (!ledger.chain || ledger.mOpening.kind !== "chain") return null;
  return primaryClosingOf(ledger, src.dayCloses);
}

/** «Cierre del día» del Historial: M = la mañana; T = el día entero (M + T). */
export type ChainDayCuadre = {
  /** Inicial de la planilla abierta: M = CIE de la víspera; T = caja final de M (`primaryClosingOf`). */
  opening: number;
  /** Efectivo cobrado solo en la planilla abierta (M o T). */
  ownEfectivo: number;
  /** Préstamos solo de la planilla abierta (M o T). */
  ownPrestamos: number;
  /** Gastos operativos solo de la planilla abierta (M o T). */
  ownGastos: number;
  /** Banco / Nequi cobrado solo en la planilla abierta (M o T). No entra a la caja. */
  ownDigital: number;
  /** Cobros Banco / Nequi (renglones) que suma `ownDigital`. */
  ownDigitalPayments: PaymentRow[];
  efectivo: number;
  nequi: number;
  banco: number;
  /** Gastos y préstamos (renglones) que suma la caja. */
  lines: RouteExpenseLine[];
  /** Renglones «Préstamo · P-…» solo de la planilla abierta (M o T). */
  ownLoanLines: RouteExpenseLine[];
  /** Gastos operativos (renglones) solo de la planilla abierta (M o T). */
  ownGastoLines: RouteExpenseLine[];
  /** Libro: M = caja de M (Inicial de T); T = saldo final del día. */
  closing: number;
};

export function chainDayCuadre(
  src: DayCashSources,
  side: ChainRouteSplit["side"],
): ChainDayCuadre {
  const ledger = buildDayCashLedger(src);
  const days = side === "secondary" ? [ledger.m, ledger.t] : [ledger.m];
  const routes =
    side === "secondary"
      ? [PLANILLA_CASH_CHAIN_PRIMARY, PLANILLA_CASH_CHAIN_SECONDARY]
      : [PLANILLA_CASH_CHAIN_PRIMARY];
  const collected = routes.map((route) => routeCollectedByMethod(src, route));
  const own = collected[collected.length - 1];
  const primaryClosing = primaryClosingOf(ledger, src.dayCloses);
  return {
    opening:
      side === "secondary"
        ? primaryClosing
        : ledger.mOpening.kind === "chain"
          ? ledger.mOpening.opening
          : 0,
    ownEfectivo: pesos(side === "secondary" ? ledger.t.efectivo : ledger.m.efectivo),
    ownPrestamos: pesos(side === "secondary" ? ledger.t.prestamos : ledger.m.prestamos),
    ownGastos: pesos(side === "secondary" ? ledger.t.gastos : ledger.m.gastos),
    ownDigital: pesos(own.nequi + own.banco),
    ownDigitalPayments: routeDigitalPayments(src, routes[routes.length - 1]),
    efectivo: pesos(days.reduce((sum, day) => sum + day.efectivo, 0)),
    nequi: pesos(collected.reduce((sum, row) => sum + row.nequi, 0)),
    banco: pesos(collected.reduce((sum, row) => sum + row.banco, 0)),
    lines: days.flatMap((day) => [...day.gastoLines, ...loanRowsToExpenseLines(day.loanRows)]),
    ownLoanLines: loanRowsToExpenseLines(side === "secondary" ? ledger.t.loanRows : ledger.m.loanRows),
    ownGastoLines: side === "secondary" ? ledger.t.gastoLines : ledger.m.gastoLines,
    closing:
      side === "secondary"
        ? (sealedDaySaldo(src.dayCloses, src.collectorRef, ledger.date) ?? ledger.dayFinal)
        : primaryClosing,
  };
}

/**
 * Historial · T: la fila de hoy muestra el saldo final del libro (el mismo que la
 * tarjeta y el que sellará el CIE-). Días pasados no se tocan (leen su cierre).
 * Ninguna pantalla recalcula el saldo de hoy por su cuenta.
 */
export function withLedgerTodaySaldo<T extends { date: string; saldo: number }>(
  rows: T[],
  ledger: DayCashLedger,
): T[] {
  if (!ledger.chain) return rows;
  return rows.map((row) =>
    dateIsoOf(row.date) === ledger.date ? { ...row, saldo: ledger.dayFinal } : row,
  );
}

/** Saldo que sella el CIE- (`cash_float`) al cerrar la jornada. */
export type SealedDayCash = {
  openingCash: number;
  cashFloat: number;
};

/**
 * Cadena M↔T: saldo final del día (Inicial M de mañana).
 * Fuera de la cadena: caja menor del día (efectivo − gastos), como siempre;
 * su Inicial lo arrastra el historial, no el CIE-.
 */
export function sealedDayCash(src: DayCashSources, cashCollectedAllRoutes: number): SealedDayCash {
  const ledger = buildDayCashLedger(src);
  if (ledger.chain) {
    return {
      openingCash: ledger.mOpening.kind === "chain" ? ledger.mOpening.opening : 0,
      cashFloat: ledger.dayFinal,
    };
  }
  return {
    openingCash: 0,
    cashFloat: pesos(pesos(cashCollectedAllRoutes) - sumExpenseLines(dayExpenseLines(src))),
  };
}

/**
 * Eslabones PCE-M / PCE-T del día desde el libro (nunca desde el payload de la UI).
 * `routes`: qué hojas quedan selladas (M al cerrar M; M y T al cerrar T / 23:30).
 */
export function sealChainLinksFromLedger(
  records: PlanillaCashCloseRecord[],
  ledger: DayCashLedger,
  collectorName: string,
  routes: { m: boolean; t: boolean },
  closedAt = new Date().toISOString(),
): PlanillaCashCloseRecord[] {
  const opening = ledger.mOpening.kind === "chain" ? ledger.mOpening.opening : 0;
  let next = records;
  if (routes.m) {
    next = upsertPlanillaCashClose(next, {
      ref: planillaCashCloseRef(ledger.collectorRef, ledger.date, PLANILLA_CASH_CHAIN_PRIMARY),
      collectorRef: ledger.collectorRef,
      collectorName,
      date: ledger.date,
      routeName: PLANILLA_CASH_CHAIN_PRIMARY,
      openingCash: pesos(opening),
      closingCash: ledger.mClosing,
      closedAt,
    });
  }
  if (routes.t) {
    next = upsertPlanillaCashClose(next, {
      ref: planillaCashCloseRef(ledger.collectorRef, ledger.date, PLANILLA_CASH_CHAIN_SECONDARY),
      collectorRef: ledger.collectorRef,
      collectorName,
      date: ledger.date,
      routeName: PLANILLA_CASH_CHAIN_SECONDARY,
      openingCash: ledger.mClosing,
      closingCash: ledger.dayFinal,
      closedAt,
    });
  }
  return next;
}

/**
 * Eslabones ya sellados de ese día → misma cifra que el libro (cobros tardíos,
 * préstamo cargado después). No crea eslabones nuevos ni toca otros días.
 */
export function alignChainLinksToLedger(
  records: PlanillaCashCloseRecord[],
  ledger: DayCashLedger,
): PlanillaCashCloseRecord[] {
  const opening = ledger.mOpening.kind === "chain" ? pesos(ledger.mOpening.opening) : null;
  const mRef = planillaCashCloseRef(ledger.collectorRef, ledger.date, PLANILLA_CASH_CHAIN_PRIMARY);
  const tRef = planillaCashCloseRef(ledger.collectorRef, ledger.date, PLANILLA_CASH_CHAIN_SECONDARY);
  const tClosing = ledger.cashAdjustment ? pesos(ledger.cashAdjustment.real) : ledger.dayFinal;
  let changed = false;
  const next = records.map((row) => {
    if (row.ref === mRef) {
      const openingCash = opening ?? pesos(row.openingCash);
      if (pesos(row.openingCash) === openingCash && pesos(row.closingCash) === ledger.mClosing) {
        return row;
      }
      changed = true;
      return { ...row, openingCash, closingCash: ledger.mClosing };
    }
    if (row.ref === tRef) {
      if (pesos(row.openingCash) === ledger.mClosing && pesos(row.closingCash) === tClosing) {
        return row;
      }
      changed = true;
      return { ...row, openingCash: ledger.mClosing, closingCash: tClosing };
    }
    return row;
  });
  return changed ? next : records;
}
