/**
 * Regla de jornada:
 * - A las 23:30 (hora local) se cierra sola cualquier planilla aún abierta.
 * - A las 00:00 nace la planilla del día siguiente ya sin arrastre de abiertas.
 * - Quien no pagó a esa hora queda omitido; gastos no cargados no se inventan.
 * - “Cerrar día” manual se respeta: no se reabre solo antes de las 23:30.
 */
import {
  alignDayClosesCollectedToPayments,
  applyDayCloseRecordsToAssignments,
  dayExpenseLineMovementRef,
  finalizeCollectorDayClose,
  findDayExpenseDraft,
  normalizeHistoryDate,
  removeDayExpenseDraft,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import { closeDispatchDay } from "@/lib/collector-dispatch-sync";
import { bumpMissedCollectionAlerts } from "@/lib/collection-alerts";
import { collectorRecaudoForDate } from "@/lib/collector-mobile";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
  RouteRow,
} from "@/lib/mock-data";
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
};

export type OperationalDayResult = OperationalDayState & {
  /** Pares cobrador+fecha cerrados en este ciclo. */
  autoClosed: Array<{ collectorRef: string; date: string }>;
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

/**
 * Cierra jornadas vencidas (23:30 / días previos) y luego arma la planilla de hoy.
 * Una sola pasada operativa: sin arrastre de planillas abiertas al día nuevo.
 * El cierre manual (“Cerrar día”) se conserva hasta el rollover del día siguiente.
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
      movementRefs: lines.map((line) =>
        dayExpenseLineMovementRef(pair.collectorRef, pair.date, line.id),
      ),
    });

    dayCloses = [record, ...dayCloses.filter((row) => row.ref !== record.ref)];
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
    autoClosed,
  };
}
