"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActionToast } from "@/hooks/useActionToast";
import {
  COLLECTORS,
  ROUTES,
  money,
  nextLoanCode,
  type ClientRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import {
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  DEMO_ROUTES_KEY,
  loadDemoDayCloses,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  assertCanCloseChainedPlanilla,
  buildPlanillaCashClose,
  ensureManualTLaunchClose,
  isPlanillaCashChainRoute,
  planillaCashCloseAsDayClose,
  splitDayClosesAndPlanillaCash,
  upsertPlanillaCashClose,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import { buildQuickLoan, type QuickLoanDraft } from "@/lib/street-client-loan";
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
  buildDayExpenseDraft,
  buildMonthCloseRecord,
  dayExpenseLineMovementRef,
  expensesForCollectorDay,
  finalizeCollectorDayClose,
  removeDayExpenseDraft,
  upsertAndTrimCollectorDayClose,
  upsertDayExpenseDraft,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { collectorRecaudoBreakdown } from "@/lib/collector-mobile";
import type { MiscPayment } from "@/lib/misc-payments";
import {
  ensureBankAccounts,
  normalizeBankAccount,
  normalizeBankMovements,
  type BankAccount,
  type BankMovement,
} from "@/lib/bank";
import { syncBankLedger } from "@/lib/bank-ledger-sync";
import { projectOperationalMoney } from "@/lib/project-operational-money";
import { flushPaymentMirrorQueue, queuePaymentsMirror } from "@/lib/supabase/payment-mirror";
import {
  flushCatalogMirrorQueues,
  queueClientMirror,
  queueLoanMirror,
  queueLoansMirror,
} from "@/lib/supabase/catalog-mirror";
import {
  flushOpsMirrorQueues,
  queueAssignmentsMirror,
  queueDayCloseMirror,
  queueDayExpenseMirror,
  queueRoutesMirror,
} from "@/lib/supabase/ops-mirror";
import { mirrorAutoDayCloseToCloud } from "@/lib/mirror-auto-day-close";
import {
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
import { buildRenewalLoans } from "@/lib/loan-renew";
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
      queueAssignmentsMirror(next.assignments);
      writeDemoJson(DEMO_ROUTES_KEY, next.routes);
      writeDemoJson(DEMO_LOANS_KEY, next.loans);
      writeDemoJson(DEMO_DAILY_LOGS_KEY, next.logs);
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, next.dayCloses);
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, next.dayExpenseDrafts);
      if (next.autoClosedCount > 0) {
        writeDemoJson(
          DEMO_BANK_MOVEMENTS_KEY,
          syncBankLedger({
            payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
            movements: normalizeBankMovements(
              readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
            ),
            accounts: ensureBankAccounts(
              readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
            ),
            miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
            dayExpenseDrafts: next.dayExpenseDrafts,
            dayCloses: next.dayCloses,
            loans: next.loans,
          }),
        );
        // Misma cadena que cierre manual: CIE + PCE + planilla sellada → nube.
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

    const accounts = ensureBankAccounts(
      readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);

    const projected = projectOperationalMoney({
      loans: committed.loans,
      payments: committed.payments,
      collectors,
      clients: committed.clients,
      dayCloses: loadDemoDayCloses<CollectorDayCloseRecord>(),
      dayExpenseDrafts: readDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
      bankAccounts: accounts,
      bankMovements: normalizeBankMovements(
        readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
      ),
      miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
      assignments: committed.assignments,
      dailyLogs: logsAfterPay,
    });

    setPayments(committed.payments);
    setClients(committed.clients);
    setRoutes(committed.routes);
    setLoans(projected.loans);
    setDayCloses(projected.dayCloses);
    setDailyAssignments(projected.assignments);
    setDailyLogs(projected.dailyLogs);
    writeDemoJson(DEMO_PAYMENTS_KEY, committed.payments);
    writeDemoJson(DEMO_LOANS_KEY, projected.loans);
    writeDemoJson(DEMO_CLIENTS_KEY, committed.clients);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, projected.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, committed.routes);
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, projected.dayCloses);
    writeDemoJson(DEMO_DAILY_LOGS_KEY, projected.dailyLogs);
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, projected.bankMovements);

    const toastRefs = paymentsCreated.map((row) => row.ref).join(" + ");
    showToast(`Cobro ${toastRefs} guardado · subiendo a la nube…`);
    // Crítico para el supervisor: solo el PG-. Catálogo/ops van en fondo (más velocidad).
    await queuePaymentsMirror(paymentsCreated);
    const paidLoan = committed.loans.find((row) => row.ref === committed.payment.loanRef);
    if (paidLoan) queueLoanMirror(paidLoan);
    const paidClient = committed.clients.find((row) =>
      committed.loans.some(
        (loan) => loan.ref === committed.payment.loanRef && loan.clientRef === row.ref,
      ),
    );
    if (paidClient) queueClientMirror(paidClient);
    queueAssignmentsMirror(projected.assignments);
    try {
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
    return true;
  }

  async function renewCollectorLoan(loanRef: string) {
    if (!collector) return;
    const loan = loans.find((row) => row.ref === loanRef);
    if (!loan) {
      showToast("Préstamo no encontrado.");
      return;
    }
    const newRef = nextLoanCode(loans);
    // Cobrador: renovación siempre sale de efectivo y resta de su caja.
    const result = buildRenewalLoans(loan, newRef, todayIso(), "efectivo");
    if (!result) {
      showToast("La renovación se activa cuando se cumpla el plazo del préstamo.");
      return;
    }
    const nextLoans = [result.created, ...loans.map((row) => (row.ref === loanRef ? result.closed : row))];
    const nextClients = clients.map((entry) => {
      if (entry.ref !== loan.clientRef) return entry;
      return {
        ...entry,
        total: entry.total + (result.created.total ?? 0),
        pending: Math.max(0, entry.pending - loan.balance + (result.created.total ?? 0)),
      };
    });
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
    queueLoansMirror([result.created, result.closed]);
    const renewedClient = nextClients.find((entry) => entry.ref === loan.clientRef);
    if (renewedClient) queueClientMirror(renewedClient);
    queueAssignmentsMirror(planilla.assignments);
    queueRoutesMirror(planilla.routes);
    const clientRow = nextClients.find((c) => c.ref === loan.clientRef);
    const routeRef =
      myRoutes.find((row) => row.name === clientRow?.route)?.ref ||
      myRoutes[0]?.ref ||
      "";
    const nextDrafts = appendCashDisbursementExpense(dayExpenseDrafts, {
      collectorRef: collector.ref,
      collectorName: collector.name,
      date: todayIso(),
      routeRef,
      loan: result.created,
    });
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);
    setDayExpenseDrafts(nextDrafts);
    const expenseDraft = nextDrafts.find(
      (row) => row.ref === `GAS-${collector.ref}-${todayIso()}`,
    );
    if (expenseDraft) queueDayExpenseMirror(expenseDraft);
    writeDemoJson(
      DEMO_BANK_MOVEMENTS_KEY,
      syncBankLedger({
        payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, payments),
        movements: normalizeBankMovements(
          readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
        ),
        accounts: ensureBankAccounts(
          readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
        ),
        miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
        dayExpenseDrafts: nextDrafts,
        dayCloses,
        loans: nextLoans,
      }),
    );
    showToast(
      `Renovación ${newRef}: capital ${money(result.created.capital)} sale de efectivo · subiendo…`,
    );
    try {
      await flushCatalogMirrorQueues();
      await flushOpsMirrorQueues();
      await flushOpsMirrorQueues();
      showToast(
        `Renovación ${newRef} lista · capital ${money(result.created.capital)}.`,
      );
    } catch {
      showToast(
        `Renovación ${newRef} guardada (sin nube; en este aparato ya está).`,
      );
    }
  }

  async function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    if (!collector) return;
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      showToast("Cliente no encontrado.");
      return;
    }
    const loan = buildQuickLoan({ ...draft, fundedBy: "efectivo" }, client, loans);
    if (!loan) {
      showToast("Revise capital, interés, tiempo y frecuencia.");
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
    queueLoanMirror(loan);
    const mirroredClient = nextClients.find((entry) => entry.ref === client.ref);
    if (mirroredClient) queueClientMirror(mirroredClient);
    queueAssignmentsMirror(planilla.assignments);
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
    writeDemoJson(
      DEMO_BANK_MOVEMENTS_KEY,
      syncBankLedger({
        payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, payments),
        movements: normalizeBankMovements(
          readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
        ),
        accounts: ensureBankAccounts(
          readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
        ),
        miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
        dayExpenseDrafts: nextDrafts,
        dayCloses,
        loans: nextLoans,
      }),
    );
    showToast(
      `Préstamo ${loan.ref} · capital ${money(loan.capital)} descontado de caja · subiendo…`,
    );
    try {
      await flushCatalogMirrorQueues();
      await flushOpsMirrorQueues();
      await flushOpsMirrorQueues();
      showToast(
        `Préstamo ${loan.ref} listo · cuota ${money(loan.installment ?? 0)}.`,
      );
    } catch {
      showToast(
        `Préstamo ${loan.ref} guardado (sin nube; en este aparato ya está).`,
      );
    }
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
    queueAssignmentsMirror(nextAssignments);
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

  function saveCollectorExpenses(payload: CollectorSaveExpensesPayload) {
    const draft = buildDayExpenseDraft({
      collectorRef: payload.collectorRef,
      collectorName: payload.collectorName,
      date: payload.date,
      routeRef: payload.routeRef,
      expenses: payload.expenses,
    });
    const nextDrafts = upsertDayExpenseDraft(dayExpenseDrafts, draft);
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);
    setDayExpenseDrafts(nextDrafts);
    queueDayExpenseMirror(draft);

    const accounts = ensureBankAccounts(
      readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);
    writeDemoJson(
      DEMO_BANK_MOVEMENTS_KEY,
      syncBankLedger({
        payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, payments),
        movements: normalizeBankMovements(
          readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
        ),
        accounts,
        miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
        dayExpenseDrafts: nextDrafts,
        dayCloses: loadDemoDayCloses<CollectorDayCloseRecord>(),
        loans,
      }),
    );

    showToast(
      draft.expensesTotal > 0
        ? `Gastos guardados · ${money(draft.expensesTotal)} · en Registros`
        : "Gastos limpiados.",
    );
  }

  function closeCollectorMonth(payload: CollectorCloseMonthPayload) {
    const record = buildMonthCloseRecord(payload);
    const next = [record, ...monthCloses.filter((row) => row.ref !== record.ref)];
    writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, next);
    setMonthCloses(next);
    showToast(
      `Mes ${payload.period} guardado · saldo arrastrado ${money(record.closingSaldo)}. Empieza el mes nuevo.`,
    );
  }

  async function closeCollectorDay(payload: CollectorCloseDayPayload) {
    const chainGuard = assertCanCloseChainedPlanilla({
      collectorRef: payload.collectorRef,
      routeName: payload.planillaRoute,
      date: payload.date,
      records: planillaCashCloses,
    });
    if (!chainGuard.ok) {
      showToast(chainGuard.error);
      return;
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

    const closes = loadDemoDayCloses<CollectorDayCloseRecord>().filter(
      (row) => !String(row.ref || "").startsWith("PCE-"),
    );
    let nextCloses = closes;
    let nextDrafts = dayExpenseDrafts;
    let record: CollectorDayCloseRecord | null = null;

    // Cadena M↔T: fijar saldo de la hoja (A no entra).
    if (isPlanillaCashChainRoute(payload.planillaRoute)) {
      const cashLink = buildPlanillaCashClose({
        collectorRef: payload.collectorRef,
        collectorName: payload.collectorName,
        date: payload.date,
        routeName: String(payload.planillaRoute),
        openingCash: Number(payload.openingCash) || 0,
        cashCollected: Number(payload.collectedEfectivo) || 0,
        cashOut: Number(payload.cashOut) || 0,
      });
      const nextCash = upsertPlanillaCashClose(planillaCashCloses, cashLink);
      setPlanillaCashCloses(nextCash);
      writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, nextCash);
      const mirrored = planillaCashCloseAsDayClose(cashLink);
      queueDayCloseMirror(mirrored);
    }

    if (fullyClosed) {
      const dayExpenses = expensesForCollectorDay(
        payload.collectorRef,
        payload.date,
        closes,
        dayExpenseDrafts,
      );
      const lines = (dayExpenses.length ? dayExpenses : payload.expenses).filter(
        (row) => row.amount > 0,
      );
      const breakdown = collectorRecaudoBreakdown(
        payload.collectorRef,
        payload.date,
        payments,
        collectors,
      );
      record = finalizeCollectorDayClose({
        draft: {
          collectorRef: payload.collectorRef,
          collectorName: payload.collectorName,
          date: payload.date,
          routeRef: payload.routeRef,
          collected: breakdown.total,
          expenses: lines,
        },
        lines,
        cashCollected: breakdown.efectivo,
        movementRefs: lines.map((line) =>
          dayExpenseLineMovementRef(
            payload.collectorRef,
            payload.date,
            line.id,
            line.loanRef,
          ),
        ),
      });
      nextCloses = upsertAndTrimCollectorDayClose(closes, record);
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, nextCloses);
      setDayCloses(nextCloses);
      queueDayCloseMirror(record);

      nextDrafts = removeDayExpenseDraft(
        dayExpenseDrafts,
        payload.collectorRef,
        payload.date,
      );
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);
      setDayExpenseDrafts(nextDrafts);

      writeDemoJson(
        DEMO_BANK_MOVEMENTS_KEY,
        syncBankLedger({
          payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, payments),
          movements: normalizeBankMovements(
            readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
          ),
          accounts,
          miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
          dayExpenseDrafts: nextDrafts,
          dayCloses: nextCloses,
          loans,
        }),
      );
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
      return;
    }

    const parts = [
      record ? `caja menor ${money(record.cashFloat)}` : null,
      record && record.expensesTotal > 0
        ? `gastos ${money(record.expensesTotal)} (Haber)`
        : null,
      formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora),
      !accounts.length && record && record.expensesTotal > 0
        ? "sin cuenta banco: gastos quedan en cierre"
        : null,
    ].filter(Boolean);
    showToast(`Día cerrado · ${parts.join(" · ")}.`);
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
