"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CollectorCloseDayConfirm } from "@/components/CollectorCloseDayConfirm";
import { CollectorCloseDaySheet } from "@/components/CollectorCloseDaySheet";
import { CollectorPayForm } from "@/components/CollectorPayForm";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { QuickLoanForm } from "@/components/QuickLoanForm";
import type { QuickLoanDraft } from "@/lib/street-client-loan";
import { Pill } from "@/components/ui";
import {
  collectorHasOpenPlanillaWork,
  collectorMobileQueue,
  collectorMobileRoutes,
  collectorDayPayments,
  collectorRecaudoBreakdown,
  defaultMobileRouteDate,
} from "@/lib/collector-mobile";
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
import type { CollectorPaymentRegisterInput } from "@/lib/route-sync";
import { canRenewLoan } from "@/lib/loan-renew";
import { reloanStateForVisit } from "@/lib/loan-reloan";
import { syncLoan } from "@/lib/loan-preview";
import { primaryLoanForClient } from "@/lib/route-sync";
import {
  assignmentRouteName,
  dispatchRouteRef,
  NO_PAY_TODAY_REASON,
} from "@/lib/collector-dispatch-sync";
import { compareRoutePosition, routeBlockStarts } from "@/lib/client-route-order";
import {
  loadLivePaymentRows,
  mergePaymentsByRef,
  pullRemotePaymentsIntoDemo,
} from "@/lib/supabase/payment-mirror";
import { suppressGhostClick, isNavQuiet } from "@/lib/suppress-ghost-click";
import { createNavIntent, navButtonProps } from "@/lib/nav-intent";
import { CuotasProgressCell } from "@/components/CuotasProgressCell";
import {
  planillaLiveCuota,
  planillaLiveCuotasProgress,
} from "@/lib/planilla-display";
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
  monthClosingSaldoFromHistory,
  monthReviewBlock,
  normalizeHistoryDate,
  openingSaldoForPeriod,
  periodFromDateIso,
  periodHadCollectorActivity,
  previousPeriod,
} from "@/lib/collector-day-close";
import { withPaymentEvidence } from "@/lib/payment-evidence-store";
import { paymentTimeLabel } from "@/lib/payment-detail";
import {
  normalizePaymentMethod,
  paymentMethodInitial,
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
  /** Total del día (efectivo + Nequi). */
  collected: number;
  /** Solo efectivo → caja menor del cobrador. */
  collectedEfectivo: number;
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
  onRegisterPayment?: (draft: CollectorPaymentRegisterInput) => boolean | void;
  /** N/P: hoy no tiene plata. Sale de por cobrar y entra a S/N. */
  onSkipVisit?: (draft: CollectorSkipVisitDraft) => void;
  onRenewLoan?: (loanRef: string) => void;
  onCreateQuickLoan?: (draft: QuickLoanDraft) => void;
  onSaveExpenses?: (payload: CollectorSaveExpensesPayload) => void;
  onCloseDay?: (payload: CollectorCloseDayPayload) => void;
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

type HistoryPayMethod = "efectivo" | "nequi" | "banco" | "doble" | "np" | "vacio";

function isHistoryFiller(row: DailyCollectionAssignment) {
  return Boolean(
    row.awaitingLoan || row.itemId.includes(":prestar") || !String(row.loanRef || "").trim(),
  );
}

function historyPayMethod(pays: PaymentRow[]): HistoryPayMethod {
  const methods = new Set(pays.map((row) => normalizePaymentMethod(row.method)));
  const combo = pays.some((row) => row.comboGroupId) && pays.length > 1;
  if (methods.size > 1 || combo) return "doble";
  return [...methods][0] ?? "efectivo";
}

function historyMethodLabel(method: HistoryPayMethod) {
  if (method === "nequi") return "Nequi";
  if (method === "banco") return "Banco";
  if (method === "doble") return "Doble";
  if (method === "np") return "N/P";
  if (method === "vacio") return "—";
  return "Efectivo";
}

function historyClock(pays: PaymentRow[]) {
  const label = pays
    .map((pay) => paymentTimeLabel(pay).trim())
    .find((value) => value && value !== "00:00" && value !== "0:00");
  return label || "—";
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
  const awaitingLoan = Boolean(
    (item.awaitingLoan || item.itemId.includes(":prestar")) && !item.loanRef,
  );
  const rawLoan = awaitingLoan
    ? null
    : (item.loanRef ? loans.find((row) => row.ref === item.loanRef) : null) ??
      primaryLoanForClient(item.clientRef, loans);
  const loan = rawLoan ? (syncLoan(rawLoan, payments) as LoanRow) : null;
  const cuota = awaitingLoan ? 0 : planillaLiveCuota(item, loan, payments, today);
  const balance = awaitingLoan ? 0 : loan?.balance ?? 0;
  const cuotas = awaitingLoan
    ? null
    : planillaLiveCuotasProgress(loan, payments, today);
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
  date,
  preview = false,
  canRegister = true,
  onRegisterPayment,
  onSkipVisit,
  onRenewLoan,
  onCreateQuickLoan,
  onSaveExpenses,
  onCloseDay,
  onCloseMonth,
  onLogout,
}: Props) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [payCombo, setPayCombo] = useState(false);
  const [listFilter, setListFilter] = useState<ListFilter>("pending");
  /** Cobro (PG-) cuyo cliente terminó hoy y tiene abierto el formulario «Préstamo». */
  const [reloanPayRef, setReloanPayRef] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingExpenses, setEditingExpenses] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [planillaSearchOpen, setPlanillaSearchOpen] = useState(false);
  const [planillaQuery, setPlanillaQuery] = useState("");
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
        const rows = await loadLivePaymentRows();
        if (!cancelled && rows.length > 0) setApiPayments(rows);
        await pullRemotePaymentsIntoDemo();
      } catch (error) {
        console.error("collector-recaudo", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collector.ref]);

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

  const dayHistory = useMemo(() => {
    const extraDates = [
      ...routeOptions.map((row) => row.date),
      date ?? todayIso(),
      activeDate,
    ];
    return buildCollectorDayHistory(
      collector.ref,
      livePayments,
      dayCloses,
      [collector],
      extraDates,
      dayExpenseDrafts,
      monthCloses,
      viewPeriod,
      { assignments, rolling: true },
    );
  }, [
    activeDate,
    assignments,
    collector,
    date,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
    livePayments,
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
        livePayments,
      ),
    [activeDate, assignments, clients, collector.ref, dayCloses, livePayments, loans, routes],
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
  /** Primer PG- del día por crédito: ahí va el botón / etiqueta «Préstamo». */
  const reloanAnchorByLoan = useMemo(() => {
    const anchor = new Map<string, string>();
    for (const pay of dayPays) {
      if (pay.loanRef && !anchor.has(pay.loanRef)) anchor.set(pay.loanRef, pay.ref);
    }
    return anchor;
  }, [dayPays]);

  const savedExpenses = useMemo(
    () => expensesForCollectorDay(collector.ref, activeDate, dayCloses, dayExpenseDrafts),
    [activeDate, collector.ref, dayCloses, dayExpenseDrafts],
  );
  const savedExpensesTotal = savedExpenses.reduce((sum, row) => sum + row.amount, 0);
  /** Capital prestado hoy en efectivo (sale del efectivo cobrado; ya va dentro de Gastos). */
  const prestadoEfectivo = savedExpenses
    .filter((row) => row.category === "prestamo_ruta")
    .reduce((sum, row) => sum + row.amount, 0);

  const dayCuadre = useMemo(() => {
    const periodOpening = openingSaldoForPeriod(collector.ref, viewPeriod, monthCloses);
    const ascending = [...dayHistory].sort((a, b) => a.date.localeCompare(b.date));
    const todayRow = ascending.find((row) => row.date === activeDate);
    const prior = ascending.filter((row) => row.date < activeDate);
    const saldoInicial = prior.length ? prior[prior.length - 1].saldo : periodOpening;
    const cobrado = recaudo.total;
    const gastos = todayRow?.gasto ?? savedExpensesTotal;
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
    setConfirmingClose(false);
  }, [activeDate]);

  function togglePay(item: DailyCollectionAssignment) {
    if (!canCollect || collectionStopped || !onRegisterPayment) return;
    const key = itemKey(item);
    // Billete = solo ABRIR. Cerrar es «cerrar» / confirmar.
    // Si toggléa, el click fantasma tras el reflow cierra el panel al instante.
    if (expandedKey === key) return;
    suppressGhostClick(720);
    setPayCombo(false);
    setExpandedKey(key);
  }

  function closeCard() {
    // Eco del billete suele caer en «cerrar» justo al abrir: ignorar.
    if (isNavQuiet()) return;
    suppressGhostClick(420);
    setExpandedKey(null);
  }

  function selectFilter(next: ListFilter) {
    if (isNavQuiet()) return;
    setEditingExpenses(false);
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
    if (!onSaveExpenses) return;
    setExpandedKey(null);
    setConfirmingClose(false);
    setEditingExpenses(true);
  }

  function openRecaudoDetail() {
    // Jornada cerrada: sin acceso a detalle de cobros.
    if (dayLocked) return;
    selectFilter("done");
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
      collectedEfectivo: recaudo.efectivo,
      expenses: savedExpenses,
    });
    setConfirmingClose(false);
    // Queda en el home de cierre (mismo panel para todos).
    setListFilter("pending");
    setSelectedDate(null);
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

  const reviewingPanel = editingExpenses || confirmingClose;
  /** Sin planilla abierta → mismo inicio (último cierre + saldo) para todos los cobradores. */
  const showHomeCuadre =
    listFilter === "pending" &&
    !editingExpenses &&
    !confirmingClose &&
    !collectorHasOpenPlanillaWork(queue);
  const chromeLocked = dayLocked || showHomeCuadre;

  const closedPlanilla = useMemo(() => {
    const pays = dayPays
      .filter((row) => !row.voidedAt?.trim())
      .map((row) => withPaymentEvidence(row));
    const used = new Set<string>();
    const rows: Array<{
      key: string;
      route: string;
      order: number | null;
      name: string;
      amount: number | null;
      time: string;
      evidence: NonNullable<PaymentRow["evidence"]>;
      method: HistoryPayMethod;
    }> = [];

    const visitClientRefs = new Set(
      queue.dispatched.filter((item) => !isHistoryFiller(item)).map((item) => item.clientRef),
    );
    const paidClientRefs = new Set(
      pays.map((pay) => loans.find((row) => row.ref === pay.loanRef)?.clientRef || ""),
    );

    for (const item of queue.dispatched) {
      if (
        isHistoryFiller(item) &&
        (visitClientRefs.has(item.clientRef) || paidClientRefs.has(item.clientRef))
      ) {
        continue;
      }
      const identity = visitIdentity(item, clients, loans, livePayments, activeDate);
      const sinCuota = isHistoryFiller(item) || !(identity.cuota > 0);
      const matched = pays.filter((pay) => {
        if (used.has(pay.ref)) return false;
        if (item.paymentRef && pay.ref === item.paymentRef) return true;
        return Boolean(item.loanRef && pay.loanRef && pay.loanRef === item.loanRef);
      });
      if (matched.length === 0 && item.paymentRef && used.has(item.paymentRef)) continue;
      const comboIds = new Set(
        matched.map((pay) => pay.comboGroupId).filter((id): id is string => Boolean(id)),
      );
      const grouped = pays.filter((pay) => {
        if (matched.some((row) => row.ref === pay.ref)) return true;
        return Boolean(pay.comboGroupId && comboIds.has(pay.comboGroupId));
      });
      for (const pay of grouped) used.add(pay.ref);
      rows.push({
        key: itemKey(item),
        route: assignmentRouteName(item, clients),
        order: identity.order,
        name: identity.fullName,
        amount: grouped.length
          ? grouped.reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0)
          : sinCuota
            ? null
            : identity.cuota,
        time: grouped.length ? historyClock(grouped) : "—",
        evidence: grouped.length ? grouped.flatMap((pay) => pay.evidence ?? []) : [],
        method: grouped.length ? historyPayMethod(grouped) : sinCuota ? "vacio" : "np",
      });
    }

    for (const pay of pays) {
      if (used.has(pay.ref)) continue;
      const siblings = pay.comboGroupId
        ? pays.filter((row) => row.comboGroupId === pay.comboGroupId)
        : [pay];
      if (siblings.some((row) => row.ref !== pay.ref && used.has(row.ref))) {
        used.add(pay.ref);
        continue;
      }
      for (const row of siblings) used.add(row.ref);
      const loan = loans.find((row) => row.ref === pay.loanRef);
      const client = clients.find((row) => row.ref === loan?.clientRef);
      rows.push({
        key: siblings.map((row) => row.ref).join("|"),
        route: String(client?.route || "").trim(),
        order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
        name: payerName(pay, loans, clients),
        amount: siblings.reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
        time: historyClock(siblings),
        evidence: siblings.flatMap((row) => row.evidence ?? []),
        method: historyPayMethod(siblings),
      });
    }

    // Ruta 1 (# 1…N) → Ruta 1.1 (# 1…N): mismo orden que la planilla y el supervisor.
    return rows.sort(
      (a, b) =>
        compareRoutePosition(a.route, a.order, b.route, b.order) ||
        a.name.localeCompare(b.name, "es"),
    );
  }, [activeDate, clients, dayPays, livePayments, loans, queue.dispatched]);

  const planillaQueryNorm = planillaQuery.trim().toLocaleLowerCase("es");
  const planillaRows =
    planillaSearchOpen && planillaQueryNorm
      ? closedPlanilla.filter((row) => {
          const name = row.name.toLocaleLowerCase("es");
          return name.includes(planillaQueryNorm) || String(row.order ?? "").includes(planillaQueryNorm);
        })
      : closedPlanilla;
  /** Raya gris donde cambia la ruta (Ruta 1 → Ruta 1.1). */
  const planillaRouteStarts = routeBlockStarts(planillaRows, (row) => row.route);
  const pendingRouteStarts = routeBlockStarts(visibleItems, (item) =>
    assignmentRouteName(item, clients),
  );

  /** Totales = pagos reales del día (mismo número que banco Debe / “Lo que cobró”). */
  const topRecaudo = recaudo.total;
  const topGastos = savedExpensesTotal;

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

          <div className="collector-mobile-day-history is-panel">
            <div className="collector-mobile-day-history-head">
              <span>Día</span>
              <span>Cobro</span>
              <span>Gasto</span>
              <span>Saldo</span>
            </div>
            <ul className="collector-mobile-day-history-list">
              {carriedOpening > 0 &&
              dayHistory.every((row) => periodFromDateIso(row.date) === viewPeriod) ? (
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
                <li className="collector-mobile-day-history-empty">
                  Sin movimientos en los últimos {COLLECTOR_HISTORY_KEEP_DAYS} días.
                </li>
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
                        setListFilter("pending");
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

      <div className={chromeLocked ? "collector-mobile-stats" : "collector-mobile-stats has-inicial"}>
        {!chromeLocked ? (
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
          <b>{queue.pending.length}</b>
        </button>
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
        <button
          type="button"
          className={
            chromeLocked
              ? "collector-mobile-stat collector-mobile-stat-close is-gastos is-off"
              : editingExpenses
                ? "collector-mobile-stat on collector-mobile-stat-close is-gastos"
                : "collector-mobile-stat collector-mobile-stat-close is-gastos"
          }
          disabled={chromeLocked ? true : !onSaveExpenses || !queue.dispatched.length}
          title={
            chromeLocked
              ? "Jornada cerrada"
              : !onSaveExpenses
                ? "Sin permiso para gastos"
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

      {showHomeCuadre ? (
        <section className="collector-mobile-home-cuadre" aria-label="Último cierre">
          <div className="collector-mobile-home-cuadre-head">
            <Pill label="Inicio" kind="paid" />
            <div className="collector-mobile-home-cuadre-title-row">
              <h2>Tu último cierre</h2>
              {queue.closed ? (
                <p className="collector-mobile-home-cuadre-progress">{queue.dateLabel}</p>
              ) : null}
            </div>
          </div>

          <div className="collector-mobile-home-cuadre-grid">
            <div className="is-inicial">
              <span>Lo que inició</span>
              <b>{money(dayCuadre.saldoInicial)}</b>
            </div>
            <div className="is-gastos">
              <span>Lo que gastó</span>
              <b>{money(dayCuadre.gastos)}</b>
            </div>

            <div className="is-cobrado">
              <div className="is-cobrado-head">
                <span>Lo que cobró</span>
              </div>
              <div className="is-cobrado-means" aria-label="Desglose de lo cobrado">
                <div className="is-mean is-pay-efectivo">
                  <span>Efectivo</span>
                  <b>{money(dayCuadre.cobradoEfectivo)}</b>
                </div>
                <div className="is-mean is-pay-nequi">
                  <span>Nequi</span>
                  <b>{money(dayCuadre.cobradoNequi)}</b>
                </div>
                <div className="is-mean is-pay-banco">
                  <span>Banco</span>
                  <b>{money(dayCuadre.cobradoBanco)}</b>
                </div>
              </div>
            </div>

            <div className="is-saldo">
              <span>Saldo en caja</span>
              <b>{money(dayCuadre.saldo)}</b>
            </div>
          </div>
          {closedPlanilla.length > 0 ? (
            <div className="collector-history-planilla" aria-label={`Planilla cobrada ${queue.dateLabel}`}>
              <p className="collector-history-planilla-title">
                <strong>Planilla {queue.dateLabel}</strong>
                <button
                  type="button"
                  className={planillaSearchOpen ? "collector-history-planilla-search on" : "collector-history-planilla-search"}
                  aria-label="Buscar cliente"
                  aria-expanded={planillaSearchOpen}
                  onClick={() => setPlanillaSearchOpen((open) => !open)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.25" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M15.2 15.2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </p>
              {planillaSearchOpen ? (
                <input
                  className="collector-history-planilla-query"
                  type="search"
                  value={planillaQuery}
                  placeholder="Buscar cliente"
                  aria-label="Buscar cliente en la planilla"
                  autoFocus
                  onChange={(event) => setPlanillaQuery(event.target.value)}
                />
              ) : null}
              <div className="collector-history-planilla-head">
                <span>#</span>
                <span>Nombre</span>
                <span>Cuota</span>
                <span>Hora</span>
                <span>Foto</span>
                <span>Método</span>
              </div>
              <ul>
                {planillaRows.length === 0 ? (
                  <li className="is-empty-search">Sin coincidencias</li>
                ) : (
                  planillaRows.map((row, index) => (
                    <li
                      key={row.key}
                      className={[
                        row.method === "vacio" ? "is-vacio" : "",
                        planillaRouteStarts[index] ? "is-route-start" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined}
                    >
                      <span className="is-ord">{row.order ?? "—"}</span>
                      <span className="is-name">{row.name}</span>
                      <span className="is-cuota">
                        {row.amount == null ? "—" : money(row.amount, { symbol: false })}
                      </span>
                      <span className="is-time">{row.time}</span>
                      <span className="is-photo">
                        {row.evidence.length > 0 ? (
                          <PaymentEvidenceThumb evidence={row.evidence} size={22} emptyLabel="—" />
                        ) : (
                          "—"
                        )}
                      </span>
                      <span className={row.method === "vacio" ? "is-method" : `is-method is-pay-${row.method}`}>
                        {historyMethodLabel(row.method)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
          <p className="collector-mobile-home-cuadre-hint is-ok">
            Este saldo es el que llevas hasta el próximo cobro. Historial para ver otros días.
          </p>
        </section>
      ) : null}

      {!showHomeCuadre ? (
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
          banco={recaudo.banco}
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
            <div className="is-pay-banco">
              <em>Banco</em>
              <b>{money(recaudo.banco)}</b>
            </div>
            <div className="is-total">
              <em>Total</em>
              <b>{money(recaudo.total)}</b>
            </div>
            {prestadoEfectivo > 0 ? (
              <div
                className="is-prestado"
                title="Capital prestado hoy en efectivo: sale del efectivo cobrado"
              >
                <em>Prestado</em>
                <b>−{money(prestadoEfectivo)}</b>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {listFilter === "done" ? (
        <ul className="collector-mobile-list compact" aria-label="Quienes pagaron">
          {dayPays.length === 0 ? (
            <li className="collector-mobile-empty-inline">Aún no hay cobros del día.</li>
          ) : (
            dayPays.map((pay) => {
              const method = normalizePaymentMethod(pay.method);
              const payLoan = loans.find((row) => row.ref === pay.loanRef);
              const payClient = payLoan
                ? clients.find((row) => row.ref === payLoan.clientRef)
                : undefined;
              // Terminó hoy (saldo en cero) → botón «Préstamo»; ya se le prestó → renglón azul.
              const reloan = reloanStateForVisit({
                clientRef: payLoan?.clientRef ?? "",
                loanRef: pay.loanRef,
                loans,
                payments: livePayments,
                date: activeDate,
              });
              const reloanOpen = reloanPayRef === pay.ref;
              // Un solo botón por crédito aunque haya pagado en dos partes (E + N).
              const isReloanAnchor =
                !pay.loanRef || reloanAnchorByLoan.get(pay.loanRef) === pay.ref;
              const canOfferReloan =
                isReloanAnchor &&
                reloan.canReloan &&
                Boolean(payClient) &&
                Boolean(onCreateQuickLoan) &&
                !dayLocked;
              return (
                <li
                  key={pay.ref}
                  className={[
                    "collector-mobile-card",
                    "is-done",
                    "is-dense",
                    paymentMethodToneClass(method),
                    reloan.granted ? "is-reloan" : "",
                    reloanOpen ? "is-open" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="collector-mobile-dense-row">
                    <div className="collector-mobile-visit-who">
                      <strong>{payerName(pay, loans, clients)}</strong>
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
                      ) : reloan.granted && isReloanAnchor ? (
                        <span
                          className="collector-reloan-tag"
                          title={`Préstamo ${reloan.granted.ref} · capital ${money(reloan.granted.capital)}`}
                        >
                          Préstamo {money(reloan.granted.capital, { symbol: false })}
                        </span>
                      ) : null}
                    </div>
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
                          onCreateQuickLoan({ ...draft, routeName: payClient.route });
                          setReloanPayRef(null);
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
                const identity = visitIdentity(item, clients, loans, livePayments, activeDate);
                const canLend =
                  identity.awaitingLoan &&
                  !collectionStopped &&
                  canCollect &&
                  Boolean(onCreateQuickLoan);
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
                        {isOpen && canAct ? (
                          <button
                            type="button"
                            className={
                              payCombo
                                ? "collector-pay-combo-toggle is-by-name on"
                                : "collector-pay-combo-toggle is-by-name"
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
                      </div>
                      {identity.awaitingLoan && !isOpen ? (
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
                          combined={payCombo}
                          onCombinedChange={setPayCombo}
                          comboInHeader
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
                          onRenew={
                            onRenewLoan && loanForRenew
                              ? () => {
                                  onRenewLoan(loanForRenew.ref);
                                  closeCard();
                                }
                              : undefined
                          }
                          onSubmit={(payload) => {
                            if (payload.combined) {
                              const ok = onRegisterPayment({
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
                              if (ok !== false) closeCard();
                              return;
                            }
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

    </div>
  );
}
