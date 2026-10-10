"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  attachCashAdjustments,
  cashAdjustmentDelta,
  cashAdjustmentNote,
} from "@/lib/cash-adjustment";
import { CollectorPayForm } from "@/components/CollectorPayForm";
import {
  attachRouteCashAdjustments,
  independentRouteDay,
  independentRouteDayLines,
  isIndependentSaldoRoute,
  withIndependentRouteHistory,
} from "@/lib/independent-route-cash";
import { useRouteCashBook } from "@/lib/use-route-cash-book";
import { QuickLoanForm } from "@/components/QuickLoanForm";
import type { QuickLoanDraft } from "@/lib/street-client-loan";
import { Pill } from "@/components/ui";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { CollectorNewClientSheet } from "@/components/CollectorNewClientSheet";
import type { RouteClientDraft } from "@/lib/commit-portfolio-catalog";
import { withPaymentEvidence } from "@/lib/payment-evidence-store";
import { isLatePayment, latePaymentNote, latePaymentTag } from "@/lib/late-payment";
import {
  collectorHasOpenPlanillaWork,
  collectorHasOpenRouteSheet,
  collectorMobileQueue,
  collectorMobileRoutes,
  collectorDayPayments,
  collectorRecaudoBreakdown,
  defaultMobileRouteDate,
  defaultOpenPlanillaRoute,
  keepOpenPlanillaRoute,
} from "@/lib/collector-mobile";
import {
  buildCollectorHistoryPlanillaRows,
  clientRefsLentOnDate,
  dayLoanDisbursementRows,
  dayLoanDisbursementTotal,
  expensesWithDayLoans,
  isPrestamoRutaExpense,
  loanRowsToExpenseLines,
  operativeExpenseLines,
  splitDayExpenses,
} from "@/lib/collector-history-planilla";
import { isSecondaryOperativeLine } from "@/lib/expense-lines";
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  money,
  catalogRoutes,
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import type { CollectorPaymentRegisterInput } from "@/lib/route-sync";
import { canRenewLoan, type RenewalTerms } from "@/lib/loan-renew";
import { reloanStateForVisit } from "@/lib/loan-reloan";
import {
  isCollectorLiveDevice,
  pullCollectorHistoryDay,
  syncCollectorLiveLoan,
} from "@/lib/collector-live-window";
import {
  assignmentRouteName,
  DECLINED_LOAN_OFFER_TODAY_REASON,
  dispatchRouteRef,
  NO_PAY_TODAY_REASON,
} from "@/lib/collector-dispatch-sync";
import {
  compareRouteNames,
  compareRoutePosition,
  routeBlockStarts,
  sameRoute,
} from "@/lib/client-route-order";
import {
  mergePaymentsByRef,
  pullRemotePaymentsIntoDemo,
} from "@/lib/supabase/payment-mirror";
import { suppressGhostClick, isNavQuiet } from "@/lib/suppress-ghost-click";
import { createNavIntent, navButtonProps } from "@/lib/nav-intent";
import {
  normalizePaymentMethod,
  paymentDisplayMethod,
  paymentMethodInitial,
  paymentMethodKind,
  paymentMethodLabel,
} from "@/lib/payment-method";
import { CuotasProgressCell } from "@/components/CuotasProgressCell";
import {
  isAssignmentAwaitingLoan,
  planillaLiveCuota,
  planillaLiveCuotasProgress,
} from "@/lib/planilla-display";
import { businessTodayIso } from "@/lib/business-timezone";
import type {
  RouteExpenseLine,
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import {
  COLLECTOR_HISTORY_KEEP_DAYS,
  buildCollectorDayHistory,
  expensesForCollectorDay,
  findMonthClose,
  isLastCalendarDayOfMonth,
  isLiveCashDay,
  monthClosingSaldoFromHistory,
  monthReviewBlock,
  normalizeHistoryDate,
  openingSaldoForPeriod,
  periodFromDateIso,
  periodHadCollectorActivity,
  previousPeriod,
} from "@/lib/collector-day-close";
import {
  annotateMHistoryExtractRows,
  applyCollectorCashHandSaldos,
  assertCanCloseChainedPlanilla,
  isPlanillaCashChainPrimary,
  isPlanillaCashChainRoute,
  isPlanillaCashChainSecondary,
  openingCashForChainedPlanilla,
  PLANILLA_CASH_CHAIN_HISTORY_EPOCH,
  PLANILLA_CASH_CHAIN_PRIMARY,
  ROUTE_CASH_BOOK_FROM,
  PLANILLA_CASH_CHAIN_SECONDARY,
  stampHistoryWithPlanillaCashChain,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import {
  buildDayCashLedger,
  chainHistorySplit,
  primaryClosingForDay,
  withLedgerTodaySaldo,
  withSealedDaySaldos,
} from "@/lib/day-cash-ledger";
import { CollectorDayCloseExtras } from "@/components/CollectorDayCloseExtras";
import { CollectorDayLoansPanel } from "@/components/CollectorDayLoansPanel";
import {
  dayDigitalLoanRows,
  dayPlanillaLoansWithoutPayment,
  digitalLoanPoolForRoute,
  digitalLoanPoolLabel,
} from "@/lib/day-digital-loans";
import {
  loanDisbursementSource,
  loanDisbursementSourceLabel,
  type LoanDisbursementSource,
} from "@/lib/nequi-pool";
import { CollectorCloseDayConfirm } from "@/components/CollectorCloseDayConfirm";
import { CollectorCloseDaySheet } from "@/components/CollectorCloseDaySheet";

export type CollectorSkipVisitDraft = {
  routeRef: string;
  clientRef: string;
  loanRef: string;
  dispatchDate: string;
  collectorRef: string;
  reason?: string;
};

export type CollectorCloseDayPayload = {
  date: string;
  routeRef: string;
  collectorRef: string;
  collectorName: string;
  /** Total del día (efectivo + Nequi). */
  collected: number;
  /** Solo efectivo → caja menor del cobrador. */
  collectedEfectivo: number;
  expenses: RouteExpenseLine[];
  /** Si hay varias hojas (1 / 1.1), cierra solo esa planilla. */
  planillaRoute?: string;
  /** Saldo inicial de la hoja (cadena M↔T o arrastre). */
  openingCash?: number;
  /** Salidas de caja de la hoja (gasto + préstamo efectivo). */
  cashOut?: number;
};

export type CollectorSaveExpensesPayload = {
  date: string;
  routeRef: string;
  collectorRef: string;
  collectorName: string;
  expenses: RouteExpenseLine[];
};

export type CollectorCloseMonthPayload = {
  period: string;
  collectorRef: string;
  collectorName: string;
  closingSaldo: number;
};

type Props = {
  collector: CollectorRow;
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  payments?: PaymentRow[];
  dayCloses?: CollectorDayCloseRecord[];
  dayExpenseDrafts?: CollectorDayExpenseDraft[];
  monthCloses?: CollectorMonthCloseRecord[];
  /** Cierres de saldo M↔T (solo cadena; A no entra). */
  planillaCashCloses?: PlanillaCashCloseRecord[];
  date?: string;
  preview?: boolean;
  canRegister?: boolean;
  onRegisterPayment?: (
    draft: CollectorPaymentRegisterInput,
  ) => boolean | void | Promise<boolean | void>;
  /** N/P: hoy no tiene plata. Sale de por cobrar y entra a S/N. */
  onSkipVisit?: (draft: CollectorSkipVisitDraft) => void;
  onRenewLoan?: (loanRef: string, terms: RenewalTerms) => void;
  onCreateQuickLoan?: (draft: QuickLoanDraft) => void;
  /** Menú ☰ → Nuevo cliente: alta igual que el taller en la ruta de la planilla abierta. */
  onCreateClient?: (draft: RouteClientDraft) => Promise<boolean> | boolean;
  onSaveExpenses?: (payload: CollectorSaveExpensesPayload) => void;
  onCloseDay?: (
    payload: CollectorCloseDayPayload,
  ) => boolean | void | Promise<boolean | void>;
  onCloseMonth?: (payload: CollectorCloseMonthPayload) => void;
  onLogout?: () => void;
};

type ListFilter = "pending" | "done";

function payerName(pay: PaymentRow, loans: LoanRow[], clients: ClientRow[]) {
  const direct = pay.client?.trim();
  if (direct && direct !== "—") return direct;
  const loan = loans.find((row) => row.ref === pay.loanRef);
  const fromLoan = loan?.client?.trim();
  if (fromLoan && fromLoan !== "—") return fromLoan;
  const client = clients.find((row) => row.ref === loan?.clientRef);
  if (client) {
    const name = `${client.name} ${client.lastName}`.trim();
    if (name) return name;
  }
  return "Cliente";
}

function itemKey(item: DailyCollectionAssignment) {
  return `${item.itemId}-${item.dispatchDate}`;
}

/** Vista compacta: #, nombre completo, apodo, saldo, cuota. */
function DayLoanListRow({
  loan,
  clientName,
  source,
  renewal,
}: {
  loan: LoanRow;
  clientName: string;
  source: LoanDisbursementSource | null;
  renewal: boolean;
}) {
  return (
    <li
      className={
        renewal
          ? "collector-mobile-card is-done is-dense is-renewed"
          : "collector-mobile-card is-done is-dense"
      }
    >
      <div className="collector-mobile-dense-row is-recaudo-row">
        <div className="collector-mobile-visit-who">
          <strong>{clientName}</strong>
        </div>
        <span className="is-done-loan">
          {renewal ? (
            <span
              className="collector-reloan-tag is-renewal"
              title={`Renovado ${loan.ref} · debía ${money(loan.capital)} + 20 % · sin plata · cuota desde mañana`}
            >
              Renovado {money(loan.capital, { symbol: false })}
            </span>
          ) : (
            <span
              className="collector-reloan-tag"
              title={`Préstamo ${loan.ref} · capital ${money(loan.capital)} · ${loanDisbursementSourceLabel(source)}`}
            >
              Préstamo {money(loan.capital, { symbol: false })}
            </span>
          )}
        </span>
        <span className="collector-mobile-ref is-done-col">—</span>
        {renewal ? (
          <Pill label="R" kind="renovado" title="Renovado: sin plata, no toca la caja" />
        ) : source === "efectivo" || source === "banco" || source === "nequi" ? (
          <Pill
            label={paymentMethodInitial(source)}
            kind={paymentMethodKind(source)}
            title={`Préstamo por ${loanDisbursementSourceLabel(source)}`}
          />
        ) : null}
      </div>
    </li>
  );
}

function visitIdentity(
  item: DailyCollectionAssignment,
  clients: ClientRow[],
  loans: LoanRow[],
  payments: PaymentRow[],
  today = todayIso(),
) {
  const client = clients.find((row) => row.ref === item.clientRef);
  // Sin préstamo cobrable = listo para prestar: sin cuota inventada ni billete.
  const awaitingLoan = isAssignmentAwaitingLoan(item);
  const rawLoan = awaitingLoan
    ? null
    : item.loanRef
      ? loans.find((row) => row.ref === item.loanRef) ?? null
      : null;
  const loan = rawLoan ? syncCollectorLiveLoan(rawLoan, payments, today) : null;
  const cuota = awaitingLoan ? 0 : planillaLiveCuota(item, loan, payments, today);
  const balance = awaitingLoan ? 0 : loan?.balance ?? 0;
  const cuotas = awaitingLoan
    ? null
    : planillaLiveCuotasProgress(loan, [], today);
  const first = client?.name?.trim() || "";
  const last = client?.lastName?.trim() || "";
  const fullName =
    [first, last].filter(Boolean).join(" ") ||
    item.clientName?.trim() ||
    "Cliente sin nombre";
  return {
    order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
    fullName,
    nickname: client?.nickname?.trim() || "",
    balance,
    cuota,
    loan,
    loanRef: awaitingLoan ? "" : loan?.ref ?? item.loanRef ?? "",
    awaitingLoan,
    cuotas,
  };
}

export function CollectorMobileApp({
  collector,
  assignments,
  routes,
  loans,
  clients,
  payments = [],
  dayCloses = [],
  dayExpenseDrafts = [],
  monthCloses = [],
  planillaCashCloses = [],
  date,
  preview = false,
  canRegister = true,
  onRegisterPayment,
  onSkipVisit,
  onRenewLoan,
  onCreateQuickLoan,
  onCreateClient,
  onSaveExpenses,
  onCloseDay,
  onCloseMonth,
  onLogout,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [payCombo, setPayCombo] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>("pending");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingExpenses, setEditingExpenses] = useState(false);
  const [reviewingLoans, setReviewingLoans] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  /** Hoja (día + planilla) que el cobrador eligió cerrar. El panel no se pasa a otra hoja. */
  const [closeTargetKey, setCloseTargetKey] = useState<string | null>(null);
  const closingDayRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planillaSearchOpen, setPlanillaSearchOpen] = useState(false);
  const [planillaQuery, setPlanillaQuery] = useState("");
  /** Planilla activa cuando el cobrador tiene más de una ruta (ej. 1 y 1.1). */
  const [planillaRouteFilter, setPlanillaRouteFilter] = useState<string | null>(null);
  /** Desde «Inicio» del cuadre → ir a la hoja de cobro (Por cobrar). */
  const [preferCobroPlanilla, setPreferCobroPlanilla] = useState(false);
  const [reloanPayRef, setReloanPayRef] = useState<string | null>(null);
  /** Hoja de Recaudo abierta desde «Banco»: solo los cobros que no son efectivo. */
  const [recaudoOnlyBanco, setRecaudoOnlyBanco] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [apiPayments, setApiPayments] = useState<PaymentRow[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const livePayments = useMemo(() => {
    if (!apiPayments.length) return payments;
    if (!payments.length) return apiPayments;
    return mergePaymentsByRef(payments, apiPayments).merged;
  }, [apiPayments, payments]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await pullRemotePaymentsIntoDemo();
        if (!cancelled && result.rows?.length) setApiPayments(result.rows);
      } catch (error) {
        console.error("collector-recaudo", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collector.ref]);

  const viewingDate = selectedDate || date || todayIso();
  useEffect(() => {
    if (!viewingDate || viewingDate === todayIso()) return;
    let cancelled = false;
    void pullCollectorHistoryDay(viewingDate).catch((error) => {
      if (!cancelled) console.error("collector-history-day", error);
    });
    return () => {
      cancelled = true;
    };
  }, [viewingDate]);

  // Inicio fijo en «Por cobrar»: con hoja de ruta abierta arranca en la lista de pendientes;
  // con la jornada cerrada esa misma pestaña muestra el cierre. Recaudo solo si el cobrador lo toca.
  const navIntent = useMemo(() => createNavIntent(), []);

  /** Cada cobrador es independiente: al cambiar, vuelve a su propio inicio (antes del paint). */
  useLayoutEffect(() => {
    setExpandedKey(null);
    setListFilter("pending");
    setSelectedDate(null);
    setEditingExpenses(false);
    setConfirmingClose(false);
    setHistoryOpen(false);
    setMenuOpen(false);
    setPlanillaRouteFilter(null);
    setPreferCobroPlanilla(false);
    setReloanPayRef(null);
  }, [collector.ref]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  const routeOptions = useMemo(
    () => collectorMobileRoutes(collector.ref, assignments, loans, clients, routes, dayCloses, livePayments),
    [assignments, clients, collector.ref, dayCloses, loans, livePayments, routes],
  );

  /** Pines 1 / 1.1…: rutas del catálogo asignadas a ESTE cobrador. */
  const planillaRoutePins = useMemo(
    () =>
      catalogRoutes(routes)
        .filter((row) => routeIsActive(row) && row.collectorRef === collector.ref)
        .slice()
        .sort((a, b) => compareRouteNames(a.name, b.name))
        .map((row) => row.name)
        .filter(Boolean),
    [routes, collector.ref],
  );

  useEffect(() => {
    if (planillaRoutePins.length <= 1) {
      setPlanillaRouteFilter(null);
      return;
    }
    const day = selectedDate ?? date ?? todayIso();
    setPlanillaRouteFilter((prev) =>
      keepOpenPlanillaRoute(prev, planillaRoutePins, assignments, day, clients),
    );
  }, [planillaRoutePins, assignments, clients, date, selectedDate]);

  const activeDate = useMemo(() => {
    const fallback = date ?? todayIso();
    if (selectedDate) return selectedDate;
    return defaultMobileRouteDate(routeOptions, fallback);
  }, [date, routeOptions, selectedDate]);

  useEffect(() => {
    setPlanillaQuery("");
    setPlanillaSearchOpen(false);
  }, [activeDate]);

  const viewPeriod = periodFromDateIso(activeDate);

  /** Caja real del cobrador (efectivo − gasto − préstamo). Misma base que Cierre del día. */
  const mCarriedFallbackOpening = useMemo(() => {
    const extraDates = [
      ...routeOptions.map((row) => row.date),
      date ?? todayIso(),
      activeDate,
    ];
    const rows = buildCollectorDayHistory(
      collector.ref,
      livePayments,
      dayCloses,
      [collector],
      extraDates,
      dayExpenseDrafts,
      monthCloses,
      viewPeriod,
      {
        assignments,
        rolling: true,
        loans,
        clients,
        includeOperatingExpenses: true,
      },
    );
    const ascending = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const prior = ascending.filter((row) => row.date < activeDate);
    if (prior.length) return prior[prior.length - 1].saldo;
    return openingSaldoForPeriod(collector.ref, viewPeriod, monthCloses);
  }, [
    activeDate,
    assignments,
    clients,
    collector,
    date,
    dayCloses,
    dayExpenseDrafts,
    livePayments,
    loans,
    monthCloses,
    routeOptions,
    viewPeriod,
  ]);

  /** Mapa fecha → Saldo en caja real (misma fuente que KPI Préstamo / ruta). */
  const collectorCashHandByDate = useMemo(() => {
    const extraDates = [
      ...routeOptions.map((row) => row.date),
      date ?? todayIso(),
      activeDate,
    ];
    const rows = buildCollectorDayHistory(
      collector.ref,
      livePayments,
      dayCloses,
      [collector],
      extraDates,
      dayExpenseDrafts,
      monthCloses,
      viewPeriod,
      {
        assignments,
        rolling: true,
        loans,
        clients,
        includeOperatingExpenses: true,
      },
    );
    return new Map(rows.map((row) => [row.date, row.saldo]));
  }, [
    activeDate,
    assignments,
    clients,
    collector,
    date,
    dayCloses,
    dayExpenseDrafts,
    livePayments,
    loans,
    monthCloses,
    routeOptions,
    viewPeriod,
  ]);

  const primaryClosingFor = useCallback(
    (dateIso: string) =>
      primaryClosingForDay(
        {
          collectorRef: collector.ref,
          collectorName: collector.name,
          payments: livePayments,
          loans,
          clients,
          collectors: [collector],
          assignments,
          dayCloses,
          dayExpenseDrafts,
          planillaCashCloses,
          monthCloses,
        },
        dateIso,
      ),
    [
      collector,
      livePayments,
      loans,
      clients,
      assignments,
      dayCloses,
      dayExpenseDrafts,
      planillaCashCloses,
      monthCloses,
    ],
  );

  /**
   * Ruta del Historial: la elegida si hay varias. Con una sola ruta y que sea A / N (Yesid)
   * es esa: su saldo es su caja propia (ajuste del supervisor + movimiento), no el del cobrador.
   */
  const historyRoute =
    planillaRoutePins.length > 1
      ? planillaRouteFilter ?? planillaRoutePins[0]
      : planillaRoutePins.length === 1 && isIndependentSaldoRoute(planillaRoutePins[0])
        ? planillaRoutePins[0]
        : null;

  /** Caja propia A / N del cobrador: los días pasados los da el servidor (el celular solo guarda hoy). */
  const cashBookRoute = planillaRoutePins.find((pin) => isIndependentSaldoRoute(pin)) ?? null;
  const cashBook = useRouteCashBook(collector.ref, cashBookRoute, `${todayIso()}|${activeDate}`);
  const cashBookFor = useCallback(
    (route: string | null | undefined) =>
      route && cashBookRoute && sameRoute(route, cashBookRoute) ? cashBook : null,
    [cashBook, cashBookRoute],
  );

  const dayHistory = useMemo(() => {
    const extraDates = [
      ...routeOptions.map((row) => row.date),
      date ?? todayIso(),
      activeDate,
    ];
    const routeForHistory = historyRoute;
    const scopedClients = routeForHistory
      ? new Set(
          clients
            .filter((row) => sameRoute(row.route, routeForHistory))
            .map((row) => row.ref),
        )
      : undefined;
    const isPrimaryHistory =
      !routeForHistory ||
      isPlanillaCashChainPrimary(routeForHistory) ||
      sameRoute(routeForHistory, planillaRoutePins[0] || "");
    const historyExtras = {
      assignments,
      rolling: true as const,
      clientRefs: scopedClients,
      loans,
      clients,
      includeOperatingExpenses: isPrimaryHistory,
      chainSplit: isPlanillaCashChainRoute(routeForHistory ?? undefined)
        ? chainHistorySplit(
            isPlanillaCashChainSecondary(routeForHistory ?? undefined) ? "secondary" : "primary",
      collector.ref,
            clients,
            assignments,
          )
        : undefined,
    };
    const base = buildCollectorDayHistory(
      collector.ref,
      livePayments,
      dayCloses,
      [collector],
      extraDates,
      dayExpenseDrafts,
      monthCloses,
      viewPeriod,
      historyExtras,
    );

    // Saldo final de M por día = misma cifra que Historial · M / ruta (T solo arrastra eso).
    // No pisar con cash-hand viejo: mBase ya trae préstamos reconstruidos.
    let primaryClosingByDate: Map<string, number> | undefined;
    if (isPlanillaCashChainSecondary(routeForHistory ?? undefined)) {
      const mBase = buildCollectorDayHistory(
        collector.ref,
        livePayments,
        dayCloses,
        [collector],
        extraDates,
        dayExpenseDrafts,
        monthCloses,
        viewPeriod,
        {
          assignments,
          rolling: true,
          loans,
          clients,
          includeOperatingExpenses: true,
          chainSplit: chainHistorySplit("primary", collector.ref, clients, assignments),
        },
      );
      const mAnnotated = annotateMHistoryExtractRows({
        rows: mBase,
        collectorRef: collector.ref,
        records: planillaCashCloses,
        epochBootstrapOpening: mCarriedFallbackOpening,
        todayIso: date ?? todayIso(),
        dayCloses,
        monthCloses,
        primaryClosingFor,
      });
      const mStamped = stampHistoryWithPlanillaCashChain({
        collectorRef: collector.ref,
        routeName: PLANILLA_CASH_CHAIN_PRIMARY,
        rows: mBase,
        records: planillaCashCloses,
        monthCloses,
        fallbackOpening: mCarriedFallbackOpening,
      });
      primaryClosingByDate = new Map();
      for (const row of mStamped) {
        const annotated = mAnnotated.find((entry) => entry.date === row.date);
        const saldo =
          annotated?.saldoShown != null && Number.isFinite(annotated.saldoShown)
            ? annotated.saldoShown
            : row.saldo;
        primaryClosingByDate.set(row.date, Number(saldo) || 0);
      }
    }

    const forChain = isPlanillaCashChainPrimary(routeForHistory ?? undefined)
      ? applyCollectorCashHandSaldos(base, collectorCashHandByDate)
      : base;
    const stamped = stampHistoryWithPlanillaCashChain({
      collectorRef: collector.ref,
      routeName: routeForHistory ?? undefined,
      rows: forChain,
      records: planillaCashCloses,
      monthCloses,
      fallbackOpening: mCarriedFallbackOpening,
      primaryClosingByDate,
    });
    if (routeForHistory && isIndependentSaldoRoute(routeForHistory)) {
      return withIndependentRouteHistory(
        stamped,
        {
          collectorRef: collector.ref,
          collectorName: collector.name,
          payments: livePayments,
          loans,
          clients,
          collectors: [collector],
          assignments,
          dayCloses,
          dayExpenseDrafts,
          planillaCashCloses,
          monthCloses,
        },
        routeForHistory,
        cashBookFor(routeForHistory),
      );
    }
    if (!isPlanillaCashChainSecondary(routeForHistory ?? undefined)) return stamped;
    const todayDate = date ?? todayIso();
    const todayLedger = buildDayCashLedger({
      collectorRef: collector.ref,
      collectorName: collector.name,
      date: todayDate,
      payments: livePayments,
      loans,
      clients,
      collectors: [collector],
      assignments,
      dayCloses,
      dayExpenseDrafts,
      planillaCashCloses,
      monthCloses,
      fallbackOpening:
        todayDate === PLANILLA_CASH_CHAIN_HISTORY_EPOCH ? mCarriedFallbackOpening : undefined,
    });
    return withLedgerTodaySaldo(
      withSealedDaySaldos(stamped, collector.ref, dayCloses, todayDate),
      todayLedger,
    );
  }, [
    activeDate,
    assignments,
    cashBookFor,
    clients,
    collector,
    collectorCashHandByDate,
    date,
    dayCloses,
    dayExpenseDrafts,
    historyRoute,
    loans,
    mCarriedFallbackOpening,
    monthCloses,
    livePayments,
    planillaCashCloses,
    planillaRoutePins,
    primaryClosingFor,
    routeOptions,
    viewPeriod,
  ]);

  const closedHistoryDates = useMemo(() => {
    const set = new Set<string>();
    const routeScope =
      planillaRoutePins.length > 1 ? planillaRouteFilter : null;
    for (const row of dayCloses) {
      if (row.collectorRef !== collector.ref) continue;
      const d = normalizeHistoryDate(row.date);
      if (d) set.add(d);
    }
    for (const row of planillaCashCloses) {
      if (row.collectorRef !== collector.ref) continue;
      if (routeScope && !sameRoute(row.routeName, routeScope)) continue;
      const d = normalizeHistoryDate(row.date);
      if (d) set.add(d);
    }
    for (const row of assignments) {
      if (row.collectorRef !== collector.ref || !row.dayClosedAt) continue;
      if (
        routeScope &&
        !sameRoute(assignmentRouteName(row, clients), routeScope)
      ) {
        continue;
      }
      const d = normalizeHistoryDate(row.dispatchDate);
      if (d) set.add(d);
    }
    return set;
  }, [
    assignments,
    clients,
    collector.ref,
    dayCloses,
    planillaCashCloses,
    planillaRouteFilter,
    planillaRoutePins.length,
  ]);

  const activePeriod = viewPeriod;
  const previousMonth = previousPeriod(activePeriod);
  const priorMonthHadActivity = periodHadCollectorActivity(
    collector.ref,
    previousMonth,
    livePayments,
    dayCloses,
    dayExpenseDrafts,
    [collector],
  );
  const monthBlock = monthReviewBlock({
    collectorRef: collector.ref,
    date: activeDate,
    monthCloses,
    priorMonthHadActivity,
    dayCloses,
  });
  const paymentsBlocked = Boolean(monthBlock);
  const canCollect = canRegister && !paymentsBlocked;

  const monthAlreadyClosed = Boolean(findMonthClose(monthCloses, collector.ref, activePeriod));
  const showSaveMonth =
    Boolean(onCloseMonth) &&
    isLastCalendarDayOfMonth(activeDate) &&
    !monthAlreadyClosed;
  const monthSaldoToSave = monthClosingSaldoFromHistory(
    dayHistory,
    openingSaldoForPeriod(collector.ref, activePeriod, monthCloses),
  );
  const priorMonthClosingSaldo = useMemo(() => {
    const rows = buildCollectorDayHistory(
      collector.ref,
      livePayments,
      dayCloses,
      [collector],
      [],
      dayExpenseDrafts,
      monthCloses,
      previousMonth,
      { assignments },
    );
    return monthClosingSaldoFromHistory(
      rows,
      openingSaldoForPeriod(collector.ref, previousMonth, monthCloses),
    );
  }, [assignments, collector, dayCloses, dayExpenseDrafts, livePayments, monthCloses, previousMonth]);

  const activeRoute =
    routeOptions.find((row) => row.date === activeDate) ??
    routeOptions[0] ??
    null;

  const queue = useMemo(
    () =>
      collectorMobileQueue(
        collector.ref,
        activeDate,
        assignments,
        loans,
        clients,
        routes,
        dayCloses,
        livePayments,
      ),
    [activeDate, assignments, clients, collector.ref, dayCloses, livePayments, loans, routes],
  );

  /** Ruta de planilla seleccionada (null = una sola ruta / sin pines). */
  const activePlanillaRoute =
    planillaRoutePins.length > 1 ? planillaRouteFilter : null;
  const activeCloseKey = `${activeDate}|${activePlanillaRoute ?? ""}`;
  // Cerrada M, la app pasa sola a T: el panel de M no puede quedar abierto apuntando a T
  // (caso 07/10: un segundo toque en «Confirmar» cerró T sin que nadie lo pidiera).
  useEffect(() => {
    if (confirmingClose && closeTargetKey !== activeCloseKey) setConfirmingClose(false);
  }, [activeCloseKey, closeTargetKey, confirmingClose]);
  const isPrimaryPlanilla =
    !activePlanillaRoute || sameRoute(activePlanillaRoute, planillaRoutePins[0] || "");
  /** A cobra solo Efectivo y Nequi: lo que no es efectivo se muestra como Nequi. */
  const planillaIsA = sameRoute(activePlanillaRoute ?? planillaRoutePins[0] ?? "", "A");
  /** N: cabecera Inicial · Recaudo · Total día · Caja; Banco en la fila de KPI. */
  const planillaIsN = sameRoute(activePlanillaRoute ?? planillaRoutePins[0] ?? "", "N");
  /** Ruta fija del «Nuevo cliente»: la planilla que está abierta. */
  const newClientRoute = activePlanillaRoute ?? planillaRoutePins[0] ?? "";
  /** M / T: Cuadre sin Nequi (lo no efectivo es Banco) y Total = efectivo − préstamos − gastos. */
  const planillaIsChain =
    sameRoute(activePlanillaRoute ?? planillaRoutePins[0] ?? "", "M") ||
    sameRoute(activePlanillaRoute ?? planillaRoutePins[0] ?? "", "T");

  /**
   * Libro de caja del día (único dueño del saldo): Inicial M = CIE de ayer;
   * caja viva de M = Inicial de T. Misma cifra que supervisor, panel y cierre.
   */
  const dayLedger = useMemo(
    () =>
      buildDayCashLedger({
        collectorRef: collector.ref,
        collectorName: collector.name,
        date: activeDate,
        payments: livePayments,
        loans,
        clients,
        collectors: [collector],
        assignments,
        dayCloses,
        dayExpenseDrafts,
        planillaCashCloses,
        monthCloses,
        fallbackOpening:
          activeDate === PLANILLA_CASH_CHAIN_HISTORY_EPOCH
            ? mCarriedFallbackOpening
            : undefined,
      }),
    [
      activeDate,
      assignments,
      clients,
      collector,
      dayCloses,
      dayExpenseDrafts,
      livePayments,
      loans,
      mCarriedFallbackOpening,
      monthCloses,
      planillaCashCloses,
    ],
  );
  const primaryLiveClosing = dayLedger.mClosing;

  const chainOpening = useMemo(
    () =>
      openingCashForChainedPlanilla({
        collectorRef: collector.ref,
        routeName: activePlanillaRoute ?? undefined,
        date: activeDate,
        records: planillaCashCloses,
        monthCloses,
        dayCloses,
        primaryLiveClosing: isPlanillaCashChainSecondary(activePlanillaRoute ?? undefined)
          ? primaryLiveClosing
          : undefined,
        fallbackOpening:
          activeDate === PLANILLA_CASH_CHAIN_HISTORY_EPOCH
            ? mCarriedFallbackOpening
            : undefined,
      }),
    [
      activeDate,
      activePlanillaRoute,
      collector.ref,
      dayCloses,
      mCarriedFallbackOpening,
      monthCloses,
      planillaCashCloses,
      primaryLiveClosing,
    ],
  );
  const chainCloseGuard = useMemo(
    () =>
      assertCanCloseChainedPlanilla({
        collectorRef: collector.ref,
        routeName: activePlanillaRoute ?? undefined,
        date: activeDate,
        records: planillaCashCloses,
        dayCloses,
        assignments,
        clients,
      }),
    [activeDate, activePlanillaRoute, assignments, clients, collector.ref, dayCloses, planillaCashCloses],
  );

  const carriedOpening = openingSaldoForPeriod(collector.ref, viewPeriod, monthCloses);

  const routeClientRefs = useMemo(() => {
    if (!activePlanillaRoute) return null as Set<string> | null;
    const refs = new Set(
      clients
        .filter((row) => sameRoute(row.route, activePlanillaRoute))
        .map((row) => row.ref),
    );
    for (const row of queue.dispatched) {
      if (
        row.clientRef &&
        sameRoute(assignmentRouteName(row, clients), activePlanillaRoute)
      ) {
        refs.add(row.clientRef);
      }
    }
    return refs;
  }, [activePlanillaRoute, clients, queue.dispatched]);

  const onActivePlanilla = (item: DailyCollectionAssignment) => {
    if (!activePlanillaRoute) return true;
    return sameRoute(assignmentRouteName(item, clients), activePlanillaRoute);
  };

  const routeDispatched = useMemo(
    () => queue.dispatched.filter(onActivePlanilla),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onActivePlanilla cierra sobre activePlanillaRoute/clients
    [queue.dispatched, activePlanillaRoute, clients],
  );
  const routePending = useMemo(
    () => queue.pending.filter(onActivePlanilla),
    [queue.pending, activePlanillaRoute, clients],
  );
  const routePendingCollectCount = routePending.filter(
    (row) => !isAssignmentAwaitingLoan(row),
  ).length;

  const planillaLocked =
    routeDispatched.length > 0 &&
    routeDispatched.every((row) => Boolean(row.dayClosedAt));
  const dayWasClosedByCollector = activePlanillaRoute
    ? planillaLocked
    : queue.closed;
  const dayLocked = dayWasClosedByCollector;
  const today = date ?? todayIso();
  const isPastOpenDay = !dayLocked && activeDate < today;
  const canCloseDay =
    Boolean(onCloseDay) &&
    !dayLocked &&
    routeDispatched.length > 0 &&
    chainCloseGuard.ok;
  /** No más cobros si la planilla cerró o ya no hay pendientes en esta hoja. */
  const collectionStopped =
    dayLocked || (routeDispatched.length > 0 && routePendingCollectCount === 0);

  const routeRef = queue.routeRef ?? dispatchRouteRef(collector.ref, activeDate);
  const visibleItems = listFilter === "done" ? queue.done : routePending;
  /** La ficha de cada fila no cambia al abrir/cerrar un panel: solo cuando cambian los datos. */
  const visibleIdentities = useMemo(
    () => visibleItems.map((item) => visitIdentity(item, clients, loans, livePayments, activeDate)),
    [visibleItems, clients, loans, livePayments, activeDate],
  );
  const recaudo = useMemo(
    () => collectorRecaudoBreakdown(collector.ref, activeDate, livePayments, [collector]),
    [activeDate, collector, livePayments],
  );
  const dayPays = useMemo(
    () =>
      collectorDayPayments(collector.ref, activeDate, livePayments, [collector])
        .slice()
        .sort((a, b) =>
          payerName(a, loans, clients).localeCompare(payerName(b, loans, clients), "es"),
        ),
    [activeDate, clients, collector, livePayments, loans],
  );
  const routeDayPays = useMemo(() => {
    if (!routeClientRefs) return dayPays;
    return dayPays.filter((pay) => {
      const loan = loans.find((row) => row.ref === pay.loanRef);
      return Boolean(loan?.clientRef && routeClientRefs.has(loan.clientRef));
    });
  }, [dayPays, loans, routeClientRefs]);
  /** Recaudo de la planilla activa (ruta 1.1 sin PG- = ceros, sin inventar). */
  const planillaRecaudo = useMemo(() => {
    if (!activePlanillaRoute) return recaudo;
    let efectivo = 0;
    let nequi = 0;
    let banco = 0;
    for (const row of routeDayPays) {
      const amount = Number(row.amount) || 0;
      const method = normalizePaymentMethod(row.method);
      if (method === "nequi") nequi += amount;
      else if (method === "banco") banco += amount;
      else efectivo += amount;
    }
    return {
      efectivo,
      nequi,
      banco,
      digital: nequi + banco,
      total: efectivo + nequi + banco,
      count: routeDayPays.length,
    };
  }, [activePlanillaRoute, routeDayPays, recaudo]);
  const planillaNequiShown = planillaIsA ? planillaRecaudo.digital : planillaRecaudo.nequi;
  /** Primer PG- del día por crédito: ahí va el botón / etiqueta «Préstamo». */
  const reloanAnchorByLoan = useMemo(() => {
    const anchor = new Map<string, string>();
    for (const pay of dayPays) {
      if (pay.loanRef && !anchor.has(pay.loanRef)) anchor.set(pay.loanRef, pay.ref);
    }
    return anchor;
  }, [dayPays]);

  const savedExpensesRaw = useMemo(
    () => expensesForCollectorDay(collector.ref, activeDate, dayCloses, dayExpenseDrafts),
    [activeDate, collector.ref, dayCloses, dayExpenseDrafts],
  );
  const loanScope = useMemo(() => {
    // Desembolsos de la jornada del cobrador (KPI solo se muestra en planilla M).
    const dayRows = assignments.filter((row) => row.collectorRef === collector.ref);
    return {
      collectorRef: collector.ref,
      assignments: dayRows,
      liveDay: isLiveCashDay(collector.ref, activeDate, dayCloses, businessTodayIso()),
    };
  }, [activeDate, assignments, collector.ref, dayCloses]);
  /** Gastos + desembolsos en efectivo del día (reconstruye si el cierre perdió la línea). */
  const savedExpenses = useMemo(
    () =>
      expensesWithDayLoans(activeDate, savedExpensesRaw, loans, clients, loanScope),
    [activeDate, savedExpensesRaw, loans, clients, loanScope],
  );
  const savedExpensesTotal = savedExpenses.reduce((sum, row) => sum + row.amount, 0);
  /** Capital prestado hoy en efectivo (sale del efectivo cobrado). */
  const prestadoEfectivo = useMemo(
    () => dayLoanDisbursementTotal(dayLoanDisbursementRows(activeDate, savedExpensesRaw, loans, clients, loanScope)),
    [activeDate, savedExpensesRaw, loans, clients, loanScope],
  );

  const dayCuadre = useMemo(() => {
    const periodOpening = openingSaldoForPeriod(collector.ref, viewPeriod, monthCloses);
    const ascending = [...dayHistory].sort((a, b) => a.date.localeCompare(b.date));
    const todayRow = ascending.find((row) => row.date === activeDate);
    const prior = ascending.filter((row) => row.date < activeDate);
    const saldoInicial = prior.length ? prior[prior.length - 1].saldo : periodOpening;
    const cobrado = recaudo.total;
    const gastos =
      todayRow != null
        ? todayRow.gasto + todayRow.prestamo
        : savedExpensesTotal;
    // Caja del cobrador: solo efectivo. Nequi no entra a su mano.
    const saldo = saldoInicial + recaudo.efectivo - gastos;
    return {
      saldoInicial,
      cobrado,
      cobradoEfectivo: recaudo.efectivo,
      cobradoNequi: recaudo.nequi,
      cobradoBanco: recaudo.banco,
      gastos,
      saldo,
    };
  }, [
    activeDate,
    collector.ref,
    dayHistory,
    monthCloses,
    recaudo.total,
    recaudo.efectivo,
    recaudo.nequi,
    recaudo.banco,
    savedExpensesTotal,
    viewPeriod,
  ]);

  // Solo al cambiar de día: no cerrar el cobro al tocar la misma pestaña.
  useEffect(() => {
    setExpandedKey(null);
    setEditingExpenses(false);
    setReviewingLoans(false);
    setConfirmingClose(false);
  }, [activeDate]);

  function togglePay(item: DailyCollectionAssignment) {
    if (dayLocked || !canCollect) return;
    const awaitingLoan = isAssignmentAwaitingLoan(item);
    // Cobros: si ya no hay pendientes de cuota, no abrir billete.
    // Préstamo nuevo (Prestar): sigue activo aunque no queden cobros.
    if (awaitingLoan) {
      if (!onCreateQuickLoan) return;
    } else if (collectionStopped || !onRegisterPayment) {
      return;
    }
    const key = itemKey(item);
    // Billete = solo ABRIR. Cerrar es «cerrar» / confirmar.
    // Si toggléa, el click fantasma tras el reflow cierra el panel al instante.
    if (expandedKey === key) return;
    suppressGhostClick(720);
    setPayCombo(false);
    setReviewingLoans(false);
    setExpandedKey(key);
  }

  function closeCard(force = false) {
    // Eco del billete suele caer en «cerrar» justo al abrir: ignorar.
    // Confirmar es gesto del cobrador: no dejarlo preso en la firma.
    if (!force && isNavQuiet()) return;
    if (!force) suppressGhostClick(420);
    setExpandedKey(null);
  }

  function selectFilter(next: ListFilter) {
    if (isNavQuiet()) return;
    setEditingExpenses(false);
    setReviewingLoans(false);
    setConfirmingClose(false);
    // Misma pestaña: no resetear (evita que un click fantasma al abrir cobro cierre el panel).
    if (next === listFilter) return;
    suppressGhostClick(420);
    setListFilter(next);
    setExpandedKey(null);
  }

  function openExpenses() {
    if (isNavQuiet()) return;
    // Jornada cerrada: solo lectura, sin acceso a listas ni edición.
    if (dayLocked) return;
    if (!planillaOwnsMovements) return;
    if (!onSaveExpenses) return;
    setExpandedKey(null);
    setConfirmingClose(false);
    setReviewingLoans(false);
    setEditingExpenses(true);
  }

  function openLoansDetail() {
    if (isNavQuiet()) return;
    if (dayLocked) return;
    setExpandedKey(null);
    setConfirmingClose(false);
    setEditingExpenses(false);
    setReviewingLoans(true);
  }

  function openRecaudoDetail(onlyBanco = false) {
    // Jornada cerrada: sin acceso a detalle de cobros.
    if (dayLocked || isNavQuiet()) return;
    setRecaudoOnlyBanco(onlyBanco);
    selectFilter("done");
  }

  function saveExpenses(expenses: RouteExpenseLine[]) {
    if (!onSaveExpenses) return;
    // Conservar desembolsos de préstamo (no se editan en el sheet de gastos).
    const prestamos = savedExpenses.filter((row) => isPrestamoRutaExpense(row));
    // Gastos de la otra planilla de la cadena quedan intactos; los de T llevan su marca.
    const otherPlanilla = operativeExpenseLines(savedExpensesRaw).filter(
      (row) =>
        isSecondaryOperativeLine(row, PLANILLA_CASH_CHAIN_SECONDARY) !== onSecondaryChainPlanilla,
    );
    const operativos = operativeExpenseLines(expenses).map((row) =>
      onSecondaryChainPlanilla ? { ...row, route: PLANILLA_CASH_CHAIN_SECONDARY } : row,
    );
    onSaveExpenses({
      date: activeDate,
      routeRef,
      collectorRef: collector.ref,
      collectorName: collector.name,
      expenses: [...prestamos, ...otherPlanilla, ...operativos],
    });
    setEditingExpenses(false);
  }

  function openCloseConfirm() {
    if (!onCloseDay || dayLocked) return;
    if (!routeDispatched.length) return;
    if (!chainCloseGuard.ok) {
      setConfirmingClose(false);
      return;
    }
    setMenuOpen(false);
    setExpandedKey(null);
    setEditingExpenses(false);
    setReviewingLoans(false);
    setCloseTargetKey(activeCloseKey);
    setConfirmingClose(true);
  }

  function openHistory() {
    setMenuOpen(false);
    setHistoryOpen(true);
  }

  function openNewClient() {
    setMenuOpen(false);
    setExpandedKey(null);
    setEditingExpenses(false);
    setReviewingLoans(false);
    setConfirmingClose(false);
    setCreatingClient(true);
  }

  async function saveNewClient(draft: RouteClientDraft) {
    if (!onCreateClient) return false;
    const ok = await onCreateClient(draft);
    if (ok) {
      setCreatingClient(false);
      setListFilter("pending");
    }
    return ok;
  }

  function confirmCloseDay() {
    if (!onCloseDay || dayLocked || closingDayRef.current) return;
    if (!chainCloseGuard.ok || closeTargetKey !== activeCloseKey) {
      setConfirmingClose(false);
      return;
    }
    closingDayRef.current = true;
    setConfirmingClose(false);
    const cashOut = topGastos + topPrestamos;
    const openingForClose =
      chainOpening.kind === "chain"
        ? chainOpening.opening
        : dayCuadre.saldoInicial;
    const payload: CollectorCloseDayPayload = {
      date: activeDate,
      routeRef,
      collectorRef: collector.ref,
      collectorName: collector.name,
      collected: planillaRecaudo.total,
      collectedEfectivo: planillaRecaudo.efectivo,
      // T / A: no reenviar desembolsos de M (el saldo ya los descontó al cerrar M).
      expenses: isPrimaryPlanilla ? savedExpenses : [],
      planillaRoute: activePlanillaRoute ?? undefined,
      openingCash: openingForClose,
      cashOut,
    };
    void (async () => {
      try {
        const ok = await onCloseDay(payload);
        if (ok === false) return;
      } catch (error) {
        console.error("collector-close-day", error);
        return;
      } finally {
        closingDayRef.current = false;
      }
      setListFilter("pending");
      setPreferCobroPlanilla(false);
      setSelectedDate(null);
    })();
  }

  function confirmCloseMonth() {
    if (!onCloseMonth || !showSaveMonth) return;
    onCloseMonth({
      period: activePeriod,
      collectorRef: collector.ref,
      collectorName: collector.name,
      closingSaldo: monthSaldoToSave,
    });
  }

  const reviewingPanel = editingExpenses || confirmingClose || reviewingLoans;
  const todayHasOpenSheet = collectorHasOpenRouteSheet(
    planillaRoutePins,
    assignments,
    activeDate,
    clients,
    dayCloses,
    collector.ref,
  );
  /**
   * Sin planilla abierta → mismo inicio (último cierre + saldo) para todos los cobradores.
   * Hoja elegida ya cerrada (M con T/A abiertas) → su cierre; los pines siguen para volver a T/A.
   */
  const showHomeCuadre =
    !preferCobroPlanilla &&
    listFilter === "pending" &&
    !editingExpenses &&
    !reviewingLoans &&
    !confirmingClose &&
    (activePlanillaRoute && planillaLocked
      ? true
      : !todayHasOpenSheet &&
        (activePlanillaRoute
          ? routeDispatched.length === 0 &&
            !collectorHasOpenPlanillaWork(queue) &&
            queue.closed
          : !collectorHasOpenPlanillaWork(queue)));
  const chromeLocked = dayLocked || showHomeCuadre;

  /** Cadena M↔T: préstamos y gastos propios de la planilla activa (libro del día). */
  const chainPlanillaDay = !dayLedger.chain
    ? null
    : isPlanillaCashChainSecondary(activePlanillaRoute ?? undefined)
      ? dayLedger.t
      : isPlanillaCashChainPrimary(activePlanillaRoute ?? undefined)
        ? dayLedger.m
        : null;
  const onSecondaryChainPlanilla = chainPlanillaDay != null && chainPlanillaDay === dayLedger.t;
  /**
   * A / N: caja propia de la planilla (misma cifra que el supervisor).
   * N de Yesid arrastra el historial; el neto del CIE- no es el Inicial.
   */
  const saldoRouteName =
    activePlanillaRoute ?? (planillaRoutePins.length === 1 ? planillaRoutePins[0] : null);
  const ownRouteDay = useMemo(() => {
    if (!saldoRouteName || !isIndependentSaldoRoute(saldoRouteName)) return null;
    return independentRouteDay(
      {
        collectorRef: collector.ref,
        collectorName: collector.name,
        date: activeDate,
        payments: livePayments,
        loans,
        clients,
        collectors: [collector],
        assignments,
        dayCloses,
        dayExpenseDrafts,
        planillaCashCloses,
        monthCloses,
      },
      saldoRouteName,
      cashBookFor(saldoRouteName),
    );
  }, [
    saldoRouteName,
    cashBookFor,
    collector,
    activeDate,
    livePayments,
    loans,
    clients,
    assignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses,
    monthCloses,
  ]);
  /** M o T de la cadena, o la planilla principal fuera de ella: ahí se anotan préstamos y gastos. */
  const planillaOwnsMovements = isPrimaryPlanilla || onSecondaryChainPlanilla;
  const planillaExpenses = useMemo(
    () =>
      chainPlanillaDay
        ? [...chainPlanillaDay.gastoLines, ...loanRowsToExpenseLines(chainPlanillaDay.loanRows)]
        : ownRouteDay
          ? independentRouteDayLines(ownRouteDay)
          : isPrimaryPlanilla
            ? savedExpenses
            : [],
    [chainPlanillaDay, ownRouteDay, isPrimaryPlanilla, savedExpenses],
  );
  const dayExpenseSplit = useMemo(
    () => splitDayExpenses(planillaExpenses),
    [planillaExpenses],
  );
  const lentClientRefs = useMemo(
    () => clientRefsLentOnDate(activeDate, savedExpensesRaw, loans, clients, loanScope),
    [activeDate, savedExpensesRaw, loans, clients, loanScope],
  );

  const closedPlanilla = useMemo(
    () =>
      buildCollectorHistoryPlanillaRows({
        dateIso: activeDate,
        dispatched: routeDispatched,
        payments: routeDayPays,
        loans,
        clients,
        expenses: savedExpenses,
      }),
    [activeDate, clients, routeDayPays, loans, routeDispatched, savedExpenses],
  );

  const pendingRouteStarts = routeBlockStarts(visibleItems, (item) =>
    assignmentRouteName(item, clients),
  );
  /** Mismos cobros del día, orden ruta → #, para la raya entre las dos hojas. */
  const dayPaysByRoute = useMemo(() => {
    return routeDayPays
      .slice()
      .sort((a, b) => {
        const loanA = loans.find((row) => row.ref === a.loanRef);
        const loanB = loans.find((row) => row.ref === b.loanRef);
        const clientA = clients.find((row) => row.ref === loanA?.clientRef);
        const clientB = clients.find((row) => row.ref === loanB?.clientRef);
        return (
          compareRoutePosition(
            clientA?.route,
            clientA?.routeOrder,
            clientB?.route,
            clientB?.routeOrder,
          ) ||
          payerName(a, loans, clients).localeCompare(payerName(b, loans, clients), "es")
        );
      });
  }, [clients, routeDayPays, loans]);
  const recaudoRows = useMemo(
    () =>
      recaudoOnlyBanco
        ? dayPaysByRoute.filter((pay) => normalizePaymentMethod(pay.method) !== "efectivo")
        : dayPaysByRoute,
    [recaudoOnlyBanco, dayPaysByRoute],
  );
  /** Préstamos del día a clientes de esta planilla que no pagaron: también van en la lista. */
  const unpaidDayLoans = useMemo(() => {
    if (recaudoOnlyBanco) return [];
    const paid = new Set<string>();
    for (const pay of recaudoRows) {
      const clientRef = loans.find((row) => row.ref === pay.loanRef)?.clientRef;
      if (clientRef) paid.add(clientRef);
    }
    return dayPlanillaLoansWithoutPayment(activeDate, newClientRoute, loans, clients, paid);
  }, [recaudoOnlyBanco, recaudoRows, loans, clients, activeDate, newClientRoute]);
  /** Último cobro del día por crédito: debajo va la fila del préstamo nuevo (cobro ≠ préstamo). */
  const lastPayRefByLoan = useMemo(() => {
    const last = new Map<string, string>();
    for (const pay of recaudoRows) {
      if (pay.loanRef) last.set(pay.loanRef, pay.ref);
    }
    return last;
  }, [recaudoRows]);
  const doneRouteStarts = routeBlockStarts(recaudoRows, (pay) => {
    const loan = loans.find((row) => row.ref === pay.loanRef);
    return clients.find((row) => row.ref === loan?.clientRef)?.route;
  });

  /** Totales de la planilla activa (ruta 1.1 sin datos = ceros reales). */
  const topRecaudo = planillaRecaudo.total;
  const dayLoanRows = useMemo(
    () =>
      chainPlanillaDay
        ? chainPlanillaDay.loanRows
        : isPrimaryPlanilla
          ? dayLoanDisbursementRows(activeDate, savedExpensesRaw, loans, clients, loanScope)
          : [],
    [activeDate, chainPlanillaDay, isPrimaryPlanilla, savedExpensesRaw, loans, clients, loanScope],
  );
  // Cadena M↔T: cada planilla muestra solo lo suyo; entre ellas solo pasa el saldo.
  const topGastos = ownRouteDay
    ? ownRouteDay.gastos
    : planillaOwnsMovements
      ? dayExpenseSplit.otrosTotal
      : 0;
  const topPrestamos = ownRouteDay
    ? ownRouteDay.prestamos
    : planillaOwnsMovements
      ? dayLoanDisbursementTotal(dayLoanRows)
      : 0;
  /**
   * Préstamos de la planilla: A / N = los de su caja propia; otra planilla fuera de la
   * cadena = solo lectura de los préstamos a clientes de esa ruta.
   */
  const viewLoanRows = useMemo(() => {
    if (ownRouteDay) return ownRouteDay.loanRows;
    if (planillaOwnsMovements || !activePlanillaRoute) return dayLoanRows;
    const routeClients = new Set(
      clients.filter((row) => sameRoute(row.route, activePlanillaRoute)).map((row) => row.ref),
    );
    return dayLoanDisbursementRows(activeDate, savedExpensesRaw, loans, clients, loanScope).filter((row) =>
      routeClients.has(row.clientRef),
    );
  }, [
    ownRouteDay,
    planillaOwnsMovements,
    activePlanillaRoute,
    dayLoanRows,
    clients,
    activeDate,
    savedExpensesRaw,
    loans,
    loanScope,
  ]);
  const viewPrestamos = dayLoanDisbursementTotal(viewLoanRows);
  /** Banco / Nequi del supervisor a clientes de esta planilla: solo reporte, la caja no los resta. */
  const digitalPool = digitalLoanPoolForRoute(newClientRoute);
  const digitalLoanRows = useMemo(
    () => dayDigitalLoanRows(activeDate, newClientRoute, loans, clients),
    [activeDate, newClientRoute, loans, clients],
  );
  const digitalPrestamos = dayLoanDisbursementTotal(digitalLoanRows);
  const prestamosKpi = viewPrestamos + digitalPrestamos;
  /** Caja de la planilla: en la cadena, la cifra del libro (M = caja de M; T = saldo final del día). */
  const planillaCaja =
    chainPlanillaDay && chainOpening.kind === "chain"
      ? onSecondaryChainPlanilla
        ? dayLedger.dayFinal
        : dayLedger.mClosing
      : null;
  /** Inicial: cadena M/T si aplica; A / N = caja propia; resto sin cruzar. */
  const headerInicial =
    chainOpening.kind === "chain"
      ? chainOpening.opening
      : ownRouteDay
        ? ownRouteDay.opening
        : isPrimaryPlanilla
          ? dayCuadre.saldoInicial
          : 0;
  const headerInicialReady = chainOpening.kind !== "chain" || chainOpening.ready;
  const headerInicialProvisional =
    chainOpening.kind === "chain" && Boolean(chainOpening.provisional);
  const headerInicialTitle =
    chainOpening.kind === "chain"
      ? chainOpening.ready
        ? headerInicialProvisional
          ? `Momentáneo · se fija al cerrar ${PLANILLA_CASH_CHAIN_PRIMARY}`
          : "Saldo inicial fijo"
        : chainOpening.blockReason
      : undefined;
  /** Caja de la planilla (la que pasa como Inicial al otro día): una sola cifra para cuadre y cabecera. */
  const cajaShown =
    planillaCaja != null
      ? planillaCaja
      : chainOpening.kind === "chain"
        ? headerInicial + planillaRecaudo.efectivo - topGastos - topPrestamos
        : ownRouteDay
          ? ownRouteDay.closing
          : isPrimaryPlanilla
            ? dayCuadre.saldo
            : planillaRecaudo.efectivo - topPrestamos;
  /** N: Total día = recaudo en efectivo − préstamos − gastos (Caja − Inicial); Banco va aparte. */
  const totalDiaShown = cajaShown - headerInicial;
  const pendingCollectShown = activePlanillaRoute
    ? routePendingCollectCount
    : queue.pendingCollectCount;
  const planillaPrestadoEfectivo = chainPlanillaDay
    ? chainPlanillaDay.prestamos
    : ownRouteDay
      ? ownRouteDay.prestamos
      : isPrimaryPlanilla
      ? prestadoEfectivo
      : 0;

  const openPlanillaDates = useMemo(
    () => new Set(routeOptions.filter((row) => !row.closed).map((row) => row.date)),
    [routeOptions],
  );

  const historyVisibleRows = useMemo(() => {
    return dayHistory.filter(
      (row) =>
        row.date >= ROUTE_CASH_BOOK_FROM &&
        (row.cobro > 0 ||
        row.gasto > 0 ||
        row.prestamo > 0 ||
        row.date === activeDate ||
        openPlanillaDates.has(row.date) ||
        closedHistoryDates.has(row.date)),
    );
  }, [activeDate, closedHistoryDates, dayHistory, openPlanillaDates]);

  /** Historial · T: renglón del cierre + ajuste de saldo del supervisor (solo lectura). */
  const historyRowsWithAdjustment = useMemo(() => {
    const route = historyRoute;
    if (route && isIndependentSaldoRoute(route)) {
      return attachRouteCashAdjustments(historyVisibleRows, collector.ref, route, dayCloses);
    }
    if (!isPlanillaCashChainSecondary(route ?? undefined)) {
      return historyVisibleRows.map((row) => ({ row, adjustment: null }));
    }
    return attachCashAdjustments(historyVisibleRows, collector.ref, dayCloses);
  }, [collector.ref, dayCloses, historyVisibleRows, historyRoute]);

  /** Historial · M: extracto (Inicial → Saldo). Días previos intactos. */
  const showMInicialColumn = isPlanillaCashChainPrimary(activePlanillaRoute ?? undefined);
  const mCashBook = useRouteCashBook(
    collector.ref,
    showMInicialColumn ? PLANILLA_CASH_CHAIN_PRIMARY : null,
    `${todayIso()}|${activeDate}`,
  );
  const historyRowsWithInicial = useMemo(() => {
    if (!showMInicialColumn) return null;
    const today = date ?? todayIso();
    // El celular del cobrador solo guarda hoy y el último día cerrado: sin libro del
    // servidor, los días anteriores quedan en «—» en vez de una cifra rehecha a medias.
    let keptDay = "";
    for (const row of dayCloses) {
      if (row.collectorRef !== collector.ref || !row.ref.startsWith("CIE-") || row.provisional) continue;
      const day = normalizeHistoryDate(row.date) || row.date;
      if (day < today && day > keptDay) keptDay = day;
    }
    const closingFor = isCollectorLiveDevice()
      ? (dateIso: string) => (dateIso === keptDay ? primaryClosingFor(dateIso) : null)
      : primaryClosingFor;
    return annotateMHistoryExtractRows({
      rows: historyVisibleRows,
      collectorRef: collector.ref,
      records: planillaCashCloses,
      epochBootstrapOpening: mCarriedFallbackOpening,
      todayIso: today,
      dayCloses,
      monthCloses,
      primaryClosingFor: closingFor,
      book: mCashBook,
    });
  }, [
    collector.ref,
    date,
    mCashBook,
    dayCloses,
    historyVisibleRows,
    mCarriedFallbackOpening,
    monthCloses,
    planillaCashCloses,
    primaryClosingFor,
    showMInicialColumn,
  ]);

  return (
    <div className={`collector-mobile-app${preview ? " is-preview" : ""}`}>
      {preview ? (
        <div className="collector-mobile-preview-banner">
          Vista previa · lo mismo que verá en el celular
        </div>
      ) : (
        <div className="collector-mobile-sync-banner">
          Cobros se envían a oficina · Sin contacto con otros cobradores
        </div>
      )}

      <header className="collector-mobile-header">
        <div className="collector-mobile-header-top">
        <div className="collector-mobile-brand">
          <div className="collector-mobile-logo-col">
            <img src="/logo-ca-prestamo.png" alt="CA préstamo" className="brand-logo" />
          </div>
          <div className="collector-mobile-user-meta">
              <div className="collector-mobile-greet-line">
                <p className="collector-mobile-greet">
                  Hola, {collector.name.split(" ")[0]}
                </p>
            <span className="collector-mobile-date">{queue.dateLabel}</span>
              </div>
          </div>
        </div>
        <div className="collector-mobile-menu" ref={menuRef}>
          <button
            type="button"
            className={
              menuOpen
                ? "collector-mobile-menu-trigger is-open"
                : "collector-mobile-menu-trigger"
            }
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="Menú"
            title="Menú"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="collector-mobile-menu-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          {menuOpen ? (
            <div className="collector-mobile-menu-panel" role="menu">
              <button
                type="button"
                role="menuitem"
                className="collector-mobile-menu-item"
                onClick={openHistory}
              >
                Historial
              </button>
                {onCreateClient && newClientRoute && !showHomeCuadre ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="collector-mobile-menu-item"
                    title={`Crear cliente en la ruta ${newClientRoute}`}
                    onClick={openNewClient}
                  >
                    Nuevo cliente
                  </button>
                ) : null}
              <button
                type="button"
                role="menuitem"
                className="collector-mobile-menu-item"
                disabled={!canCloseDay}
                  title={
                    !chainCloseGuard.ok
                      ? chainCloseGuard.error
                      : activePlanillaRoute
                        ? `Revisar y cerrar planilla ${activePlanillaRoute}`
                        : "Revisar y confirmar cierre del día"
                  }
                onClick={openCloseConfirm}
              >
                  {confirmingClose
                    ? "Revisando…"
                    : !chainCloseGuard.ok
                      ? `Cerrar ${activePlanillaRoute ?? ""} (requiere M)`
                      : activePlanillaRoute
                        ? `Cerrar planilla ${activePlanillaRoute}`
                        : "Cerrar día"}
              </button>
                {onLogout && !preview ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="collector-mobile-menu-item is-exit"
                    title="Salir de la app"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    Salir
                  </button>
                ) : null}
            </div>
          ) : null}
        </div>
        </div>
        {!chromeLocked || (planillaRoutePins.length > 1 && todayHasOpenSheet) ? (
          <div className="collector-mobile-header-bar">
            {!chromeLocked ? (
              <div
                className="collector-mobile-header-inicial"
                title={
                  headerInicialTitle ??
                  (chainOpening.kind === "chain"
                    ? "Saldo inicial"
                    : "Saldo en caja al iniciar el día (cierre del día anterior)")
                }
              >
                <span>{headerInicialProvisional ? "Inicial ·" : "Inicial"}</span>
                <b>{headerInicialReady ? money(headerInicial) : "—"}</b>
              </div>
            ) : null}
            {!chromeLocked && planillaIsN ? (
              <>
                <button
                  type="button"
                  className={
                    !reviewingPanel && listFilter === "done" && !recaudoOnlyBanco
                      ? "collector-mobile-header-inicial is-recaudo on"
                      : "collector-mobile-header-inicial is-recaudo"
                  }
                  title="Cobros del día en efectivo"
                  {...navButtonProps(navIntent, () => openRecaudoDetail())}
                >
                  <span>Recaudo</span>
                  <b>{money(planillaRecaudo.efectivo)}</b>
                </button>
                <div
                  className="collector-mobile-header-inicial is-total-dia"
                  title="Recaudo − préstamos − gastos"
                >
                  <span>Total día</span>
                  <b>{headerInicialReady ? money(totalDiaShown) : "—"}</b>
                </div>
                <div
                  className="collector-mobile-header-inicial is-caja"
                  title="Total día + Inicial: pasa como Inicial al otro día"
                >
                  <span>Caja</span>
                  <b>{headerInicialReady ? money(cajaShown) : "—"}</b>
                </div>
              </>
            ) : null}
            {planillaRoutePins.length > 1 && (!showHomeCuadre || todayHasOpenSheet) ? (
              <div
                className="collector-mobile-route-pins"
                role="group"
                aria-label="Planilla por ruta"
              >
                {planillaRoutePins.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={
                      activePlanillaRoute && sameRoute(activePlanillaRoute, name)
                        ? "collector-mobile-route-pin on"
                        : "collector-mobile-route-pin"
                    }
                    title={`Planilla ruta ${name}`}
                    aria-label={`Planilla ruta ${name}`}
                    aria-pressed={Boolean(
                      activePlanillaRoute && sameRoute(activePlanillaRoute, name),
                    )}
                    onClick={() => {
                      setExpandedKey(null);
                      setReviewingLoans(false);
                      setEditingExpenses(false);
                      setConfirmingClose(false);
                      setListFilter("pending");
                      setPreferCobroPlanilla(false);
                      setPlanillaRouteFilter(name);
                    }}
                  >
                    <b>{name}</b>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {historyOpen ? (
        <div
          className="collector-mobile-history-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collector-history-title"
        >
          <header className="collector-mobile-history-panel-head">
            <div>
              <h2 id="collector-history-title">
                Historial
                {activePlanillaRoute ? ` · ${activePlanillaRoute}` : ""}
              </h2>
              <span>Últimos {COLLECTOR_HISTORY_KEEP_DAYS} días</span>
            </div>
            <button
              type="button"
              className="collector-mobile-pay-link is-back"
              onClick={() => setHistoryOpen(false)}
            >
              volver
            </button>
          </header>

          <div
            className={
              showMInicialColumn
                ? "collector-mobile-day-history is-panel is-chain-m"
                : "collector-mobile-day-history is-panel"
            }
          >
            <div className="collector-mobile-day-history-head">
              <span>Día</span>
              {showMInicialColumn ? <span>Inicial</span> : null}
              <span>Cobros</span>
              <span>Préstamo</span>
              <span>Gasto</span>
              <span>Saldo</span>
            </div>
            <ul className="collector-mobile-day-history-list">
              {!showMInicialColumn &&
              carriedOpening > 0 &&
              dayHistory.every((row) => periodFromDateIso(row.date) === viewPeriod) ? (
                <li>
                  <div className="collector-mobile-day-history-row is-opening">
                    <span className="is-date">Ant.</span>
                    <span className="is-money">—</span>
                    <span className="is-money">—</span>
                    <span className="is-money">—</span>
                    <span className={carriedOpening < 0 ? "is-saldo is-negative" : "is-saldo"}>
                      {money(carriedOpening, { symbol: false })}
                    </span>
                  </div>
                </li>
              ) : null}
              {historyVisibleRows.length === 0 ? (
                <li className="collector-mobile-day-history-empty">
                  Sin movimientos en los últimos {COLLECTOR_HISTORY_KEEP_DAYS} días.
                </li>
              ) : showMInicialColumn && historyRowsWithInicial ? (
                historyRowsWithInicial.map((row) => (
                  <li key={row.date}>
                    <button
                      type="button"
                      className={
                        row.date === activeDate
                          ? "collector-mobile-day-history-row on"
                          : "collector-mobile-day-history-row"
                      }
                      onClick={() => {
                        setSelectedDate(row.date);
                        setPreferCobroPlanilla(false);
                        setListFilter("pending");
                        setEditingExpenses(false);
                        setConfirmingClose(false);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="is-date">{row.dateLabel}</span>
                      <span className="is-money is-inicial-col">
                        {row.inicial == null ? "—" : money(row.inicial, { symbol: false })}
                      </span>
                      <span className="is-money">{money(row.cobro, { symbol: false })}</span>
                      <span className="is-money">{money(row.prestamo, { symbol: false })}</span>
                      <span className="is-money">{money(row.gasto, { symbol: false })}</span>
                      <span
                        className={
                          row.saldoShown != null && row.saldoShown < 0
                            ? "is-saldo is-negative is-saldo-strong"
                            : "is-saldo is-saldo-strong"
                        }
                      >
                        {row.saldoShown == null
                          ? "—"
                          : money(row.saldoShown, { symbol: false })}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                historyRowsWithAdjustment.map(({ row, adjustment }) => (
                  <Fragment key={row.date}>
                    <li>
                      <button
                        type="button"
                        className={
                          row.date === activeDate
                            ? "collector-mobile-day-history-row on"
                            : "collector-mobile-day-history-row"
                        }
                        onClick={() => {
                          setSelectedDate(row.date);
                          setPreferCobroPlanilla(false);
                          setListFilter("pending");
                          setEditingExpenses(false);
                          setConfirmingClose(false);
                          setHistoryOpen(false);
                        }}
                      >
                        <span className="is-date">{row.dateLabel}</span>
                        <span className="is-money">{money(row.cobro, { symbol: false })}</span>
                        <span className="is-money">{money(row.prestamo, { symbol: false })}</span>
                        <span className="is-money">{money(row.gasto, { symbol: false })}</span>
                        <span
                          className={
                            row.saldo < 0 ? "is-saldo is-negative is-saldo-strong" : "is-saldo is-saldo-strong"
                          }
                        >
                        {money(row.saldo, { symbol: false })}
                      </span>
                    </button>
                  </li>
                    {adjustment ? (
                      <li>
                        <div
                          className="collector-mobile-day-history-row is-adjustment"
                          title={cashAdjustmentNote(adjustment)}
                        >
                          <span className="is-date">{row.dateLabel}</span>
                          <span className="is-money">Ajuste</span>
                          <span className="is-money" />
                          <span className="is-money">
                            {cashAdjustmentDelta(adjustment) > 0
                              ? "+"
                              : cashAdjustmentDelta(adjustment) < 0
                                ? "−"
                                : ""}
                            {money(Math.abs(cashAdjustmentDelta(adjustment)), { symbol: false })}
                          </span>
                          <span className="is-saldo is-saldo-strong">
                            {money(adjustment.real, { symbol: false })}
                          </span>
                        </div>
                        <p className="collector-mobile-day-history-note">
                          {cashAdjustmentNote(adjustment)}
                        </p>
                      </li>
                    ) : null}
                  </Fragment>
                ))
              )}
            </ul>
          </div>

          {showSaveMonth ? (
            <div className="collector-mobile-history-panel-foot">
              <button
                type="button"
                className="collector-mobile-history-toggle is-month"
                onClick={() => {
                  confirmCloseMonth();
                  setHistoryOpen(false);
                }}
              >
                guardar mes · empezar nuevo
              </button>
              <span>Saldo a arrastrar: {money(monthSaldoToSave)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <>
      {monthBlock ? (
        <div className="collector-mobile-month-alert" role="alert">
          <p>{monthBlock.message}</p>
          {onCloseMonth ? (
            <button
              type="button"
              className="collector-mobile-pay-link"
              onClick={() =>
                onCloseMonth({
                  period: monthBlock.previousPeriod,
                  collectorRef: collector.ref,
                  collectorName: collector.name,
                  closingSaldo: priorMonthClosingSaldo,
                })
              }
            >
              guardar mes anterior · arrastrar saldo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="collector-mobile-stats has-prestamos">
        <button
          type="button"
          className={
            chromeLocked
              ? "collector-mobile-stat is-pending is-off"
              : !reviewingPanel && listFilter === "pending"
                ? "collector-mobile-stat is-pending on"
                : "collector-mobile-stat is-pending"
          }
          disabled={chromeLocked}
          title={chromeLocked ? "Jornada cerrada" : undefined}
          {...navButtonProps(navIntent, () => {
            if (chromeLocked) return;
            selectFilter("pending");
          })}
        >
          <span>Por cobrar</span>
          <b>{pendingCollectShown}</b>
        </button>
        {planillaIsN ? (
        <button
          type="button"
          className={
              chromeLocked
                ? "collector-mobile-stat is-banco is-off"
                : !reviewingPanel && listFilter === "done" && recaudoOnlyBanco
                  ? "collector-mobile-stat is-banco on"
                  : "collector-mobile-stat is-banco"
            }
            disabled={chromeLocked}
            title={chromeLocked ? "Jornada cerrada" : "Cobros del día en Banco"}
            {...navButtonProps(navIntent, () => {
              if (chromeLocked) return;
              openRecaudoDetail(true);
            })}
          >
            <span>Banco</span>
            <b>{money(planillaRecaudo.digital)}</b>
          </button>
        ) : (
          <button
            type="button"
            className={
              chromeLocked
              ? "collector-mobile-stat is-recaudo is-off"
              : !reviewingPanel && listFilter === "done"
                  ? "collector-mobile-stat is-recaudo on"
                  : "collector-mobile-stat is-recaudo"
          }
            disabled={chromeLocked}
            title={chromeLocked ? "Jornada cerrada" : undefined}
            {...navButtonProps(navIntent, () => {
              if (chromeLocked) return;
              openRecaudoDetail();
            })}
        >
          <span>Recaudo</span>
          <b>{money(topRecaudo)}</b>
        </button>
        )}
        <button
          type="button"
          className={
            chromeLocked
              ? "collector-mobile-stat is-prestamos is-off"
              : reviewingLoans
                ? "collector-mobile-stat is-prestamos on"
                : "collector-mobile-stat is-prestamos"
          }
          disabled={chromeLocked}
          title={
            chromeLocked
              ? "Jornada cerrada"
              : !planillaOwnsMovements
                ? `Préstamos a clientes de esta planilla (la caja los descuenta en ${PLANILLA_CASH_CHAIN_PRIMARY})`
                : "Préstamos del día"
          }
          {...navButtonProps(navIntent, () => {
            if (chromeLocked) return;
            openLoansDetail();
          })}
        >
          <span>Préstamos</span>
          <b>{prestamosKpi > 0 ? money(prestamosKpi) : "—"}</b>
        </button>
        <button
          type="button"
          className={
            chromeLocked
              ? "collector-mobile-stat collector-mobile-stat-close is-gastos is-off"
              : editingExpenses
                ? "collector-mobile-stat on collector-mobile-stat-close is-gastos"
                : "collector-mobile-stat collector-mobile-stat-close is-gastos"
          }
          disabled={
            chromeLocked
              ? true
              : !onSaveExpenses || !planillaOwnsMovements || !queue.dispatched.length
          }
          title={
            chromeLocked
              ? "Jornada cerrada"
              : !onSaveExpenses
                ? "Sin permiso para gastos"
                : !planillaOwnsMovements
                  ? "Gastos en la planilla principal"
                  : !queue.dispatched.length
                  ? "Sin planilla"
                  : "Gastos del día"
          }
          {...navButtonProps(navIntent, () => {
            if (chromeLocked) return;
            openExpenses();
          })}
        >
          <span>Gastos</span>
          <b>{topGastos > 0 ? money(topGastos) : "—"}</b>
        </button>
      </div>

      {isPastOpenDay && canCloseDay && !confirmingClose && !editingExpenses && !reviewingLoans ? (
        <div className="collector-mobile-month-alert" role="status">
          <p>
            El día {queue.dateLabel} sigue abierto. Los cobros ya hechos quedan registrados; cierra
            esta jornada para dejar el historial en orden.
          </p>
          <button type="button" className="collector-mobile-pay-link" onClick={openCloseConfirm}>
            Cerrar día {queue.dateLabel}
          </button>
        </div>
      ) : null}

      {showHomeCuadre ? (
        <section className="collector-mobile-home-cuadre" aria-label="Último cierre">
          <div className="collector-mobile-home-cuadre-head">
            <button
              type="button"
              className="collector-mobile-home-inicio-btn"
              title="Ir a la planilla del día"
              aria-label="Inicio · planilla del día"
              onClick={() => {
                suppressGhostClick(420);
                const day = date ?? todayIso();
                setSelectedDate(day);
                setPreferCobroPlanilla(true);
                setListFilter("pending");
                setEditingExpenses(false);
                setReviewingLoans(false);
                setConfirmingClose(false);
                setHistoryOpen(false);
                setExpandedKey(null);
                setReloanPayRef(null);
                if (planillaRoutePins.length > 1) {
                  setPlanillaRouteFilter(
                    defaultOpenPlanillaRoute(
                      planillaRoutePins,
                      assignments,
                      day,
                      clients,
                    ) ?? planillaRoutePins[0],
                  );
                }
              }}
            >
              Inicio
            </button>
            <div className="collector-mobile-home-cuadre-title-row">
              <h2>Tu último cierre</h2>
              {queue.closed ? (
                <p className="collector-mobile-home-cuadre-progress">{queue.dateLabel}</p>
              ) : null}
            </div>
          </div>

          <div className="collector-mobile-home-cuadre-grid is-inicio-triple">
            <div
              className="is-inicial"
              title={headerInicialTitle}
            >
              <span>{headerInicialProvisional ? "Lo que inició (momentáneo)" : "Lo que inició"}</span>
              <b>{headerInicialReady ? money(headerInicial) : "—"}</b>
              </div>
            <div className="is-prestamos">
              <span>Lo que prestó</span>
              <b>{money(topPrestamos)}</b>
            </div>
              <div className="is-gastos">
                <span>Lo que gastó</span>
              <b>{money(topGastos)}</b>
          </div>

            <div className="is-cobrado">
              <div className="is-cobrado-head">
                <span>Lo que cobró</span>
              </div>
              <div className="is-cobrado-means" aria-label="Desglose de lo cobrado">
                <div className="is-mean is-pay-efectivo">
                  <span>Efectivo</span>
                  <b>{money(planillaRecaudo.efectivo)}</b>
                </div>
                {planillaIsA ? (
                  <div className="is-mean is-pay-nequi">
                  <span>Nequi</span>
                    <b>{money(planillaNequiShown)}</b>
                </div>
                ) : (
                  <div className="is-mean is-pay-banco">
                    <span>Banco</span>
                    <b>{money(planillaRecaudo.digital)}</b>
                  </div>
            )}
          </div>
            </div>

            <div className="is-saldo">
              <span>Caja (efectivo − gastos − préstamos)</span>
              <b>{money(cajaShown)}</b>
            </div>
          </div>
          <CollectorDayCloseExtras
            dateLabel={
              activePlanillaRoute
                ? `${queue.dateLabel} · ${activePlanillaRoute}`
                : queue.dateLabel
            }
            planillaRows={closedPlanilla}
            prestamos={dayExpenseSplit.prestamos}
            prestamosTotal={topPrestamos}
            otrosGastos={planillaOwnsMovements ? dayExpenseSplit.otros : []}
            otrosTotal={topGastos}
            searchOpen={planillaSearchOpen}
            searchQuery={planillaQuery}
            onToggleSearch={() => setPlanillaSearchOpen((open) => !open)}
            onSearchChange={setPlanillaQuery}
          />
          <p className="collector-mobile-home-cuadre-hint is-ok">
            Este saldo es el que llevas hasta el próximo cobro. Historial para ver otros días.
          </p>
        </section>
      ) : null}

      {!showHomeCuadre ? (
      <>
      {creatingClient && onCreateClient && newClientRoute ? (
        <CollectorNewClientSheet
          routeName={newClientRoute}
          clients={clients}
          onCancel={() => setCreatingClient(false)}
          onSave={saveNewClient}
        />
      ) : editingExpenses && onSaveExpenses ? (
        <CollectorCloseDaySheet
          key={`${collector.ref}-${activeDate}-${activePlanillaRoute ?? ""}-${dayExpenseSplit.otros
            .map((r) => `${r.id}:${r.amount}`)
            .join("|")}`}
          draft={{
            collectorRef: collector.ref,
            collectorName: collector.name,
            date: activeDate,
            routeRef,
            collected: recaudo.total,
            expenses: dayExpenseSplit.otros,
          }}
          onSave={saveExpenses}
        />
      ) : reviewingLoans ? (
        <CollectorDayLoansPanel
          dateLabel={queue.dateLabel}
          rows={viewLoanRows}
          total={viewPrestamos}
          digitalRows={digitalLoanRows}
          digitalTotal={digitalPrestamos}
          digitalLabel={digitalLoanPoolLabel(digitalPool)}
        />
      ) : confirmingClose && onCloseDay ? (
        <CollectorCloseDayConfirm
          dateLabel={
            activePlanillaRoute
              ? `${queue.dateLabel} · planilla ${activePlanillaRoute}`
              : queue.dateLabel
          }
          collected={planillaRecaudo.total}
          efectivo={planillaRecaudo.efectivo}
          nequi={planillaIsA ? planillaNequiShown : undefined}
          banco={planillaIsA ? undefined : planillaRecaudo.digital}
          expenses={planillaExpenses}
          opening={planillaCaja != null ? headerInicial : undefined}
          cashFloat={planillaCaja ?? undefined}
          pendingCount={pendingCollectShown}
          onCancel={() => setConfirmingClose(false)}
          onConfirm={confirmCloseDay}
        />
      ) : (
        <>
      {listFilter === "done" && !planillaIsN ? (
        <section className="collector-mobile-cuadre" aria-label="Cuadre de recaudo por medio de pago">
          <h2>Cuadre del día</h2>
          <div className="collector-mobile-cuadre-grid">
            <div className="is-pay-efectivo">
              <em>Efectivo</em>
              <b>{money(planillaRecaudo.efectivo)}</b>
            </div>
            {planillaIsChain ? (
              <button
                type="button"
                className={recaudoOnlyBanco ? "is-pay-banco is-list-toggle on" : "is-pay-banco is-list-toggle"}
                title="Ver los cobros del día en Banco"
                aria-pressed={recaudoOnlyBanco}
                {...navButtonProps(navIntent, () => openRecaudoDetail(!recaudoOnlyBanco))}
              >
                <em>Banco</em>
                <b>{money(planillaRecaudo.digital)}</b>
              </button>
            ) : (
              <>
            <div className="is-pay-nequi">
              <em>Nequi</em>
                  <b>{money(planillaNequiShown)}</b>
            </div>
                {planillaIsA ? null : (
                  <div className="is-pay-banco">
                    <em>Banco</em>
                    <b>{money(planillaRecaudo.banco)}</b>
                  </div>
                )}
              </>
            )}
            <div
              className="is-total"
              title={planillaIsChain ? "Efectivo − préstamos − gastos" : undefined}
            >
              <em>Total</em>
              <b>
                {money(
                  planillaIsChain
                    ? planillaRecaudo.efectivo - topPrestamos - topGastos
                    : planillaRecaudo.total,
                )}
              </b>
            </div>
            {planillaPrestadoEfectivo > 0 && !planillaIsChain && !planillaIsA ? (
              <div
                className="is-prestado"
                title="Capital prestado hoy en efectivo: sale del efectivo cobrado"
              >
                <em>Prestado</em>
                <b>−{money(planillaPrestadoEfectivo)}</b>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {listFilter === "done" ? (
        <ul className="collector-mobile-list compact is-recaudo-sheet" aria-label="Quienes pagaron">
          {recaudoRows.length === 0 && unpaidDayLoans.length === 0 ? (
            <li className="collector-mobile-empty-inline">
              {recaudoOnlyBanco ? "Aún no hay cobros en Banco hoy." : "Aún no hay cobros del día."}
            </li>
          ) : (
            recaudoRows.map((pay, index) => {
              const method = paymentDisplayMethod(pay, loans, clients);
              const payLoan = loans.find((row) => row.ref === pay.loanRef);
              const payClient = payLoan
                ? clients.find((row) => row.ref === payLoan.clientRef)
                : undefined;
              const reloan = reloanStateForVisit({
                clientRef: payLoan?.clientRef ?? "",
                loanRef: pay.loanRef,
                loans,
                payments: livePayments,
                date: activeDate,
              });
              const reloanOpen = reloanPayRef === pay.ref;
              const isReloanAnchor =
                !pay.loanRef || reloanAnchorByLoan.get(pay.loanRef) === pay.ref;
              const canOfferReloan =
                isReloanAnchor &&
                reloan.canReloan &&
                Boolean(payClient) &&
                Boolean(onCreateQuickLoan) &&
                !dayLocked;
              const payRow = (
                <li
                  key={pay.ref}
                  className={[
                    "collector-mobile-card",
                    "is-done",
                    "is-dense",
                    reloanOpen ? "is-open" : "",
                    doneRouteStarts[index] ? "is-route-start" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div
                    className={
                      recaudoOnlyBanco
                        ? "collector-mobile-dense-row is-recaudo-row has-evidence"
                        : "collector-mobile-dense-row is-recaudo-row"
                    }
                  >
                    <div className="collector-mobile-visit-who">
                      <strong>{payerName(pay, loans, clients)}</strong>
                      {isLatePayment(pay) ? (
                        <>
                          {" "}
                          <Pill label={latePaymentTag(pay)} kind="warn" title={latePaymentNote(pay)} />
                        </>
                      ) : null}
                    </div>
                    <span className="is-done-loan">
                      {canOfferReloan ? (
                        <button
                          type="button"
                          className={reloanOpen ? "collector-reloan-btn on" : "collector-reloan-btn"}
                          title="Terminó su crédito: prestarle ahora (sale del efectivo del día)"
                          aria-expanded={reloanOpen}
                          onClick={() => setReloanPayRef(reloanOpen ? null : pay.ref)}
                        >
                          Préstamo
                        </button>
                      ) : null}
                    </span>
                    {recaudoOnlyBanco ? (
                      <span className="is-done-evidence">
                        <PaymentEvidenceThumb evidence={withPaymentEvidence(pay).evidence} size={26} />
                      </span>
                    ) : null}
                    <span className="collector-mobile-ref is-done-col">
                      {money(pay.amount, { symbol: false })}
                    </span>
                    <Pill
                      label={paymentMethodInitial(method)}
                      kind={paymentMethodKind(method)}
                      title={paymentMethodLabel(method)}
                    />
                  </div>
                  {reloanOpen && canOfferReloan && payClient && onCreateQuickLoan ? (
                    <div className="collector-mobile-pay-inline">
                      <QuickLoanForm
                        clientName={payerName(pay, loans, clients)}
                        clientRef={payClient.ref}
                        fundedByOptions={["efectivo"]}
                        defaultFundedBy="efectivo"
                        onCancel={() => setReloanPayRef(null)}
                        onSave={(draft) => {
                          setReloanPayRef(null);
                          onCreateQuickLoan({ ...draft, routeName: payClient.route });
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
              const grantedRow =
                reloan.granted && !recaudoOnlyBanco && lastPayRefByLoan.get(pay.loanRef ?? "") === pay.ref
                  ? reloan.granted
                  : null;
              return grantedRow ? (
                <Fragment key={pay.ref}>
                  {payRow}
                  <DayLoanListRow
                    loan={grantedRow}
                    clientName={payerName(pay, loans, clients)}
                    source={loanDisbursementSource(grantedRow)}
                    renewal={false}
                  />
                </Fragment>
              ) : (
                payRow
              );
            })
          )}
          {unpaidDayLoans.map(({ loan, clientName, source, renewal }) => (
            <DayLoanListRow
              key={`loan-${loan.ref}`}
              loan={loan}
              clientName={clientName}
              source={source}
              renewal={renewal}
            />
          ))}
        </ul>
      ) : null}

      {listFilter !== "done" && queue.awaitingDispatch.length > 0 && !queue.dispatched.length ? (
        <p className="collector-mobile-note warn">
          Tienes {queue.awaitingDispatch.length} cobro(s) asignados. La planilla permanente se envía
          sola; si ves este aviso, vuelve a abrir la app o pide a oficina revisar la ruta.
        </p>
      ) : null}

          {listFilter !== "done" ? (
          <ul className="collector-mobile-list compact">
            {visibleItems.length === 0 ? (
              <li className="collector-mobile-empty-inline">
                {dayLocked
                    ? "Jornada cerrada. Elige otra fecha en Historial si tienes más."
                    : queue.allDone
                      ? "Listo: ya no hay pendientes. Cierra el día en el menú para archivar la jornada."
                      : "¡Listo! No quedan cobros pendientes en esta ruta."}
              </li>
            ) : (
              visibleItems.map((item, index) => {
                const key = itemKey(item);
                const isOpen = expandedKey === key;
                const routeStart = pendingRouteStarts[index];
                const identity = visibleIdentities[index];
                const canLend =
                  identity.awaitingLoan &&
                  !dayLocked &&
                  canCollect &&
                  Boolean(onCreateQuickLoan);
                const lentToday = lentClientRefs.has(item.clientRef);
                const canAct =
                  !identity.awaitingLoan &&
                  item.visitStatus !== "omitido" &&
                  !collectionStopped &&
                  canCollect &&
                  Boolean(identity.loanRef) &&
                  identity.balance > 0;
                const cuotaShown = identity.cuota;
                const loanForRenew = identity.loan;
                const renewEnabled = Boolean(onRenewLoan && canRenewLoan(loanForRenew));

                return (
                  <li
                    key={key}
                    id={`collector-pay-card-${key}`}
                    className={[
                      isOpen
                          ? "collector-mobile-card is-open is-dense"
                          : "collector-mobile-card is-dense",
                      identity.awaitingLoan ? "is-awaiting-loan" : "",
                      lentToday ? "is-lent-today" : "",
                      routeStart ? "is-route-start" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div
                      className={
                        isOpen
                          ? "collector-mobile-dense-row is-paying"
                          : "collector-mobile-dense-row"
                      }
                    >
                      <span className="collector-mobile-visit-order" aria-label="Orden de visita">
                        {identity.order ?? "—"}
                      </span>
                      <div
                        className={
                          isOpen
                            ? "collector-mobile-visit-who is-with-combo"
                            : "collector-mobile-visit-who"
                        }
                      >
                        <strong title={identity.fullName}>{identity.fullName}</strong>
                      </div>
                      {identity.awaitingLoan && !isOpen ? (
                        <>
                          <div className="collector-mobile-dense-money is-prestar">
                            <span>
                              <b>—</b>
                            </span>
                            <span>
                              <b className="is-prestar-label">Prestar</b>
                            </span>
                          </div>
                          <div className="collector-mobile-dense-actions is-lend-pair">
                        <button
                          type="button"
                              className="collector-mobile-pay-sticker is-lend-check"
                          disabled={!canLend}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                togglePay(item);
                              }}
                              title="Crear préstamo"
                              aria-label="Crear préstamo"
                            >
                              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <circle cx="8" cy="8" r="7" fill="#dbeafe" stroke="#2563eb" strokeWidth="1.25" />
                                <path
                                  d="M4.6 8.2l2.2 2.2 4.6-4.8"
                                  fill="none"
                                  stroke="#2563eb"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                        </button>
                            <button
                              type="button"
                              className="collector-mobile-pay-sticker is-decline-lend-check"
                              disabled={dayLocked || !canCollect || !onSkipVisit}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (!onSkipVisit) return;
                                onSkipVisit({
                                  routeRef,
                                  clientRef: item.clientRef,
                                  loanRef: "",
                                  dispatchDate: item.dispatchDate || activeDate,
                                  collectorRef: collector.ref,
                                  reason: DECLINED_LOAN_OFFER_TODAY_REASON,
                                });
                              }}
                              title="Hoy no quiere préstamo"
                              aria-label="Hoy no quiere préstamo"
                            >
                              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                <circle cx="8" cy="8" r="7" fill="#fee2e2" stroke="#dc2626" strokeWidth="1.25" />
                                <path
                                  d="M4.6 8.2l2.2 2.2 4.6-4.8"
                                  fill="none"
                                  stroke="#dc2626"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </button>
                          </div>
                        </>
                      ) : null}
                      {!identity.awaitingLoan ? (
                        <div className="collector-mobile-dense-money">
                          <span>
                            <b>{money(identity.balance, { symbol: false })}</b>
                          </span>
                          <span>
                            <b>{cuotaShown > 0 ? money(cuotaShown, { symbol: false }) : "—"}</b>
                          </span>
                        </div>
                      ) : null}
                      {isOpen && canAct ? (
                        <button
                          type="button"
                          className={
                            payCombo
                              ? "collector-pay-combo-toggle is-by-name is-under-name on"
                              : "collector-pay-combo-toggle is-by-name is-under-name"
                          }
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setPayCombo((current) => !current);
                          }}
                        >
                          Combinado
                        </button>
                      ) : null}
                      {!identity.awaitingLoan && canAct ? (
                        <>
                          {!isOpen ? (
                            <CuotasProgressCell
                              progress={
                                identity.cuotas ?? {
                                  label: "",
                                  intensity: 0,
                                  title: "",
                                  expected: 0,
                                }
                              }
                              className="collector-mobile-cuotas"
                            />
                          ) : (
                            <span className="collector-mobile-cuotas" aria-hidden />
                          )}
                          <button
                            type="button"
                            className="collector-mobile-pay-sticker"
                            disabled={!canCollect || !onRegisterPayment}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              togglePay(item);
                            }}
                            title={isOpen ? "Cobro abierto" : "Pagar"}
                            aria-label={isOpen ? "Cobro abierto" : "Pagar"}
                            aria-expanded={isOpen}
                          >
                            <svg viewBox="0 0 16 12" aria-hidden="true" focusable="false">
                              <rect x="0.5" y="0.5" width="15" height="11" rx="1.5" fill="#dcfce7" stroke="#15803d" strokeWidth="1" />
                              <circle cx="8" cy="6" r="2.2" fill="none" stroke="#15803d" strokeWidth="1" />
                              <path d="M3 3.2h1.2M3 8.8h1.2M11.8 3.2H13M11.8 8.8H13" stroke="#15803d" strokeWidth="1" strokeLinecap="round" />
                            </svg>
                          </button>
                        </>
                      ) : null}
                    </div>

                    {isOpen && identity.awaitingLoan && onCreateQuickLoan ? (
                      <div className="collector-mobile-pay-inline">
                        <QuickLoanForm
                          clientName={identity.fullName}
                          clientRef={item.clientRef}
                          fundedByOptions={["efectivo"]}
                          defaultFundedBy="efectivo"
                          onCancel={closeCard}
                          onSave={(draft) => {
                            closeCard(true);
                            onCreateQuickLoan(draft);
                          }}
                        />
                      </div>
                    ) : null}

                    {isOpen && !identity.awaitingLoan && onRegisterPayment && identity.loan ? (
                      <div className="collector-mobile-pay-inline">
                        <CollectorPayForm
                          variant="inline"
                          formId={key}
                          clientName={identity.fullName}
                          clientRoute={assignmentRouteName(item, clients)}
                          amountDue={cuotaShown}
                          balance={identity.balance}
                          canRenew={renewEnabled}
                          combined={payCombo}
                          onCombinedChange={setPayCombo}
                          allowCombined={false}
                          onNoPay={
                            onSkipVisit
                              ? () => {
                                  onSkipVisit({
                                    routeRef,
                                    clientRef: item.clientRef,
                                    loanRef: identity.loanRef,
                                    dispatchDate: item.dispatchDate || activeDate,
                                    collectorRef: collector.ref,
                                    reason: NO_PAY_TODAY_REASON,
                                  });
                                  closeCard();
                                }
                              : undefined
                          }
                          onCancel={closeCard}
                          renewLoan={loanForRenew}
                          onRenew={
                            onRenewLoan && loanForRenew
                              ? (terms) => {
                                  closeCard(true);
                                  onRenewLoan(loanForRenew.ref, terms);
                                }
                              : undefined
                          }
                          onSubmit={async (payload) => {
                            closeCard(true);
                            if (payload.combined) {
                              await onRegisterPayment({
                                combined: true,
                                comboGroupId: payload.combined.comboGroupId,
                                paidTime: payload.combined.paidTime,
                                parts: [
                                  {
                                    idempotencyKey: payload.combined.parts[0].idempotencyKey,
                                    routeRef,
                                    clientRef: item.clientRef,
                                    loanRef: identity.loanRef,
                                    dispatchDate: item.dispatchDate || activeDate,
                                    amount: payload.combined.parts[0].amount,
                                    kind: payload.kind,
                                    method: payload.combined.parts[0].method,
                                    evidence: payload.combined.parts[0].evidence,
                                    collectorRef: collector.ref,
                                    collectorName: collector.name,
                                    clientName: identity.fullName,
                                    comboGroupId: payload.combined.comboGroupId,
                                    paidTime: payload.combined.paidTime,
                                  },
                                  {
                                    idempotencyKey: payload.combined.parts[1].idempotencyKey,
                                    routeRef,
                                    clientRef: item.clientRef,
                                    loanRef: identity.loanRef,
                                    dispatchDate: item.dispatchDate || activeDate,
                                    amount: payload.combined.parts[1].amount,
                                    kind: "abono",
                                    method: payload.combined.parts[1].method,
                                    evidence: payload.combined.parts[1].evidence,
                                    collectorRef: collector.ref,
                                    collectorName: collector.name,
                                    clientName: identity.fullName,
                                    comboGroupId: payload.combined.comboGroupId,
                                    paidTime: payload.combined.paidTime,
                                  },
                                ],
                              });
                              return;
                            }
                            await onRegisterPayment({
                              idempotencyKey: payload.idempotencyKey,
                              routeRef,
                              clientRef: item.clientRef,
                              loanRef: identity.loanRef,
                              dispatchDate: item.dispatchDate || activeDate,
                              amount: payload.amount,
                              kind: payload.kind,
                              method: payload.method,
                              evidence: payload.evidence,
                              collectorRef: collector.ref,
                              collectorName: collector.name,
                              clientName: identity.fullName,
                            });
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          ) : null}

          {routeOptions.length > 1 && activeRoute?.closed ? (
            <p className="collector-mobile-next-route">
              Esta ruta ya está cerrada.{" "}
              {routeOptions.some((row) => !row.closed && row.date !== activeDate)
                ? "Elige otra ruta en el desplegable para seguir cobrando."
                : "No tienes más rutas pendientes."}
            </p>
          ) : null}
        </>
      )}
      </>
      ) : null}
        </>
      )}

    </div>
  );
}
