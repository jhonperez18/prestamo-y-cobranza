"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CollectorCloseDayConfirm } from "@/components/CollectorCloseDayConfirm";
import { CollectorCloseDaySheet } from "@/components/CollectorCloseDaySheet";
import {
  CollectorClosedDayReview,
  type ClosedDayDetail,
} from "@/components/CollectorClosedDayReview";
import { CollectorPayForm } from "@/components/CollectorPayForm";
import { QuickLoanForm } from "@/components/QuickLoanForm";
import type { QuickLoanDraft } from "@/lib/street-client-loan";
import { Pill } from "@/components/ui";
import {
  collectorMobileQueue,
  collectorMobileRoutes,
  collectorRecaudoBreakdown,
  defaultMobileRouteDate,
  visitStatusKind,
  visitStatusLabel,
} from "@/lib/collector-mobile";
import { periodLabel } from "@/lib/bank";
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  money,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import type { CollectorPaymentDraft } from "@/lib/route-sync";
import { canRenewLoan } from "@/lib/loan-renew";
import { syncLoan } from "@/lib/loan-preview";
import { primaryLoanForClient } from "@/lib/route-sync";
import { dispatchRouteRef } from "@/lib/collector-dispatch-sync";
import { collectionAlertLabel, COLLECTION_ALERTS_BEFORE_MORA } from "@/lib/collection-alerts";
import {
  planillaAlertBadgeText,
  planillaAlertTitle,
  planillaLiveAlertCount,
  planillaLiveCuota,
} from "@/lib/planilla-display";
import type {
  RouteExpenseLine,
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
  CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import {
  buildCollectorDayHistory,
  expensesForCollectorDay,
  findMonthClose,
  isLastCalendarDayOfMonth,
  monthClosingSaldoFromHistory,
  monthReviewBlock,
  normalizeHistoryDate,
  openingSaldoForPeriod,
  periodFromDateIso,
  periodHadCollectorActivity,
  previousPeriod,
} from "@/lib/collector-day-close";
import {
  normalizePaymentMethod,
  paymentMethodKind,
  paymentMethodLabel,
  paymentMethodToneClass,
} from "@/lib/payment-method";

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
  collected: number;
  expenses: RouteExpenseLine[];
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
  date?: string;
  preview?: boolean;
  canRegister?: boolean;
  onRegisterPayment?: (draft: CollectorPaymentDraft) => boolean | void;
  /** @deprecated Ya no se usa en la lista: sin pago = sigue el saldo. */
  onSkipVisit?: (draft: CollectorSkipVisitDraft) => void;
  onRenewLoan?: (loanRef: string) => void;
  onCreateQuickLoan?: (draft: QuickLoanDraft) => void;
  onSaveExpenses?: (payload: CollectorSaveExpensesPayload) => void;
  onCloseDay?: (payload: CollectorCloseDayPayload) => void;
  onCloseMonth?: (payload: CollectorCloseMonthPayload) => void;
  onLogout?: () => void;
};

type ListFilter = "pending" | "done";

function itemKey(item: DailyCollectionAssignment) {
  return `${item.itemId}-${item.dispatchDate}`;
}

/** Vista compacta: #, nombre completo, apodo, saldo, cuota. */
function visitIdentity(
  item: DailyCollectionAssignment,
  clients: ClientRow[],
  loans: LoanRow[],
  payments: PaymentRow[],
  today = todayIso(),
) {
  const client = clients.find((row) => row.ref === item.clientRef);
  const awaitingLoan = Boolean(item.awaitingLoan || client?.awaitingLoan);
  const rawLoan = awaitingLoan
    ? null
    : (item.loanRef ? loans.find((row) => row.ref === item.loanRef) : null) ??
      primaryLoanForClient(item.clientRef, loans);
  const loan = rawLoan ? (syncLoan(rawLoan, payments) as LoanRow) : null;
  const cuota = awaitingLoan ? 0 : planillaLiveCuota(item, loan, today);
  const balance = awaitingLoan ? 0 : loan?.balance ?? 0;
  const alertCount = awaitingLoan ? 0 : planillaLiveAlertCount(item, loan, payments, today);
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
    loanRef: loan?.ref ?? item.loanRef ?? "",
    awaitingLoan,
    alertCount,
    alertBadge: planillaAlertBadgeText(alertCount),
    alertTitle: planillaAlertTitle(alertCount),
    alertLabel: alertCount > 0 ? collectionAlertLabel(alertCount) : "",
    inMora: alertCount >= COLLECTION_ALERTS_BEFORE_MORA,
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
  date,
  preview = false,
  canRegister = true,
  onRegisterPayment,
  onRenewLoan,
  onCreateQuickLoan,
  onSaveExpenses,
  onCloseDay,
  onCloseMonth,
  onLogout,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>("pending");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingExpenses, setEditingExpenses] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [cuadreDetail, setCuadreDetail] = useState<ClosedDayDetail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Totales de Recaudo/Gastos arriba: solo con día elegido desde Historial. */
  const [fromHistory, setFromHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Cada cobrador es independiente: al cambiar, vuelve a su propio inicio (antes del paint). */
  useLayoutEffect(() => {
    setExpandedKey(null);
    setListFilter("pending");
    setSelectedDate(null);
    setEditingExpenses(false);
    setConfirmingClose(false);
    setCuadreDetail(null);
    setHistoryOpen(false);
    setFromHistory(false);
    setMenuOpen(false);
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
    () => collectorMobileRoutes(collector.ref, assignments, loans, clients, routes, dayCloses),
    [assignments, clients, collector.ref, dayCloses, loans, routes],
  );

  const activeDate = useMemo(() => {
    const fallback = date ?? todayIso();
    if (selectedDate) return selectedDate;
    return defaultMobileRouteDate(routeOptions, fallback);
  }, [date, routeOptions, selectedDate]);

  const viewPeriod = periodFromDateIso(activeDate);

  const dayHistory = useMemo(() => {
    const extraDates = [
      ...routeOptions.map((row) => row.date),
      date ?? todayIso(),
      activeDate,
    ];
    return buildCollectorDayHistory(
      collector.ref,
      payments,
      dayCloses,
      [collector],
      extraDates,
      dayExpenseDrafts,
      monthCloses,
      viewPeriod,
      { assignments },
    );
  }, [
    activeDate,
    assignments,
    collector,
    date,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
    payments,
    routeOptions,
    viewPeriod,
  ]);

  const closedHistoryDates = useMemo(() => {
    const set = new Set<string>();
    for (const row of dayCloses) {
      if (row.collectorRef !== collector.ref) continue;
      const d = normalizeHistoryDate(row.date);
      if (d) set.add(d);
    }
    for (const row of assignments) {
      if (row.collectorRef !== collector.ref || !row.dayClosedAt) continue;
      const d = normalizeHistoryDate(row.dispatchDate);
      if (d) set.add(d);
    }
    return set;
  }, [assignments, collector.ref, dayCloses]);

  const activePeriod = viewPeriod;
  const previousMonth = previousPeriod(activePeriod);
  const priorMonthHadActivity = periodHadCollectorActivity(
    collector.ref,
    previousMonth,
    payments,
    dayCloses,
    dayExpenseDrafts,
    [collector],
  );
  const monthBlock = monthReviewBlock({
    collectorRef: collector.ref,
    date: activeDate,
    monthCloses,
    priorMonthHadActivity,
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
      payments,
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
  }, [assignments, collector, dayCloses, dayExpenseDrafts, monthCloses, payments, previousMonth]);

  const carriedOpening = openingSaldoForPeriod(collector.ref, viewPeriod, monthCloses);

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
      ),
    [activeDate, assignments, clients, collector.ref, dayCloses, loans, routes],
  );
  const dayWasClosedByCollector = queue.closed;
  const dayLocked = dayWasClosedByCollector;
  const today = date ?? todayIso();
  const isPastOpenDay = !dayLocked && activeDate < today;
  const canCloseDay = Boolean(onCloseDay) && !dayLocked && queue.dispatched.length > 0;
  /** No más cobros si la jornada cerró o ya no hay pendientes. */
  const collectionStopped = dayLocked || queue.allDone;

  const routeRef = queue.routeRef ?? dispatchRouteRef(collector.ref, activeDate);
  const visibleItems = listFilter === "done" ? queue.done : queue.pending;
  const recaudo = useMemo(
    () => collectorRecaudoBreakdown(collector.ref, activeDate, payments, [collector]),
    [activeDate, collector, payments],
  );
  /** Meta del día: suma de cuotas de los pendientes (lo que debería recaudar). */
  const pendingMeta = useMemo(() => {
    return queue.pending.reduce((sum, item) => {
      if (item.amountDue > 0) return sum + item.amountDue;
      const loan =
        (item.loanRef ? loans.find((row) => row.ref === item.loanRef) : null) ??
        primaryLoanForClient(item.clientRef, loans);
      if (!loan || loan.balance <= 0) return sum;
      const cuota =
        loan.installment && loan.installment > 0
          ? Math.min(loan.installment, loan.balance)
          : 0;
      return sum + cuota;
    }, 0);
  }, [loans, queue.pending]);

  const savedExpenses = useMemo(
    () => expensesForCollectorDay(collector.ref, activeDate, dayCloses, dayExpenseDrafts),
    [activeDate, collector.ref, dayCloses, dayExpenseDrafts],
  );
  const savedExpensesTotal = savedExpenses.reduce((sum, row) => sum + row.amount, 0);

  const dayCuadre = useMemo(() => {
    const periodOpening = openingSaldoForPeriod(collector.ref, viewPeriod, monthCloses);
    const ascending = [...dayHistory].sort((a, b) => a.date.localeCompare(b.date));
    const todayRow = ascending.find((row) => row.date === activeDate);
    const prior = ascending.filter((row) => row.date < activeDate);
    const saldoInicial = prior.length ? prior[prior.length - 1].saldo : periodOpening;
    // Cobrado = pagos reales del día (igual que Recaudo / banco Debe).
    const cobrado = recaudo.total;
    const gastos = todayRow?.gasto ?? savedExpensesTotal;
    const saldo = saldoInicial + cobrado - gastos;
    return { saldoInicial, cobrado, gastos, saldo };
  }, [
    activeDate,
    collector.ref,
    dayHistory,
    monthCloses,
    recaudo.total,
    savedExpensesTotal,
    viewPeriod,
  ]);

  useEffect(() => {
    setExpandedKey(null);
    setEditingExpenses(false);
    setConfirmingClose(false);
    setCuadreDetail(null);
  }, [activeDate, listFilter]);

  function togglePay(item: DailyCollectionAssignment) {
    if (!canCollect || collectionStopped || !onRegisterPayment) return;
    const key = itemKey(item);
    setExpandedKey((current) => {
      const next = current === key ? null : key;
      if (next) {
        queueMicrotask(() => {
          document
            .getElementById(`collector-pay-card-${key}`)
            ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
      }
      return next;
    });
  }

  function closeCard() {
    setExpandedKey(null);
  }

  function selectFilter(next: ListFilter) {
    setEditingExpenses(false);
    setConfirmingClose(false);
    setListFilter(next);
    closeCard();
  }

  function openExpenses() {
    // Inicio con jornada cerrada: datos solo desde Historial.
    if (dayLocked && !fromHistory) return;
    if (dayLocked) {
      setExpandedKey(null);
      setConfirmingClose(false);
      setEditingExpenses(false);
      setCuadreDetail("gastos");
      setListFilter("pending");
      return;
    }
    if (!onSaveExpenses) return;
    setExpandedKey(null);
    setConfirmingClose(false);
    setCuadreDetail(null);
    setEditingExpenses(true);
  }

  function openRecaudoDetail() {
    if (dayLocked && !fromHistory) return;
    if (!dayLocked) {
      selectFilter("done");
      return;
    }
    setExpandedKey(null);
    setEditingExpenses(false);
    setConfirmingClose(false);
    setCuadreDetail("cobros");
    setListFilter("pending");
  }

  function saveExpenses(expenses: RouteExpenseLine[]) {
    if (!onSaveExpenses) return;
    onSaveExpenses({
      date: activeDate,
      routeRef,
      collectorRef: collector.ref,
      collectorName: collector.name,
      expenses,
    });
    setEditingExpenses(false);
  }

  function openCloseConfirm() {
    if (!onCloseDay || dayLocked) return;
    setMenuOpen(false);
    setExpandedKey(null);
    setEditingExpenses(false);
    setConfirmingClose(true);
  }

  function openHistory() {
    setMenuOpen(false);
    setHistoryOpen(true);
  }

  function confirmCloseDay() {
    if (!onCloseDay || dayLocked) return;
    onCloseDay({
      date: activeDate,
      routeRef,
      collectorRef: collector.ref,
      collectorName: collector.name,
      collected: recaudo.total,
      expenses: savedExpenses,
    });
    setConfirmingClose(false);
    // Queda en el día cerrado con el cuadre (como Lina), no vuelve al inicio en blanco.
    setFromHistory(true);
    setListFilter("pending");
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

  const reviewingPanel = editingExpenses || confirmingClose || Boolean(cuadreDetail);

  const visitRows = useMemo(
    () => queue.dispatched.filter((row) => !row.awaitingLoan),
    [queue.dispatched],
  );
  const cobradoCount = useMemo(() => recaudo.count, [recaudo.count]);
  const visitTotal = visitRows.length;

  /** Inicio tras cierre: lista en blanco; si el día tiene cobros/gastos reales, se muestran. */
  const onInicioCerrado = dayLocked && !fromHistory;
  const blankStart =
    onInicioCerrado && recaudo.total <= 0 && savedExpensesTotal <= 0;
  /** Totales = pagos reales del día (mismo número que banco Debe / “Lo que cobró”). */
  const topRecaudo = recaudo.total;
  const topGastos = savedExpensesTotal;
  const topCobrosLabel =
    cobradoCount > 0 || visitTotal > 0
      ? `${cobradoCount}/${Math.max(visitTotal, cobradoCount)} cobros`
      : null;

  const openPlanillaDates = useMemo(
    () => new Set(routeOptions.filter((row) => !row.closed).map((row) => row.date)),
    [routeOptions],
  );

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
        <div className="collector-mobile-brand">
          <div className="collector-mobile-logo-col">
            <img src="/logo-ca-prestamo.png" alt="CA préstamo" className="brand-logo" />
          </div>
          <div className="collector-mobile-user-meta">
            <p className="collector-mobile-greet">Hola, {collector.name.split(" ")[0]}</p>
            <span className="collector-mobile-date">{queue.dateLabel}</span>
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
              <button
                type="button"
                role="menuitem"
                className="collector-mobile-menu-item"
                disabled={!canCloseDay}
                title="Revisar y confirmar cierre del día"
                onClick={openCloseConfirm}
              >
                {confirmingClose ? "Revisando…" : "Cerrar día"}
              </button>
            </div>
          ) : null}
        </div>
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
              <h2 id="collector-history-title">Historial</h2>
              <span>{periodLabel(viewPeriod)}</span>
            </div>
            <button
              type="button"
              className="collector-mobile-pay-link"
              onClick={() => setHistoryOpen(false)}
            >
              volver
            </button>
          </header>

          <div className="collector-mobile-day-history is-panel">
            <div className="collector-mobile-day-history-head">
              <span>Día</span>
              <span>Cobro</span>
              <span>Gasto</span>
              <span>Saldo</span>
            </div>
            <ul className="collector-mobile-day-history-list">
              {carriedOpening > 0 ? (
                <li>
                  <div className="collector-mobile-day-history-row is-opening">
                    <span className="is-date">Ant.</span>
                    <span className="is-money">—</span>
                    <span className="is-money">—</span>
                    <span className={carriedOpening < 0 ? "is-saldo is-negative" : "is-saldo"}>
                      {money(carriedOpening, { symbol: false })}
                    </span>
                  </div>
                </li>
              ) : null}
              {dayHistory.filter(
                (row) =>
                  row.cobro > 0 ||
                  row.gasto > 0 ||
                  row.date === activeDate ||
                  openPlanillaDates.has(row.date) ||
                  closedHistoryDates.has(row.date),
              ).length === 0 ? (
                <li className="collector-mobile-day-history-empty">Sin movimientos este mes.</li>
              ) : (
                dayHistory
                  .filter(
                    (row) =>
                      row.cobro > 0 ||
                      row.gasto > 0 ||
                      row.date === activeDate ||
                      openPlanillaDates.has(row.date) ||
                      closedHistoryDates.has(row.date),
                  )
                  .map((row) => (
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
                        setFromHistory(true);
                        setListFilter("pending");
                        setCuadreDetail(null);
                        setEditingExpenses(false);
                        setConfirmingClose(false);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="is-date">{row.dateLabel}</span>
                      <span className="is-money">{money(row.cobro, { symbol: false })}</span>
                      <span className="is-money">{money(row.gasto, { symbol: false })}</span>
                      <span className={row.saldo < 0 ? "is-saldo is-negative" : "is-saldo"}>
                        {money(row.saldo, { symbol: false })}
                      </span>
                    </button>
                  </li>
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
      ) : null}

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

      <div className={dayLocked ? "collector-mobile-stats" : "collector-mobile-stats has-inicial"}>
        {!dayLocked ? (
          <div
            className="collector-mobile-stat is-inicial readonly"
            title="Saldo en caja al iniciar el día (cierre del día anterior)"
          >
            <span>Inicial</span>
            <b>{money(dayCuadre.saldoInicial)}</b>
          </div>
        ) : null}
        <button
          type="button"
          className={
            blankStart
              ? "collector-mobile-stat is-pending is-off"
              : !reviewingPanel && listFilter === "pending"
                ? "collector-mobile-stat is-pending on"
                : "collector-mobile-stat is-pending"
          }
          disabled={blankStart}
          title={blankStart ? "Consulta el día en Historial" : undefined}
          onClick={() => {
            if (blankStart) return;
            selectFilter("pending");
          }}
        >
          <span>Por cobrar</span>
          <b>{queue.pending.length}</b>
          <em className="collector-mobile-stat-meta">
            {pendingMeta > 0 ? money(pendingMeta) : "—"}
          </em>
        </button>
        <button
          type="button"
          className={
            blankStart
              ? "collector-mobile-stat is-recaudo is-off"
              : !reviewingPanel && listFilter === "done"
                ? "collector-mobile-stat is-recaudo on"
                : cuadreDetail === "cobros"
                  ? "collector-mobile-stat is-recaudo on"
                  : "collector-mobile-stat is-recaudo"
          }
          disabled={blankStart}
          title={blankStart ? "Consulta el día en Historial" : undefined}
          onClick={openRecaudoDetail}
        >
          <span>Recaudo</span>
          <b>{money(topRecaudo)}</b>
          {topCobrosLabel ? (
            <em className="collector-mobile-stat-meta">{topCobrosLabel}</em>
          ) : null}
        </button>
        <button
          type="button"
          className={
            blankStart
              ? "collector-mobile-stat collector-mobile-stat-close is-gastos is-off"
              : editingExpenses || cuadreDetail === "gastos"
                ? "collector-mobile-stat on collector-mobile-stat-close is-gastos"
                : "collector-mobile-stat collector-mobile-stat-close is-gastos"
          }
          disabled={
            blankStart
              ? true
              : dayLocked
                ? !queue.dispatched.length && savedExpensesTotal <= 0
                : !onSaveExpenses || !queue.dispatched.length
          }
          title={
            blankStart
              ? "Consulta el día en Historial"
              : dayLocked
                ? savedExpensesTotal > 0
                  ? "Ver gastos del día"
                  : "Sin gastos"
                : !onSaveExpenses
                  ? "Sin permiso para gastos"
                  : !queue.dispatched.length
                    ? "Sin planilla"
                    : "Gastos del día"
          }
          onClick={openExpenses}
        >
          <span>Gastos</span>
          <b>{topGastos > 0 ? money(topGastos) : "—"}</b>
        </button>
      </div>

      {isPastOpenDay && canCloseDay && !confirmingClose && !editingExpenses ? (
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

      {queue.closed && listFilter === "pending" && !editingExpenses && !confirmingClose ? (
        cuadreDetail && fromHistory ? (
          <CollectorClosedDayReview
            detail={cuadreDetail}
            dateLabel={queue.dateLabel}
            visits={visitRows}
            expenses={savedExpenses}
            payments={payments}
            cobradoCount={cobradoCount}
            visitTotal={visitTotal}
            onBack={() => setCuadreDetail(null)}
          />
        ) : (
        <section className="collector-mobile-home-cuadre" aria-label="Cuadre de la jornada">
          <div className="collector-mobile-home-cuadre-head">
            <Pill label="Jornada cerrada" kind="paid" />
            <div className="collector-mobile-home-cuadre-title-row">
              <h2>
                {activeDate === (date ?? todayIso())
                  ? "Tu cuadre de hoy"
                  : `Tu cuadre del ${queue.dateLabel}`}
              </h2>
              {visitTotal > 0 ? (
                <p className="collector-mobile-home-cuadre-progress">
                  {cobradoCount}/{visitTotal} cobros
                </p>
              ) : null}
            </div>
          </div>

          <div className="collector-mobile-home-cuadre-grid">
            <div className="is-inicial">
              <span>Lo que inició</span>
              <b>{money(dayCuadre.saldoInicial)}</b>
            </div>
            {fromHistory ? (
              <button
                type="button"
                className="is-cobrado is-tap"
                onClick={() => setCuadreDetail("cobros")}
              >
                <span>Lo que cobró</span>
                <b>{money(dayCuadre.cobrado)}</b>
                <em>Ver lista</em>
              </button>
            ) : (
              <div className="is-cobrado">
                <span>Lo que cobró</span>
                <b>{money(dayCuadre.cobrado)}</b>
              </div>
            )}
            {fromHistory ? (
              <button
                type="button"
                className="is-gastos is-tap"
                onClick={() => setCuadreDetail("gastos")}
              >
                <span>Lo que gastó</span>
                <b>{money(dayCuadre.gastos)}</b>
                <em>Ver lista</em>
              </button>
            ) : (
              <div className="is-gastos">
                <span>Lo que gastó</span>
                <b>{money(dayCuadre.gastos)}</b>
              </div>
            )}
            <div className="is-saldo">
              <span>Saldo en caja</span>
              <b>{money(dayCuadre.saldo)}</b>
              <em>
                {activeDate === (date ?? todayIso())
                  ? "Inicial de mañana"
                  : "Inicial del día siguiente"}
              </em>
            </div>
          </div>

          <div className="collector-mobile-home-cuadre-means">
            {fromHistory ? (
              <>
                <button
                  type="button"
                  className="is-tap-mean"
                  onClick={() => setCuadreDetail("cobros")}
                >
                  <span>Efectivo</span>
                  <b>{money(recaudo.efectivo)}</b>
                </button>
                <button
                  type="button"
                  className="is-tap-mean"
                  onClick={() => setCuadreDetail("cobros")}
                >
                  <span>Nequi</span>
                  <b>{money(recaudo.nequi)}</b>
                </button>
              </>
            ) : (
              <>
                <div>
                  <span>Efectivo</span>
                  <b>{money(recaudo.efectivo)}</b>
                </div>
                <div>
                  <span>Nequi</span>
                  <b>{money(recaudo.nequi)}</b>
                </div>
              </>
            )}
          </div>
        </section>
        )
      ) : null}

      {!(queue.closed && listFilter === "pending" && !editingExpenses && !confirmingClose) ? (
      <>
      {editingExpenses && onSaveExpenses ? (
        <CollectorCloseDaySheet
          key={`${collector.ref}-${activeDate}-${savedExpenses.map((r) => `${r.id}:${r.amount}`).join("|")}`}
          draft={{
            collectorRef: collector.ref,
            collectorName: collector.name,
            date: activeDate,
            routeRef,
            collected: recaudo.total,
            expenses: savedExpenses,
          }}
          onCancel={() => setEditingExpenses(false)}
          onSave={saveExpenses}
        />
      ) : confirmingClose && onCloseDay ? (
        <CollectorCloseDayConfirm
          dateLabel={queue.dateLabel}
          collected={recaudo.total}
          efectivo={recaudo.efectivo}
          nequi={recaudo.nequi}
          expenses={savedExpenses}
          pendingCount={queue.pending.length}
          onCancel={() => setConfirmingClose(false)}
          onConfirm={confirmCloseDay}
        />
      ) : (
        <>
      {listFilter === "done" ? (
        <section className="collector-mobile-cuadre" aria-label="Cuadre de recaudo por medio de pago">
          <h2>Cuadre del día</h2>
          <div className="collector-mobile-cuadre-grid">
            <div className="is-pay-efectivo">
              <em>Efectivo</em>
              <b>{money(recaudo.efectivo)}</b>
            </div>
            <div className="is-pay-nequi">
              <em>Nequi</em>
              <b>{money(recaudo.nequi)}</b>
            </div>
            <div className="is-total">
              <em>Total</em>
              <b>{money(recaudo.total)}</b>
            </div>
          </div>
        </section>
      ) : null}

      {queue.awaitingDispatch.length > 0 && !queue.dispatched.length ? (
        <p className="collector-mobile-note warn">
          Tienes {queue.awaitingDispatch.length} cobro(s) asignados. La planilla permanente se envía
          sola; si ves este aviso, vuelve a abrir la app o pide a oficina revisar la ruta.
        </p>
      ) : null}

      {!queue.dispatched.length && !queue.awaitingDispatch.length ? (
        <section className="collector-mobile-empty">
          <h2>Sin planilla de hoy</h2>
          <p>
            La planilla se genera sola Lun–sáb (sin festivos) al iniciar el día y se envía a tu ruta
            asignada. Si no ves cobros, revisa que oficina tenga cobrador en tu ruta o vuelve a abrir
            la app.
          </p>
        </section>
      ) : (
        <>
          <ul className={listFilter === "done" ? "collector-mobile-list compact" : "collector-mobile-list compact"}>
            {visibleItems.length === 0 ? (
              <li className="collector-mobile-empty-inline">
                {listFilter === "done"
                  ? recaudo.total > 0
                    ? "El cuadre arriba es para tus cuentas (efectivo / Nequi). Abajo van las visitas de la ruta."
                    : "Aún no hay cobros. Al pagar, el cuadre suma efectivo y Nequi por separado."
                  : dayLocked
                    ? "Jornada cerrada. Elige otra fecha en Historial si tienes más."
                    : queue.allDone
                      ? "Listo: ya no hay pendientes. Cierra el día en el menú para archivar la jornada."
                      : "¡Listo! No quedan cobros pendientes en esta ruta."}
              </li>
            ) : (
              visibleItems.map((item) => {
                const key = itemKey(item);
                const isOpen = expandedKey === key;
                const isDoneView = listFilter === "done";
                const identity = visitIdentity(item, clients, loans, payments, activeDate);
                const paidPayment = item.paymentRef
                  ? payments.find((row) => row.ref === item.paymentRef)
                  : undefined;
                const payMethod = paidPayment
                  ? normalizePaymentMethod(paidPayment.method)
                  : null;
                const canLend =
                  identity.awaitingLoan &&
                  !collectionStopped &&
                  canCollect &&
                  Boolean(onCreateQuickLoan);
                const canAct =
                  !identity.awaitingLoan &&
                  item.visitStatus !== "cobrado" &&
                  item.visitStatus !== "omitido" &&
                  !item.paymentRef &&
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
                      isDoneView
                        ? "collector-mobile-card is-done is-dense"
                        : isOpen
                          ? "collector-mobile-card is-open is-dense"
                          : "collector-mobile-card is-dense",
                      identity.awaitingLoan ? "is-awaiting-loan" : "",
                      isDoneView && payMethod ? paymentMethodToneClass(payMethod) : "",
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
                      <div className="collector-mobile-visit-who">
                        <strong title={identity.fullName}>{identity.fullName}</strong>
                      </div>
                      {identity.awaitingLoan && !isDoneView && !isOpen ? (
                        <button
                          type="button"
                          className="collector-mobile-pay-link"
                          disabled={!canLend}
                          onClick={() => togglePay(item)}
                        >
                          Completar
                        </button>
                      ) : null}
                      {!identity.awaitingLoan && isDoneView ? (
                        <span className="collector-mobile-ref is-done-col">
                          {item.paymentRef ? `- ${item.paymentRef}` : "—"}
                        </span>
                      ) : null}
                      {!identity.awaitingLoan && !isDoneView ? (
                        <div className="collector-mobile-dense-money">
                          <span>
                            <b>{money(identity.balance, { symbol: false })}</b>
                          </span>
                          <span>
                            <b>{cuotaShown > 0 ? money(cuotaShown, { symbol: false }) : "—"}</b>
                          </span>
                        </div>
                      ) : null}
                      {!identity.awaitingLoan && isDoneView ? (
                        <Pill
                          label={
                            payMethod
                              ? paymentMethodLabel(payMethod)
                              : visitStatusLabel(item.visitStatus)
                          }
                          kind={
                            payMethod
                              ? paymentMethodKind(payMethod)
                              : visitStatusKind(item.visitStatus)
                          }
                        />
                      ) : null}
                      {!identity.awaitingLoan && !isDoneView && canAct && !isOpen ? (
                        <>
                          <span
                            className={
                              identity.alertCount > 0
                                ? identity.inMora
                                  ? "collector-mobile-alert-n is-mora"
                                  : "collector-mobile-alert-n"
                                : "collector-mobile-alert-n is-empty"
                            }
                            title={identity.alertTitle}
                            aria-hidden={identity.alertCount <= 0}
                          >
                            {identity.alertBadge}
                          </span>
                          <button
                            type="button"
                            className="collector-mobile-pay-sticker"
                            disabled={!canCollect || !onRegisterPayment}
                            onClick={() => togglePay(item)}
                            title="Pagar"
                            aria-label="Pagar"
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
                          onCancel={closeCard}
                          onSave={(draft) => {
                            onCreateQuickLoan(draft);
                            closeCard();
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
                          amountDue={cuotaShown}
                          balance={identity.balance}
                          canRenew={renewEnabled}
                          onCancel={closeCard}
                          onRenew={
                            onRenewLoan && loanForRenew
                              ? () => {
                                  onRenewLoan(loanForRenew.ref);
                                  closeCard();
                                }
                              : undefined
                          }
                          onSubmit={(payload) => {
                            const ok = onRegisterPayment({
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
                            // Solo cerrar si el cobro quedó registrado (o el handler no reporta fallo).
                            if (ok !== false) closeCard();
                          }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>

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
      )}
      </>
      ) : null}

      {onLogout && !preview ? (
        <footer className="collector-mobile-foot mobile-app-logout-foot">
          <button type="button" className="btn aside-logout" onClick={onLogout}>
            Cerrar sesión
          </button>
        </footer>
      ) : null}
    </div>
  );
}
