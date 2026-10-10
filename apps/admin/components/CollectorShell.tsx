"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActionToast } from "@/hooks/useActionToast";
import { useLoanRejectionToast } from "@/hooks/useLoanRejectionToast";
import {
  COLLECTORS,
  ROUTES,
  money,
  newLoanBlockReason,
  type ClientRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import {
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  DEMO_ROUTES_KEY,
  loadDemoDayCloses,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  DEMO_MONTH_CLOSE_MIRROR_QUEUE_KEY,
  flushMonthCloseMirrorQueue,
  queueMonthCloseMirror,
} from "@/lib/supabase/month-close-mirror";
import {
  assertCanCloseChainedPlanilla,
  ensureManualTLaunchClose,
  splitDayClosesAndPlanillaCash,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import { buildQuickLoan, type QuickLoanDraft } from "@/lib/street-client-loan";
import { existingDigitalDisbursementTwin } from "@/lib/restore-loans-from-bank-disbursements";
import { loanBankOutflowCapital, loanDisbursementIsoDate } from "@/lib/nequi-pool";
import {
  commitCreateRouteClient,
  flushPortfolioCatalogToCloud,
  type RouteClientDraft,
} from "@/lib/commit-portfolio-catalog";
import { COLLECTOR_DAILY_LOGS_SEED, upsertDailyLogPayment } from "@/lib/collector-daily-log";
import {
  applyDeclineLoanOfferToRoute,
  applySkipToRoute,
  closeDispatchDay,
  collectorDayVisitsFullyClosed,
  DECLINED_LOAN_OFFER_TODAY_REASON,
  declineLoanOfferToday,
  NO_PAY_TODAY_REASON,
  skipAssignmentVisit,
} from "@/lib/collector-dispatch-sync";
import {
  applyDayCloseRecordsToAssignments,
  appendCashDisbursementExpense,
  buildMonthCloseRecord,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { sealCollectorDay } from "@/lib/collector-day-close-seal";
import { releaseClosedDaysOnDevice } from "@/lib/collector-device-release";
import { BIG_DEMO_STORE_CHANGED_EVENT } from "@/lib/big-demo-store";
import { commitDayExpenseDraft, dayExpenseSavedMessage } from "@/lib/commit-day-expense";
import {
  ensureBankAccounts,
  normalizeBankAccount,
  type BankAccount,
} from "@/lib/bank";
import {
  enqueuePaymentsForFlush,
  flushPaymentMirrorQueue,
  queuePaymentsMirror,
} from "@/lib/supabase/payment-mirror";
import {
  flushCatalogMirrorQueues,
  queueClientMirror,
  queueLoanCommand,
} from "@/lib/supabase/catalog-mirror";
import { loanCommandKey, loanRefLabel } from "@/lib/loan-command";
import {
  assignmentsChangedFrom,
  flushOpsMirrorQueues,
  queueAssignmentsMirror,
  queueDayCloseMirror,
  queueDayExpenseMirror,
  queueRoutesMirror,
} from "@/lib/supabase/ops-mirror";
import { mirrorAutoDayCloseToCloud } from "@/lib/mirror-auto-day-close";
import {
  assignmentsForCreatedPayments,
  commitCollectorPayment,
  commitCollectorCombinedPayment,
  paymentsFromCollectorCommit,
} from "@/lib/commit-collector-payment";
import { type OperationalDemoSnapshot } from "@/lib/hydrate-operational-demo";
import { useOperationalDemoSync } from "@/lib/use-operational-demo-sync";
import {
  bumpMissedCollectionAlerts,
  formatCloseDayAlertSummary,
} from "@/lib/collection-alerts";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import { usePlanillaDayRollover } from "@/lib/planilla-day-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import { commitLoanRenewal } from "@/lib/commit-loan-renewal";
import { renewalSummary, type RenewalTerms } from "@/lib/loan-renew";
import {
  CollectorMobileApp,
  type CollectorCloseDayPayload,
  type CollectorCloseMonthPayload,
  type CollectorSaveExpensesPayload,
  type CollectorSkipVisitDraft,
} from "@/components/CollectorMobileApp";
import type { AppSession } from "@/lib/auth";
import { hasPermission } from "@/lib/session-access";
import {
  assignmentsForMobileCollector,
  assertOwnCollectorPayment,
  routesForMobileCollector,
} from "@/lib/mobile-sync";
import {
  isCombinedCollectorPayment,
  type CollectorPaymentRegisterInput,
} from "@/lib/route-sync";

type Props = {
  session: AppSession;
  onLogout: () => void;
};

export function CollectorShell({ session, onLogout }: Props) {
  const [collectors, setCollectors] = useState(COLLECTORS);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [routes, setRoutes] = useState(ROUTES);
  const [dailyLogs, setDailyLogs] = useState(COLLECTOR_DAILY_LOGS_SEED);
  const [dailyAssignments, setDailyAssignments] = useState<DailyCollectionAssignment[]>([]);
  const [dayCloses, setDayCloses] = useState<CollectorDayCloseRecord[]>([]);
  const [dayExpenseDrafts, setDayExpenseDrafts] = useState<CollectorDayExpenseDraft[]>([]);
  const [monthCloses, setMonthCloses] = useState<CollectorMonthCloseRecord[]>([]);
  const [planillaCashCloses, setPlanillaCashCloses] = useState<PlanillaCashCloseRecord[]>([]);
  const { showToast, toastNode } = useActionToast();
  useLoanRejectionToast(showToast);

  const collector = useMemo(() => {
    if (!session.collectorRef) return null;
    return collectors.find((row) => row.ref === session.collectorRef) ?? null;
  }, [collectors, session.collectorRef]);

  const myAssignments = useMemo(
    () =>
      session.collectorRef
        ? assignmentsForMobileCollector(session.collectorRef, dailyAssignments)
        : [],
    [dailyAssignments, session.collectorRef],
  );

  const myRoutes = useMemo(
    () => (session.collectorRef ? routesForMobileCollector(session.collectorRef, routes) : []),
    [routes, session.collectorRef],
  );

  const applyOperationalSnapshot = useCallback((snap: OperationalDemoSnapshot) => {
    setCollectors(snap.collectors);
    setClients(snap.clients);
    setRoutes(snap.routes);
    setLoans(snap.loans);
    setPayments(snap.payments);
    setDailyAssignments(snap.assignments);
    const split = splitDayClosesAndPlanillaCash(snap.dayCloses);
    setDayCloses(split.dayCloses);
    setDayExpenseDrafts(snap.dayExpenseDrafts);
    setDailyLogs(snap.dailyLogs);
    setMonthCloses(snap.monthCloses);
    const storedCash = ensureManualTLaunchClose(
      readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
    );
    const mergedCash = [...storedCash];
    for (const row of split.planillaCash) {
      const idx = mergedCash.findIndex((entry) => entry.ref === row.ref);
      if (idx >= 0) mergedCash[idx] = row;
      else mergedCash.push(row);
    }
    const withLaunch = ensureManualTLaunchClose(mergedCash);
    setPlanillaCashCloses(withLaunch);
    writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, withLaunch);
  }, []);

  const pendingToastAtRef = useRef(0);
  const { hydrated } = useOperationalDemoSync(applyOperationalSnapshot, {
    onEvidenceSync: ({ pushed, failed }) => {
      if (pushed > 0) {
        showToast(
          pushed === 1
            ? "1 comprobante de este celular ya está en la nube."
            : `${pushed} comprobantes de este celular ya están en la nube.`,
        );
      } else if (failed > 0) {
        showToast("No se pudo subir el comprobante a la nube. Revisá la conexión.");
      }
    },
    onMirrorPending: (pending) => {
      if (pending.total <= 0) return;
      const now = Date.now();
      if (now - pendingToastAtRef.current < 60_000) return;
      pendingToastAtRef.current = now;
      showToast(
        pending.total === 1
          ? "1 cambio pendiente de subir a la nube…"
          : `${pending.total} cambios pendientes de subir a la nube…`,
      );
    },
  });

  const applyPlanillaSync = useCallback(
    (next: {
      assignments: typeof dailyAssignments;
      routes: typeof routes;
      loans: typeof loans;
      logs: typeof dailyLogs;
      dayCloses: typeof dayCloses;
      dayExpenseDrafts: typeof dayExpenseDrafts;
      planillaCashCloses?: PlanillaCashCloseRecord[];
      autoClosedCount: number;
    }) => {
      setDailyAssignments(next.assignments);
      setRoutes(next.routes);
      setLoans(next.loans);
      setDailyLogs(next.logs);
      setDayCloses(next.dayCloses);
      setDayExpenseDrafts(next.dayExpenseDrafts);
      if (next.planillaCashCloses) {
        setPlanillaCashCloses(next.planillaCashCloses);
        writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, next.planillaCashCloses);
      }
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, next.assignments);
      // Cobrador: no reenviar la planilla entera (ayer + hoy). Eso pega N al cobrar.
      // Confirmar / omitir / cerrar ya encolan la visita que toca.
      writeDemoJson(DEMO_ROUTES_KEY, next.routes);
      writeDemoJson(DEMO_LOANS_KEY, next.loans);
      writeDemoJson(DEMO_DAILY_LOGS_KEY, next.logs);
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, next.dayCloses);
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, next.dayExpenseDrafts);
      if (next.autoClosedCount > 0) {
        // Cobrador: no arma Banco. El registro lo proyecta supervisor / sistema.
        void mirrorAutoDayCloseToCloud({
          dayCloses: next.dayCloses,
          planillaCashCloses: next.planillaCashCloses,
          assignments: next.assignments,
        }).catch((error) => {
          console.error("auto-day-close-mirror", error);
        });
      }
    },
    [],
  );

  usePlanillaDayRollover(
    hydrated,
    {
      routes,
      clients,
      loans,
      collectors,
      assignments: dailyAssignments,
      payments,
      dayCloses,
      dayExpenseDrafts,
      logs: dailyLogs,
      planillaCashCloses,
      monthCloses,
    },
    applyPlanillaSync,
  );

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, dailyAssignments);
  }, [dailyAssignments, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // No pisar CIE/cierres ya en disco con [] del arranque (mismo fallo que pagos).
    if (dayCloses.length === 0) {
      const stored = loadDemoDayCloses<CollectorDayCloseRecord>();
      if (stored.length > 0) {
        const split = splitDayClosesAndPlanillaCash(stored);
        setDayCloses(split.dayCloses);
        return;
      }
    }
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, dayCloses);
  }, [dayCloses, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, planillaCashCloses);
  }, [planillaCashCloses, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, dayExpenseDrafts);
  }, [dayExpenseDrafts, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, monthCloses);
  }, [monthCloses, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_ROUTES_KEY, routes);
  }, [routes, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // El arranque nace en []. No pisar cobros ya guardados con esa lista vacía.
    if (payments.length === 0) {
      const stored = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
      if (stored.length > 0) setPayments(stored);
      return;
    }
    writeDemoJson(DEMO_PAYMENTS_KEY, payments);
  }, [payments, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_LOANS_KEY, loans);
  }, [loans, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (clients.length === 0) return;
    writeDemoJson(DEMO_CLIENTS_KEY, clients);
  }, [clients, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_DAILY_LOGS_KEY, dailyLogs);
  }, [dailyLogs, hydrated]);

  async function registerCollectorPayment(input: CollectorPaymentRegisterInput) {
    const ownershipRef = isCombinedCollectorPayment(input)
      ? input.parts[0].collectorRef
      : input.collectorRef;
    const ownershipError = assertOwnCollectorPayment(session.collectorRef, ownershipRef);
    if (ownershipError) {
      showToast(ownershipError);
      return false;
    }

    const committed = isCombinedCollectorPayment(input)
      ? commitCollectorCombinedPayment({
          parts: input.parts,
          comboGroupId: input.comboGroupId,
          paidTime: input.paidTime,
          payments,
          loans,
          clients,
          routes,
          assignments: dailyAssignments,
          collectors,
        })
      : commitCollectorPayment({
          draft: input,
          payments,
          loans,
          clients,
          routes,
          assignments: dailyAssignments,
          collectors,
        });
    if (!committed.ok) {
      showToast(committed.error);
      return false;
    }

    const primaryDraft = isCombinedCollectorPayment(input) ? input.parts[0] : input;
    const paymentsCreated = paymentsFromCollectorCommit(committed);

    const paidRoute = committed.routes.find(
      (row) =>
        row.ref.startsWith(`RUT-D-${primaryDraft.collectorRef}-`) &&
        committed.payment.routeRef === row.ref,
    );
    let logsAfterPay = dailyLogs;
    if (paidRoute) {
      for (const pay of paymentsCreated) {
        logsAfterPay = upsertDailyLogPayment(logsAfterPay, pay, paidRoute);
      }
    }

    setPayments(committed.payments);
    setClients(committed.clients);
    setRoutes(committed.routes);
    setLoans(committed.loans);
    setDailyAssignments(committed.assignments);
    setDailyLogs(logsAfterPay);
    try {
      writeDemoJson(DEMO_PAYMENTS_KEY, committed.payments);
      writeDemoJson(DEMO_LOANS_KEY, committed.loans);
    } catch (error) {
      console.error("collector-pay-persist", error);
    }

    const toastRefs = paymentsCreated.map((row) => row.ref).join(" + ");
    showToast(`Cobro ${toastRefs} guardado · subiendo a la nube…`);
    enqueuePaymentsForFlush(paymentsCreated);
    const paidLoan = committed.loans.find((row) => row.ref === committed.payment.loanRef);
    if (paidLoan) void queueLoanCommand(paidLoan, { op: "alerts" });
    const paidClient = committed.clients.find((row) =>
      committed.loans.some(
        (loan) => loan.ref === committed.payment.loanRef && loan.clientRef === row.ref,
      ),
    );
    if (paidClient) queueClientMirror(paidClient);
    queueAssignmentsMirror(assignmentsForCreatedPayments(committed.assignments, paymentsCreated));
    void (async () => {
      try {
        try {
          writeDemoJson(DEMO_CLIENTS_KEY, committed.clients);
          writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, committed.assignments);
          writeDemoJson(DEMO_ROUTES_KEY, committed.routes);
          writeDemoJson(DEMO_DAILY_LOGS_KEY, logsAfterPay);
        } catch (error) {
          console.error("collector-pay-persist-rest", error);
        }
        // Primero el PG-: confirmar en N no espera Banco ni rehacer la planilla.
        await queuePaymentsMirror(paymentsCreated);
        let payFlush = await flushPaymentMirrorQueue();
        if (payFlush.left > 0) payFlush = await flushPaymentMirrorQueue();
        void Promise.all([flushCatalogMirrorQueues(), flushOpsMirrorQueues()]).catch(() => {
          /* reintenta el poll / siguiente cobro */
        });
        if (payFlush.left > 0) {
          showToast(`Cobro ${toastRefs} guardado (sin nube; reintenta solo).`);
        } else {
          showToast(`Cobro ${toastRefs} listo en la nube`);
        }
      } catch {
        showToast(`Cobro ${toastRefs} guardado (sin nube; en este aparato ya está).`);
      }
    })();
    return true;
  }

  async function renewCollectorLoan(loanRef: string, terms: RenewalTerms) {
    if (!collector) return;
    const renewal = commitLoanRenewal(
      { loans, clients, routes, collectors, assignments: dailyAssignments, payments },
      loanRef,
      todayIso(),
      terms,
    );
    if (!renewal.ok) {
      showToast(renewal.error);
      return;
    }
    setLoans(renewal.loans);
    setClients(renewal.clients);
    writeDemoJson(DEMO_LOANS_KEY, renewal.loans);
    writeDemoJson(DEMO_CLIENTS_KEY, renewal.clients);
    setDailyAssignments(renewal.assignments);
    setRoutes(renewal.routes);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, renewal.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, renewal.routes);
    const sent = queueLoanCommand(renewal.created, renewal.command);
    if (renewal.client) queueClientMirror(renewal.client);
    queueAssignmentsMirror(assignmentsChangedFrom(dailyAssignments, renewal.assignments));
    queueRoutesMirror(renewal.routes);
    const summary = renewalSummary(renewal.created, terms);
    showToast(`${summary} · subiendo…`);
    try {
      const cloud = await sent;
      if (cloud.ok && cloud.rejected) {
        showToast(cloud.message);
        return;
      }
      await flushCatalogMirrorQueues();
      await flushOpsMirrorQueues();
      await flushOpsMirrorQueues();
      showToast(cloud.ok ? `${summary} · ${cloud.ref}` : "Renovado en este aparato; se sube solo a la nube.");
    } catch (error) {
      console.error("collector-renew-mirror", error);
      showToast("Renovado en este aparato; se sube solo a la nube.");
    }
  }

  async function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    if (!collector) return;
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      showToast("Cliente no encontrado.");
      return;
    }
    const blocked = newLoanBlockReason(client.ref, loans);
    if (blocked) {
      showToast(blocked);
      return;
    }
    const loan = buildQuickLoan({ ...draft, fundedBy: "efectivo" }, client, loans);
    if (!loan) {
      showToast("Revise capital, interés, tiempo y frecuencia.");
      return;
    }
    const twin = existingDigitalDisbursementTwin(
      loans,
      client.ref,
      loanDisbursementIsoDate(loan),
      loanBankOutflowCapital(loan),
    );
    if (twin) {
      showToast(`Este préstamo ya está registrado (${twin.ref}). No se duplica.`);
      return;
    }
    const nextLoans = [loan, ...loans];
    const nextClients = clients.map((entry) =>
      entry.ref === client.ref
        ? {
            ...entry,
            awaitingLoan: false,
            total: entry.total + (loan.total ?? 0),
            pending: entry.pending + (loan.total ?? 0),
          }
        : entry,
    );
    setLoans(nextLoans);
    setClients(nextClients);
    writeDemoJson(DEMO_LOANS_KEY, nextLoans);
    writeDemoJson(DEMO_CLIENTS_KEY, nextClients);
    const planilla = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      nextLoans,
      collectors,
      dailyAssignments,
      payments,
    );
    setDailyAssignments(planilla.assignments);
    setRoutes(planilla.routes);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, planilla.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, planilla.routes);
    const sentLoan = queueLoanCommand(loan, { op: "create", key: loanCommandKey() });
    const mirroredClient = nextClients.find((entry) => entry.ref === client.ref);
    if (mirroredClient) queueClientMirror(mirroredClient);
    queueAssignmentsMirror(assignmentsChangedFrom(dailyAssignments, planilla.assignments));
    queueRoutesMirror(planilla.routes);
    const routeRef =
      myRoutes.find((row) => row.name === client.route)?.ref ||
      myRoutes[0]?.ref ||
      "";
    const nextDrafts = appendCashDisbursementExpense(dayExpenseDrafts, {
      collectorRef: collector.ref,
      collectorName: collector.name,
      date: todayIso(),
      routeRef,
      loan,
    });
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);
    setDayExpenseDrafts(nextDrafts);
    const expenseDraft = nextDrafts.find(
      (row) => row.ref === `GAS-${collector.ref}-${todayIso()}`,
    );
    if (expenseDraft) queueDayExpenseMirror(expenseDraft);
    showToast(
      `Préstamo ${loanRefLabel(loan.ref)} · capital ${money(loan.capital)} descontado de caja · subiendo…`,
    );
    try {
      const cloud = await sentLoan;
      if (cloud.ok && cloud.rejected) {
        showToast(cloud.message);
        return;
      }
      await flushCatalogMirrorQueues();
      await flushOpsMirrorQueues();
      await flushOpsMirrorQueues();
      showToast(
        cloud.ok
          ? `Préstamo ${cloud.ref} listo · cuota ${money(loan.installment ?? 0)}.`
          : `Préstamo guardado, ${loanRefLabel(loan.ref)} (sin nube; se sube solo).`,
      );
    } catch (error) {
      console.error("collector-quick-loan-mirror", error);
      showToast(`Préstamo guardado, ${loanRefLabel(loan.ref)} (sin nube; se sube solo).`);
    }
  }

  async function createRouteClientFromMobile(draft: RouteClientDraft) {
    const result = commitCreateRouteClient(
      draft,
      { clients, loans, routes, assignments: dailyAssignments, collectors, payments },
      collector?.name,
    );
    if (!result.ok) {
      showToast(result.error);
      return false;
    }
    setClients(result.state.clients);
    setRoutes(result.state.routes);
    setDailyAssignments(result.state.assignments);
    showToast(`${result.message} · subiendo…`);
    try {
      await flushPortfolioCatalogToCloud();
      showToast(result.message);
    } catch (err) {
      console.error("[nuevo cliente] flush nube", err);
      showToast(`${result.message} (sin nube; en este aparato ya está, queda en cola).`);
    }
    return true;
  }

  function skipCollectorVisit(draft: CollectorSkipVisitDraft) {
    if (!session.collectorRef) {
      showToast("Sin cobrador vinculado.");
      return;
    }

    const declinedOffer = draft.reason === DECLINED_LOAN_OFFER_TODAY_REASON;
    const nextAssignments = declinedOffer
      ? declineLoanOfferToday(dailyAssignments, {
          collectorRef: session.collectorRef,
          dispatchDate: draft.dispatchDate,
          clientRef: draft.clientRef,
        })
      : skipAssignmentVisit(dailyAssignments, {
          collectorRef: session.collectorRef,
          dispatchDate: draft.dispatchDate,
          loanRef: draft.loanRef,
          clientRef: draft.clientRef,
          reason: draft.reason,
        });
    const nextRoutes = routes.map((row) =>
      row.ref === draft.routeRef
        ? declinedOffer
          ? applyDeclineLoanOfferToRoute(row, draft.clientRef)
          : applySkipToRoute(row, draft.loanRef, draft.clientRef)
        : row,
    );
    setDailyAssignments(nextAssignments);
    setRoutes(nextRoutes);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, nextAssignments);
    writeDemoJson(DEMO_ROUTES_KEY, nextRoutes);
    queueAssignmentsMirror(assignmentsChangedFrom(dailyAssignments, nextAssignments));
    queueRoutesMirror(nextRoutes);
    showToast(
      declinedOffer
        ? "Sale de por cobrar. Prestar sigue disponible si cambia de opinión."
        : draft.reason === NO_PAY_TODAY_REASON
          ? "Sale de por cobrar. Quedó en S/N."
          : draft.reason
            ? `Visita omitida · ${draft.reason}.`
            : "Visita omitida.",
    );
  }

  async function saveCollectorExpenses(payload: CollectorSaveExpensesPayload) {
    const commit = commitDayExpenseDraft(dayExpenseDrafts, payload);
    const nextDrafts = commit.drafts;
    setDayExpenseDrafts(nextDrafts);

    const inCloud = await commit.inCloud;
    showToast(dayExpenseSavedMessage(commit.draft, commit.savedLocal, inCloud));
  }

  async function closeCollectorMonth(payload: CollectorCloseMonthPayload) {
    const record = buildMonthCloseRecord(payload);
    const next = [record, ...monthCloses.filter((row) => row.ref !== record.ref)];
    writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, next);
    setMonthCloses(next);
    queueMonthCloseMirror(record);
    await flushMonthCloseMirrorQueue();
    const pending = readDemoJson<{ ref: string }[]>(DEMO_MONTH_CLOSE_MIRROR_QUEUE_KEY, []).some(
      (row) => row.ref === record.ref,
    );
    showToast(
      pending
        ? `Mes ${payload.period} guardado en este aparato · sin nube aún (reintenta solo).`
        : `Mes ${payload.period} guardado · saldo arrastrado ${money(record.closingSaldo)}. Empieza el mes nuevo.`,
    );
  }

  async function closeCollectorDay(payload: CollectorCloseDayPayload) {
    const storedCloses = loadDemoDayCloses<CollectorDayCloseRecord>();
    const chainGuard = assertCanCloseChainedPlanilla({
      collectorRef: payload.collectorRef,
      routeName: payload.planillaRoute,
      date: payload.date,
      records: planillaCashCloses,
      dayCloses: storedCloses,
      assignments: dailyAssignments,
      clients,
    });
    if (!chainGuard.ok) {
      showToast(chainGuard.error);
      return false;
    }

    const accounts = ensureBankAccounts(
      readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);

    const result = closeDispatchDay(
      dailyAssignments,
      routes,
      dailyLogs,
      payload.date,
      collectors,
      loans,
      clients,
      payload.collectorRef,
      payments,
      payload.planillaRoute,
    );

    const fullyClosed = collectorDayVisitsFullyClosed(
      result.assignments,
      payload.collectorRef,
      payload.date,
    );

    const sealed = sealCollectorDay({
      collectorRef: payload.collectorRef,
      collectorName: payload.collectorName,
      date: payload.date,
      routeRef: payload.routeRef,
      planillaRoute: payload.planillaRoute,
      openingCashHint: payload.openingCash,
      expensesFallback: payload.expenses,
      fullyClosed,
      assignments: result.assignments,
      dayCloses: storedCloses,
      dayExpenseDrafts,
      planillaCashCloses,
      monthCloses,
      payments,
      loans,
      clients,
      collectors,
    });
    const record = sealed.record;
    const nextCloses = sealed.dayCloses;

    if (sealed.sealedLinks.length) {
      setPlanillaCashCloses(sealed.planillaCashCloses);
      writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, sealed.planillaCashCloses);
    }

    if (record) {
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, nextCloses);
      setDayCloses(nextCloses);
      queueDayCloseMirror(record);

      const nextDrafts = sealed.dayExpenseDrafts;
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);
      setDayExpenseDrafts(nextDrafts);
    }

    const closedAssignments = applyDayCloseRecordsToAssignments(
      result.assignments,
      nextCloses,
    );
    setDailyAssignments(closedAssignments);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, closedAssignments);
    setRoutes(result.routes);
    writeDemoJson(DEMO_ROUTES_KEY, result.routes);
    queueAssignmentsMirror(closedAssignments);
    queueRoutesMirror(result.routes);
    try {
      // Encolar primero, luego flush (con un reintento): el cierre debe salir a la nube.
      await flushOpsMirrorQueues();
      await flushOpsMirrorQueues();
    } catch {
      /* cola offline reintenta */
    }
    setDailyLogs(result.logs);

    const alertResult = bumpMissedCollectionAlerts(
      loans,
      result.missedLoanRefs,
      payload.date,
      payments,
    );
    setLoans(alertResult.loans);
    writeDemoJson(DEMO_LOANS_KEY, alertResult.loans);

    if (!fullyClosed) {
      const label = payload.planillaRoute
        ? `Planilla ${payload.planillaRoute} cerrada`
        : "Planilla cerrada";
      showToast(
        `${label} · sigue otra hoja abierta. ${formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora) || ""}`.trim(),
      );
      return false;
    }

    // Jornada cerrada y subida: el celular suelta lo anterior a este cierre.
    if (record && releaseClosedDaysOnDevice().released > 0) {
      window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));
    }

    const parts = [
      record ? `saldo final ${money(record.cashFloat)}` : null,
      record && record.expensesTotal > 0
        ? `gastos ${money(record.expensesTotal)} (Haber)`
        : null,
      formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora),
      !accounts.length && record && record.expensesTotal > 0
        ? "sin cuenta banco: gastos quedan en cierre"
        : null,
    ].filter(Boolean);
    showToast(`Día cerrado · ${parts.join(" · ")}.`);
    return true;
  }

  if (!hydrated) {
    return <div className="login-screen login-loading collector-shell-loading" aria-hidden />;
  }

  if (!collector) {
    return (
      <div className="collector-shell">
        <main className="collector-shell-main">
          <section className="panel access-denied">
            <div className="head">
              <h1>Sin cobrador vinculado</h1>
            </div>
            <p className="access-denied-detail">
              Este usuario no tiene un cobrador asociado. Pide al administrador que revise tu ficha.
            </p>
            <button type="button" className="btn aside-logout" onClick={onLogout}>
              Salir
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="collector-shell collector-shell-mobile">
      <CollectorMobileApp
        key={collector.ref}
        collector={collector}
        assignments={myAssignments}
        routes={myRoutes}
        loans={loans}
        clients={clients}
        payments={payments}
        dayCloses={dayCloses}
        dayExpenseDrafts={dayExpenseDrafts}
        monthCloses={monthCloses}
        planillaCashCloses={planillaCashCloses}
        canRegister={hasPermission(session, "cobros.registrar")}
        onRegisterPayment={
          hasPermission(session, "cobros.registrar") ? registerCollectorPayment : undefined
        }
        onRenewLoan={
          hasPermission(session, "cobros.registrar") ? renewCollectorLoan : undefined
        }
        onCreateQuickLoan={
          hasPermission(session, "cobros.registrar") ? createQuickLoanFromMobile : undefined
        }
        onCreateClient={
          hasPermission(session, "cobros.registrar") ? createRouteClientFromMobile : undefined
        }
        onSkipVisit={
          hasPermission(session, "cobros.registrar") ? skipCollectorVisit : undefined
        }
        onSaveExpenses={
          hasPermission(session, "cobros.registrar") ? saveCollectorExpenses : undefined
        }
        onCloseDay={
          hasPermission(session, "cobros.registrar") ? closeCollectorDay : undefined
        }
        onCloseMonth={
          hasPermission(session, "cobros.registrar") ? closeCollectorMonth : undefined
        }
        onLogout={onLogout}
      />
      {toastNode}
    </div>
  );
}
