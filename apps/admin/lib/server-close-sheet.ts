/**
 * Cierre de hoja calculado por el servidor (Fase Cierres, etapa 2a).
 * Mismos pasos que el cierre del cobrador (`closeCollectorDay`), pero con el estado de la nube:
 * el aparato manda la orden y el saldo lo saca el servidor. Función pura: no escribe nada.
 */
import {
  applyDayCloseRecordsToAssignments,
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
} from "@/lib/collector-day-close";
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { collectorDayVisitsFullyClosed, closeDispatchDay } from "@/lib/collector-dispatch-sync";
import { sealCollectorDay } from "@/lib/collector-day-close-seal";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  assertCanCloseChainedPlanilla,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";

export type ServerSheetCloseRequest = {
  collectorRef: string;
  date: string;
  /** Hoja que se cierra (M / T / A / N). Sin hoja = jornada completa. */
  route?: string;
  routeRef?: string;
};

export type ServerSheetClosePlan =
  | {
      ok: true;
      fullyClosed: boolean;
      /** CIE- de la jornada (solo si con esta hoja no queda ninguna abierta). */
      record: CollectorDayCloseRecord | null;
      /** Eslabones PCE- M / T que cambian. */
      sealedLinks: PlanillaCashCloseRecord[];
      /** Visitas del cobrador ese día que quedan selladas con este cierre. */
      sealedAssignments: DailyCollectionAssignment[];
      mClosing: number | null;
      dayFinal: number | null;
    }
  | { ok: false; error: string };

export function planServerSheetClose(
  state: OperationalDayState,
  request: ServerSheetCloseRequest,
): ServerSheetClosePlan {
  const date = normalizeHistoryDate(request.date) || request.date;
  const collector = state.collectors.find((row) => row.ref === request.collectorRef);
  if (!collector) return { ok: false, error: "collector_not_found" };
  const planillaCashCloses = state.planillaCashCloses ?? [];

  const chainGuard = assertCanCloseChainedPlanilla({
    collectorRef: request.collectorRef,
    routeName: request.route,
    date,
    records: planillaCashCloses,
    dayCloses: state.dayCloses,
    assignments: state.assignments,
    clients: state.clients,
  });
  if (!chainGuard.ok) return { ok: false, error: chainGuard.error };

  const closed = closeDispatchDay(
    state.assignments,
    state.routes,
    state.logs,
    date,
    state.collectors,
    state.loans,
    state.clients,
    request.collectorRef,
    state.payments,
    request.route,
  );
  const fullyClosed = collectorDayVisitsFullyClosed(
    closed.assignments,
    request.collectorRef,
    date,
  );

  const sealed = sealCollectorDay({
    collectorRef: request.collectorRef,
    collectorName: collector.name,
    date,
    routeRef: request.routeRef || `RUT-D-${request.collectorRef}-${date}`,
    planillaRoute: request.route,
    expensesFallback: [],
    fullyClosed,
    assignments: closed.assignments,
    dayCloses: state.dayCloses,
    dayExpenseDrafts: state.dayExpenseDrafts,
    planillaCashCloses,
    monthCloses: state.monthCloses ?? [],
    payments: state.payments,
    loans: state.loans,
    clients: state.clients,
    collectors: state.collectors,
  });

  const before = new Map(state.assignments.map((row) => [row.itemId, row.dayClosedAt]));
  const sealedAssignments = applyDayCloseRecordsToAssignments(
    closed.assignments,
    sealed.dayCloses,
  ).filter(
    (row) =>
      row.collectorRef === request.collectorRef &&
      (normalizeHistoryDate(row.dispatchDate) || row.dispatchDate) === date &&
      Boolean(row.dayClosedAt) &&
      !before.get(row.itemId),
  );

  return {
    ok: true,
    fullyClosed,
    record: sealed.record,
    sealedLinks: sealed.sealedLinks,
    sealedAssignments,
    mClosing: sealed.ledger.chain ? sealed.ledger.mClosing : null,
    dayFinal: sealed.ledger.chain ? sealed.ledger.dayFinal : null,
  };
}
