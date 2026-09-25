/**
 * Regla de jornada:
 * - A las 23:30 (hora local) se cierra sola cualquier planilla aún abierta.
 * - A las 00:00 nace la planilla del día siguiente ya sin arrastre de abiertas.
 * - Quien no pagó a esa hora queda omitido; gastos no cargados no se inventan.
 * - “Cerrar día” manual se respeta: no se reabre solo antes de las 23:30.
 * - Cadena M↔T: al auto-cerrar se sellan PCE- de M y T (aunque T no tenga cobros)
 *   para que el día siguiente abra con saldos reales.
 */
import {
  alignDayClosesCollectedToPayments,
  applyDayCloseRecordsToAssignments,
  dayExpenseLineMovementRef,
  finalizeCollectorDayClose,
  findDayExpenseDraft,
  normalizeHistoryDate,
  openingSaldoForPeriod,
  periodFromDateIso,
  removeDayExpenseDraft,
  upsertAndTrimCollectorDayClose,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import { closeDispatchDay } from "@/lib/collector-dispatch-sync";
import { bumpMissedCollectionAlerts } from "@/lib/collection-alerts";
import { collectorRecaudoBreakdown, collectorRecaudoForDate } from "@/lib/collector-mobile";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import { pesos } from "@/lib/finance";
import { sameRoute } from "@/lib/client-route-order";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
  RouteRow,
} from "@/lib/mock-data";
import { normalizePaymentMethod } from "@/lib/payment-method";
import {
  isPlanillaCashCloseRef,
  PLANILLA_CASH_CHAIN_PRIMARY,
  PLANILLA_CASH_CHAIN_SECONDARY,
  sealMAndTCashChainForDay,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import {
  reconcilePaymentsOntoPlanilla,
  sealOpenVisitsWithLaterPayments,
} from "@/lib/planilla-payment-reconcile";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";

/** Hora local de corte: cierra la jornada antes de la planilla de medianoche. */
export const DAY_AUTO_CLOSE_AT = { hour: 23, minute: 30 } as const;

export type OperationalDayState = {
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  logs: CollectorDailyLogRow[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
  /** Saldos M↔T (PCE-). */
  planillaCashCloses?: PlanillaCashCloseRecord[];
  monthCloses?: CollectorMonthCloseRecord[];
};

export type OperationalDayResult = OperationalDayState & {
  /** Pares cobrador+fecha cerrados en este ciclo. */
  autoClosed: Array<{ collectorRef: string; date: string }>;
  planillaCashCloses: PlanillaCashCloseRecord[];
};

/** Día calendario anterior (ISO). */
export function previousCalendarIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return todayIso(dt);
}

/** Minutos desde medianoche en hora local. */
export function localMinutesSinceMidnight(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * True si la jornada de `dateIso` ya debió cerrarse:
 * - días anteriores a hoy, o
 * - hoy a partir de las 23:30.
 */
export function dayHasReachedAutoClose(dateIso: string, now = new Date()) {
  const date = normalizeHistoryDate(dateIso) || dateIso;
  if (!date) return false;
  const today = todayIso(now);
  if (date < today) return true;
  if (date > today) return false;
  const cutoff =
    DAY_AUTO_CLOSE_AT.hour * 60 + DAY_AUTO_CLOSE_AT.minute;
  return localMinutesSinceMidnight(now) >= cutoff;
}

/** Bloquea cobros nuevos cuando la jornada ya pasó el corte 23:30. */
export function isCollectorDayClosedForPayments(dateIso: string, now = new Date()) {
  return dayHasReachedAutoClose(dateIso, now);
}

function openCollectorDatePairs(
  assignments: DailyCollectionAssignment[],
  dayCloses: CollectorDayCloseRecord[],
  now: Date,
) {
  const closed = new Set(
    dayCloses.map(
      (row) => `${row.collectorRef}::${normalizeHistoryDate(row.date) || row.date}`,
    ),
  );
  const pairs = new Map<string, { collectorRef: string; date: string }>();

  for (const row of assignments) {
    const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
    const collectorRef = row.collectorRef;
    if (!date || !collectorRef) continue;
    if (!dayHasReachedAutoClose(date, now)) continue;
    if (row.dayClosedAt) continue;
    const key = `${collectorRef}::${date}`;
    if (closed.has(key)) continue;
    pairs.set(key, { collectorRef, date });
  }

  return [...pairs.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.collectorRef.localeCompare(b.collectorRef),
  );
}

function clientRefsOnRoute(clients: ClientRow[], routeName: string) {
  return new Set(
    clients.filter((row) => sameRoute(row.route, routeName)).map((row) => row.ref),
  );
}

function cashCollectedOnRoute(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  loans: LoanRow[],
  clientRefs: Set<string>,
) {
  let efectivo = 0;
  for (const pay of payments) {
    if (pay.collectorRef !== collectorRef) continue;
    if ((normalizeHistoryDate(pay.paidDate ?? "") || pay.paidDate) !== date) continue;
    const loan = loans.find((row) => row.ref === pay.loanRef);
    if (!loan?.clientRef || !clientRefs.has(loan.clientRef)) continue;
    const method = normalizePaymentMethod(pay.method);
    if (method === "nequi" || method === "banco") continue;
    efectivo += Number(pay.amount) || 0;
  }
  return pesos(efectivo);
}

function cashOutOnRoute(
  collectorRef: string,
  date: string,
  dayCloses: CollectorDayCloseRecord[],
  dayExpenseDrafts: CollectorDayExpenseDraft[],
  loans: LoanRow[],
  clientRefs: Set<string>,
  includeOperating: boolean,
) {
  const draft = findDayExpenseDraft(dayExpenseDrafts, collectorRef, date);
  const fromClose = dayCloses.find(
    (row) =>
      row.collectorRef === collectorRef &&
      (normalizeHistoryDate(row.date) || row.date) === date &&
      !isPlanillaCashCloseRef(row.ref),
  );
  const lines = (draft?.expenses?.length ? draft.expenses : fromClose?.expenses) ?? [];
  let gastos = 0;
  let prestamos = 0;
  for (const line of lines) {
    const amount = Number(line.amount) || 0;
    if (!(amount > 0)) continue;
    if (line.category === "prestamo_ruta" || line.id === "prestamo") {
      const loan = line.loanRef ? loans.find((row) => row.ref === line.loanRef) : undefined;
      if (loan?.clientRef && clientRefs.has(loan.clientRef)) prestamos += amount;
      continue;
    }
    if (includeOperating) gastos += amount;
  }
  return pesos(gastos + prestamos);
}

function carriedOpeningFallback(
  collectorRef: string,
  date: string,
  dayCloses: CollectorDayCloseRecord[],
  monthCloses: CollectorMonthCloseRecord[],
) {
  let best: CollectorDayCloseRecord | null = null;
  for (const row of dayCloses) {
    if (row.collectorRef !== collectorRef) continue;
    if (isPlanillaCashCloseRef(row.ref)) continue;
    const d = normalizeHistoryDate(row.date) || row.date;
    if (!d || d >= date) continue;
    if (!best || d > (normalizeHistoryDate(best.date) || best.date)) best = row;
  }
  if (best) return pesos(best.cashFloat ?? best.cashExpected ?? 0);
  return pesos(openingSaldoForPeriod(collectorRef, periodFromDateIso(date), monthCloses));
}

/**
 * Cierra jornadas vencidas (23:30 / días previos) y luego arma la planilla de hoy.
 * Una sola pasada operativa: sin arrastre de planillas abiertas al día nuevo.
 * El cierre manual (“Cerrar día”) se conserva hasta el rollover del día siguiente.
 * Sella M→T (PCE-) aunque T no tenga cobros, para iniciar el día siguiente con saldos reales.
 */
export function runOperationalDayCycle(
  state: OperationalDayState,
  now = new Date(),
): OperationalDayResult {
  const today = todayIso(now);
  let assignments = reconcilePaymentsOntoPlanilla(state.assignments, state.payments);
  assignments = sealOpenVisitsWithLaterPayments(assignments, state.payments, {
    untilDate: today,
  });

  let routes = state.routes;
  let logs = state.logs;
  let dayCloses = state.dayCloses;
  let dayExpenseDrafts = state.dayExpenseDrafts;
  let loans = state.loans;
  let planillaCashCloses = state.planillaCashCloses ?? [];
  const monthCloses = state.monthCloses ?? [];
  const autoClosed: Array<{ collectorRef: string; date: string }> = [];

  const pairs = openCollectorDatePairs(assignments, dayCloses, now);
  for (const pair of pairs) {
    const collector = state.collectors.find((row) => row.ref === pair.collectorRef);
    if (!collector) continue;

    const draft = findDayExpenseDraft(dayExpenseDrafts, pair.collectorRef, pair.date);
    const lines = (draft?.expenses ?? []).filter((row) => row.amount > 0);
    const collected = collectorRecaudoForDate(
      pair.collectorRef,
      pair.date,
      state.payments,
      state.collectors,
    );
    const cashCollected = collectorRecaudoBreakdown(
      pair.collectorRef,
      pair.date,
      state.payments,
      state.collectors,
    ).efectivo;
    const record = finalizeCollectorDayClose({
      draft: {
        collectorRef: pair.collectorRef,
        collectorName: collector.name,
        date: pair.date,
        routeRef: draft?.routeRef || `RUT-D-${pair.collectorRef}-${pair.date}`,
        collected,
        expenses: lines,
      },
      lines,
      cashCollected,
      movementRefs: lines.map((line) =>
        dayExpenseLineMovementRef(pair.collectorRef, pair.date, line.id, line.loanRef),
      ),
    });

    dayCloses = upsertAndTrimCollectorDayClose(dayCloses, record);
    dayExpenseDrafts = removeDayExpenseDraft(
      dayExpenseDrafts,
      pair.collectorRef,
      pair.date,
    );

    const closed = closeDispatchDay(
      assignments,
      routes,
      logs,
      pair.date,
      state.collectors,
      loans,
      state.clients,
      pair.collectorRef,
      state.payments,
    );
    assignments = closed.assignments;
    routes = closed.routes;
    logs = closed.logs;

    const alerted = bumpMissedCollectionAlerts(
      loans,
      closed.missedLoanRefs,
      pair.date,
      state.payments,
    );
    loans = alerted.loans;

    // Cadena M↔T: sella saldos aunque T no tenga cobros (arrastre puro).
    const mClients = clientRefsOnRoute(state.clients, PLANILLA_CASH_CHAIN_PRIMARY);
    const tClients = clientRefsOnRoute(state.clients, PLANILLA_CASH_CHAIN_SECONDARY);
    planillaCashCloses = sealMAndTCashChainForDay({
      collectorRef: pair.collectorRef,
      collectorName: collector.name,
      date: pair.date,
      records: planillaCashCloses,
      monthCloses,
      fallbackOpening: carriedOpeningFallback(
        pair.collectorRef,
        pair.date,
        dayCloses,
        monthCloses,
      ),
      primaryCashCollected: cashCollectedOnRoute(
        pair.collectorRef,
        pair.date,
        state.payments,
        loans,
        mClients,
      ),
      primaryCashOut: cashOutOnRoute(
        pair.collectorRef,
        pair.date,
        dayCloses,
        dayExpenseDrafts,
        loans,
        mClients,
        true,
      ),
      secondaryCashCollected: cashCollectedOnRoute(
        pair.collectorRef,
        pair.date,
        state.payments,
        loans,
        tClients,
      ),
      secondaryCashOut: cashOutOnRoute(
        pair.collectorRef,
        pair.date,
        dayCloses,
        dayExpenseDrafts,
        loans,
        tClients,
        false,
      ),
    });

    autoClosed.push(pair);
  }

  assignments = applyDayCloseRecordsToAssignments(assignments, dayCloses);

  const planilla = syncPermanentRoutePlanilla(
    today,
    routes,
    state.clients,
    loans,
    state.collectors,
    assignments,
    state.payments,
  );
  assignments = sealOpenVisitsWithLaterPayments(
    reconcilePaymentsOntoPlanilla(planilla.assignments, state.payments),
    state.payments,
    { untilDate: today },
  );
  assignments = applyDayCloseRecordsToAssignments(assignments, dayCloses);

  dayCloses = alignDayClosesCollectedToPayments(
    dayCloses,
    state.payments,
    state.collectors,
  );

  return {
    assignments,
    routes: planilla.routes,
    logs,
    dayCloses,
    dayExpenseDrafts,
    payments: state.payments,
    loans,
    clients: state.clients,
    collectors: state.collectors,
    planillaCashCloses,
    monthCloses,
    autoClosed,
  };
}
