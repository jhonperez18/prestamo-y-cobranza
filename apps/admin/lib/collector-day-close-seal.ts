/**
 * Sellado de cierre (hoja M/T o jornada completa) — un solo camino para
 * cobrador, panel y cierre del supervisor. Los saldos salen del libro de caja
 * del día (`day-cash-ledger`), nunca de montos enviados por la pantalla.
 */
import {
  dayExpenseLineMovementRef,
  expensesForCollectorDay,
  finalizeCollectorDayClose,
  removeDayExpenseDraft,
  upsertAndTrimCollectorDayClose,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import { collectorRecaudoBreakdown } from "@/lib/collector-mobile";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  buildDayCashLedger,
  sealChainLinksFromLedger,
  type DayCashLedger,
  type DayCashSources,
} from "@/lib/day-cash-ledger";
import { resolveSealedDayCash } from "@/lib/independent-route-cash";
import { sameRoute } from "@/lib/client-route-order";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow } from "@/lib/mock-data";
import {
  INDEPENDENT_SALDO_ROUTES,
  isPlanillaCashChainPrimary,
  isPlanillaCashChainRoute,
  isPlanillaCashChainSecondary,
  isPlanillaCashCloseRef,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";

export type SealCollectorDayInput = {
  collectorRef: string;
  collectorName: string;
  date: string;
  routeRef: string;
  /** Hoja que se cierra (M / T / A…). Sin hoja = jornada completa. */
  planillaRoute?: string;
  /** Solo si no hay CIE- previo ni PCE-T previo: Inicial que mostraba la hoja M. */
  openingCashHint?: number;
  /** Líneas de gasto de la pantalla si aún no hay borrador guardado. */
  expensesFallback: RouteExpenseLine[];
  /** Todas las visitas del cobrador para ese día ya cerradas. */
  fullyClosed: boolean;
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  planillaCashCloses: PlanillaCashCloseRecord[];
  monthCloses: CollectorMonthCloseRecord[];
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
};

export type SealCollectorDayResult = {
  ledger: DayCashLedger;
  planillaCashCloses: PlanillaCashCloseRecord[];
  /** Eslabones PCE- que cambiaron (para mirror). */
  sealedLinks: PlanillaCashCloseRecord[];
  record: CollectorDayCloseRecord | null;
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
};

export function sealCollectorDay(input: SealCollectorDayInput): SealCollectorDayResult {
  const dayCloses = input.dayCloses.filter((row) => !isPlanillaCashCloseRef(row.ref));
  const sources: DayCashSources = {
    collectorRef: input.collectorRef,
    collectorName: input.collectorName,
    date: input.date,
    payments: input.payments,
    loans: input.loans,
    clients: input.clients,
    collectors: input.collectors,
    assignments: input.assignments,
    dayCloses,
    dayExpenseDrafts: input.dayExpenseDrafts,
    planillaCashCloses: input.planillaCashCloses,
    monthCloses: input.monthCloses,
    fallbackOpening:
      input.openingCashHint != null && isPlanillaCashChainPrimary(input.planillaRoute)
        ? input.openingCashHint
        : undefined,
  };
  const ledger = buildDayCashLedger(sources);

  const closesT =
    input.fullyClosed || isPlanillaCashChainSecondary(input.planillaRoute);
  const closesChainSheet = isPlanillaCashChainRoute(input.planillaRoute);
  const closesIndependentSheet = INDEPENDENT_SALDO_ROUTES.some((name) =>
    sameRoute(input.planillaRoute, name),
  );
  let planillaCashCloses = input.planillaCashCloses;
  if (
    ledger.chain &&
    !closesIndependentSheet &&
    (closesChainSheet || input.fullyClosed)
  ) {
    planillaCashCloses = sealChainLinksFromLedger(
      planillaCashCloses,
      ledger,
      input.collectorName,
      { m: true, t: closesT },
    );
  }
  const sealedLinks = planillaCashCloses.filter(
    (row) => !input.planillaCashCloses.includes(row),
  );

  if (!input.fullyClosed) {
    return {
      ledger,
      planillaCashCloses,
      sealedLinks,
      record: null,
      dayCloses,
      dayExpenseDrafts: input.dayExpenseDrafts,
    };
  }

  const saved = expensesForCollectorDay(
    input.collectorRef,
    input.date,
    dayCloses,
    input.dayExpenseDrafts,
  );
  const lines = (saved.length ? saved : input.expensesFallback).filter((row) => row.amount > 0);
  const breakdown = collectorRecaudoBreakdown(
    input.collectorRef,
    input.date,
    input.payments,
    input.collectors,
  );
  const record = finalizeCollectorDayClose({
    draft: {
      collectorRef: input.collectorRef,
      collectorName: input.collectorName,
      date: input.date,
      routeRef: input.routeRef,
      collected: breakdown.total,
      expenses: lines,
    },
    lines,
    sealed: resolveSealedDayCash(sources, breakdown.efectivo, input.planillaRoute),
    movementRefs: lines.map((line) =>
      dayExpenseLineMovementRef(
        input.collectorRef,
        input.date,
        line.id,
        line.loanRef,
        line.route,
        line.lineKey,
      ),
    ),
  });

  return {
    ledger,
    planillaCashCloses,
    sealedLinks,
    record,
    dayCloses: upsertAndTrimCollectorDayClose(dayCloses, record),
    dayExpenseDrafts: removeDayExpenseDraft(
      input.dayExpenseDrafts,
      input.collectorRef,
      input.date,
    ),
  };
}
