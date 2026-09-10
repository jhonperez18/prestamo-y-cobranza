"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActionToast } from "@/hooks/useActionToast";
import {
  CLIENTS,
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
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  loadDemoPaymentsBundle,
  loadDemoUsers,
  loadDemoClients,
  loadDemoDayCloses,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import { buildQuickLoan, type QuickLoanDraft } from "@/lib/street-client-loan";
import { syncAllLoans } from "@/lib/loan-preview";
import { synchronizeOperationalState } from "@/lib/operational-sync";
import { COLLECTOR_DAILY_LOGS_SEED, upsertDailyLogPayment } from "@/lib/collector-daily-log";
import {
  applySkipToRoute,
  closeDispatchDay,
  rebuildDispatchRoutes,
  skipAssignmentVisit,
} from "@/lib/collector-dispatch-sync";
import {
  applyDayCloseRecordsToAssignments,
  buildDayExpenseDraft,
  buildMonthCloseRecord,
  dayExpenseLineMovementRef,
  finalizeCollectorDayClose,
  recoverPaymentsFromAssignments,
  recoverPaymentsFromBankMovements,
  removeDayExpenseDraft,
  synthesizeDayClosesFromAssignments,
  upsertDayExpenseDraft,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import type { MiscPayment } from "@/lib/misc-payments";
import {
  ensureBankAccounts,
  normalizeBankAccount,
  normalizeBankMovements,
  type BankAccount,
  type BankMovement,
} from "@/lib/bank";
import { syncBankLedger } from "@/lib/bank-ledger-sync";
import {
  stripRemovedPaymentMovements,
} from "@/lib/purge-unclosed-payments";
import { dedupeDailyPaymentsByVisit } from "@/lib/planilla-payment-reconcile";
import { commitCollectorPayment } from "@/lib/commit-collector-payment";
import { runOperationalDayCycle } from "@/lib/collector-day-auto-close";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
import {
  bumpMissedCollectionAlerts,
  formatCloseDayAlertSummary,
} from "@/lib/collection-alerts";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import { dedupeClientsByRef, normalizeAllRouteOrders } from "@/lib/client-route-order";
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
import { normalizeClientLifecycle } from "@/lib/client-review";
import type { CollectorPaymentDraft } from "@/lib/route-sync";

type Props = {
  session: AppSession;
  onLogout: () => void;
};

export function CollectorShell({ session, onLogout }: Props) {
  const [hydrated, setHydrated] = useState(false);
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

  useEffect(() => {
    syncDemoStorageToServedBuild();
    const { payments: storedPayments, loans: storedLoans } = loadDemoPaymentsBundle();
    const storedCollectors = readDemoJson(DEMO_COLLECTORS_KEY, COLLECTORS);
    const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
    const storedRoutes = readDemoJson(DEMO_ROUTES_KEY, ROUTES);
    const storedClients = normalizeAllRouteOrders(
      dedupeClientsByRef(
        loadDemoClients(CLIENTS).map(normalizeClientLifecycle),
      ),
    );
    loadDemoUsers();
    setClients(storedClients);
    writeDemoJson(DEMO_CLIENTS_KEY, storedClients);
    setCollectors(storedCollectors);

    const bankMovements = readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []);
    let nextPayments = recoverPaymentsFromAssignments(storedAssignments, storedPayments);
    nextPayments = recoverPaymentsFromBankMovements(bankMovements, storedAssignments, nextPayments);
    const seedDayCloses = synthesizeDayClosesFromAssignments(
      storedAssignments,
      nextPayments,
      loadDemoDayCloses<CollectorDayCloseRecord>(),
    );
    const expenseDrafts = readDemoJson<CollectorDayExpenseDraft[]>(
      DEMO_COLLECTOR_DAY_EXPENSES_KEY,
      [],
    );
    const storedLogs = readDemoJson(DEMO_DAILY_LOGS_KEY, COLLECTOR_DAILY_LOGS_SEED);
    const reconciledLoans = syncAllLoans(storedLoans, nextPayments) as LoanRow[];
    const rebuilt = rebuildDispatchRoutes(
      storedRoutes,
      storedAssignments,
      storedCollectors,
      reconciledLoans,
      storedClients,
    );
    // Ciclo operativo: cierra jornadas vencidas (23:30) y arma planilla de hoy.
    const cycle = runOperationalDayCycle({
      assignments: storedAssignments,
      routes: rebuilt,
      logs: storedLogs,
      dayCloses: seedDayCloses,
      dayExpenseDrafts: expenseDrafts,
      payments: nextPayments,
      loans: reconciledLoans,
      clients: storedClients,
      collectors: storedCollectors,
    });
    const deduped = dedupeDailyPaymentsByVisit(cycle.payments, cycle.assignments);
    nextPayments = deduped.payments;
    const accounts = ensureBankAccounts(
      readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    const cleanedMovements = stripRemovedPaymentMovements(bankMovements, deduped.removedRefs);
    const misc = readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []);
    const synced = synchronizeOperationalState({
      loans: cycle.loans,
      payments: nextPayments,
      collectors: storedCollectors,
      clients: storedClients,
      dayCloses: cycle.dayCloses,
      dayExpenseDrafts: cycle.dayExpenseDrafts,
      bankAccounts: accounts,
      bankMovements: cleanedMovements,
      miscPayments: misc,
      assignments: cycle.assignments,
      dailyLogs: cycle.logs,
    });

    setDayCloses(synced.dayCloses);
    setDayExpenseDrafts(cycle.dayExpenseDrafts);
    setDailyLogs(synced.dailyLogs);
    setPayments(nextPayments);
    setLoans(synced.loans);
    setDailyAssignments(synced.assignments);
    setRoutes(cycle.routes);
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, synced.dayCloses);
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, cycle.dayExpenseDrafts);
    writeDemoJson(DEMO_DAILY_LOGS_KEY, synced.dailyLogs);
    writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments);
    writeDemoJson(DEMO_LOANS_KEY, synced.loans);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, synced.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, cycle.routes);
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, synced.bankMovements);
    setMonthCloses(
      readDemoJson<CollectorMonthCloseRecord[]>(DEMO_COLLECTOR_MONTH_CLOSES_KEY, []),
    );
    setHydrated(true);
  }, []);

  const applyPlanillaSync = useCallback(
    (next: {
      assignments: typeof dailyAssignments;
      routes: typeof routes;
      loans: typeof loans;
      logs: typeof dailyLogs;
      dayCloses: typeof dayCloses;
      dayExpenseDrafts: typeof dayExpenseDrafts;
      autoClosedCount: number;
    }) => {
      setDailyAssignments(next.assignments);
      setRoutes(next.routes);
      setLoans(next.loans);
      setDailyLogs(next.logs);
      setDayCloses(next.dayCloses);
      setDayExpenseDrafts(next.dayExpenseDrafts);
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, next.assignments);
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
          }),
        );
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
    writeDemoJson(DEMO_PAYMENTS_KEY, payments);
  }, [payments, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_LOANS_KEY, loans);
  }, [loans, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_CLIENTS_KEY, clients);
  }, [clients, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeDemoJson(DEMO_DAILY_LOGS_KEY, dailyLogs);
  }, [dailyLogs, hydrated]);

  function registerCollectorPayment(draft: CollectorPaymentDraft) {
    const ownershipError = assertOwnCollectorPayment(session.collectorRef, draft.collectorRef);
    if (ownershipError) {
      showToast(ownershipError);
      return false;
    }

    const committed = commitCollectorPayment({
      draft,
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

    setPayments(committed.payments);
    setLoans(committed.loans);
    setClients(committed.clients);
    setDailyAssignments(committed.assignments);
    setRoutes(committed.routes);
    writeDemoJson(DEMO_PAYMENTS_KEY, committed.payments);
    writeDemoJson(DEMO_LOANS_KEY, committed.loans);
    writeDemoJson(DEMO_CLIENTS_KEY, committed.clients);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, committed.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, committed.routes);

    const paidRoute = committed.routes.find(
      (row) =>
        row.ref.startsWith(`RUT-D-${draft.collectorRef}-`) &&
        committed.payment.routeRef === row.ref,
    );
    if (paidRoute) {
      setDailyLogs((current) => upsertDailyLogPayment(current, committed.payment, paidRoute));
    }

    const accounts = ensureBankAccounts(
      readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);
    const nextMovements = syncBankLedger({
      payments: committed.payments,
      movements: normalizeBankMovements(
        readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
      ),
      accounts,
      miscPayments: readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
      dayExpenseDrafts: readDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
      dayCloses: loadDemoDayCloses<CollectorDayCloseRecord>(),
    });
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, nextMovements);

    showToast(`Cobro ${committed.payment.ref} guardado · sincronizado en Registros y planillas.`);
    return true;
  }

  function renewCollectorLoan(loanRef: string) {
    const loan = loans.find((row) => row.ref === loanRef);
    if (!loan) {
      showToast("Préstamo no encontrado.");
      return;
    }
    const newRef = nextLoanCode(loans);
    const result = buildRenewalLoans(loan, newRef);
    if (!result) {
      showToast("La renovación se activa cuando se cumpla el plazo del préstamo.");
      return;
    }
    const nextLoans = [result.created, ...loans.map((row) => (row.ref === loanRef ? result.closed : row))];
    setLoans(nextLoans);
    setClients((current) =>
      current.map((entry) => {
        if (entry.ref !== loan.clientRef) return entry;
        return {
          ...entry,
          total: entry.total + (result.created.total ?? 0),
          pending: Math.max(0, entry.pending - loan.balance + (result.created.total ?? 0)),
        };
      }),
    );
    const planilla = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      clients,
      nextLoans,
      collectors,
      dailyAssignments,
      payments,
    );
    setDailyAssignments(planilla.assignments);
    setRoutes(planilla.routes);
    showToast(
      `Nuevo préstamo ${newRef}: capital ${money(result.created.capital)} + 20% · total ${money(result.created.total ?? 0)} · 1 mes.`,
    );
  }

  function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      showToast("Cliente no encontrado.");
      return;
    }
    const loan = buildQuickLoan(draft, client, loans);
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
    showToast(`Préstamo ${loan.ref} creado · cuota ${money(loan.installment ?? 0)}.`);
  }

  function skipCollectorVisit(draft: CollectorSkipVisitDraft) {
    if (!session.collectorRef) {
      showToast("Sin cobrador vinculado.");
      return;
    }

    const nextAssignments = skipAssignmentVisit(dailyAssignments, {
      collectorRef: session.collectorRef,
      dispatchDate: draft.dispatchDate,
      loanRef: draft.loanRef,
      clientRef: draft.clientRef,
      reason: draft.reason,
    });
    setDailyAssignments(nextAssignments);
    setRoutes((current) =>
      current.map((row) =>
        row.ref === draft.routeRef
          ? applySkipToRoute(row, draft.loanRef, draft.clientRef)
          : row,
      ),
    );
    showToast(
      draft.reason
        ? `Visita omitida · ${draft.reason}. Queda para reprogramar.`
        : "Visita omitida. Queda para reprogramar.",
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

  function closeCollectorDay(payload: CollectorCloseDayPayload) {
    const accounts = ensureBankAccounts(
      readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
    );
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);
    const lines = payload.expenses.filter((row) => row.amount > 0);

    const record = finalizeCollectorDayClose({
      draft: {
        collectorRef: payload.collectorRef,
        collectorName: payload.collectorName,
        date: payload.date,
        routeRef: payload.routeRef,
        collected: payload.collected,
        expenses: lines,
      },
      lines,
      movementRefs: lines.map((line) =>
        dayExpenseLineMovementRef(payload.collectorRef, payload.date, line.id),
      ),
    });
    const closes = loadDemoDayCloses<CollectorDayCloseRecord>();
    const nextCloses = [record, ...closes.filter((row) => row.ref !== record.ref)];
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, nextCloses);
    setDayCloses(nextCloses);

    const nextDrafts = removeDayExpenseDraft(
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
      }),
    );

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
    );
    const closedAssignments = applyDayCloseRecordsToAssignments(
      result.assignments,
      nextCloses,
    );
    setDailyAssignments(closedAssignments);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, closedAssignments);
    setRoutes(result.routes);
    writeDemoJson(DEMO_ROUTES_KEY, result.routes);
    setDailyLogs(result.logs);

    const alertResult = bumpMissedCollectionAlerts(
      loans,
      result.missedLoanRefs,
      payload.date,
      payments,
    );
    setLoans(alertResult.loans);
    writeDemoJson(DEMO_LOANS_KEY, alertResult.loans);

    const parts = [
      `caja menor ${money(record.cashFloat)}`,
      record.expensesTotal > 0 ? `gastos ${money(record.expensesTotal)} (Haber)` : null,
      formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora),
      !accounts.length && lines.length ? "sin cuenta banco: gastos quedan en cierre" : null,
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
              Cerrar sesión
            </button>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="collector-shell collector-shell-mobile">
      <CollectorMobileApp
        collector={collector}
        assignments={myAssignments}
        routes={myRoutes}
        loans={loans}
        clients={clients}
        payments={payments}
        dayCloses={dayCloses}
        dayExpenseDrafts={dayExpenseDrafts}
        monthCloses={monthCloses}
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
