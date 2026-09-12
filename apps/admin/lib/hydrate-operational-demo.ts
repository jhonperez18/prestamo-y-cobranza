/**
 * Hidratación operativa canónica (una sola línea de verdad).
 *
 * Admin, cobrador y supervisor leen/escriben el mismo snapshot de localStorage.
 * Así un cierre en la calle se ve igual en vista móvil del admin y en supervisor.
 */
import {
  COLLECTOR_DAILY_LOGS_SEED,
  type CollectorDailyLogRow,
} from "@/lib/collector-daily-log";
import {
  loadDemoBankMovements,
  loadDemoClients,
  loadDemoDayCloses,
  loadDemoPaymentsBundle,
  loadDemoUsers,
  readDemoJson,
  writeDemoJson,
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  DEMO_BANK_SIDES_VERSION_KEY,
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
  DEMO_USERS_KEY,
} from "@/lib/demo-persist";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
import { runOperationalDayCycle } from "@/lib/collector-day-auto-close";
import { rebuildDispatchRoutes } from "@/lib/collector-dispatch-sync";
import {
  recoverPaymentsFromAssignments,
  recoverPaymentsFromBankMovements,
  synthesizeDayClosesFromAssignments,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { synchronizeOperationalState } from "@/lib/operational-sync";
import { dedupeDailyPaymentsByVisit } from "@/lib/planilla-payment-reconcile";
import { stripRemovedPaymentMovements } from "@/lib/purge-unclosed-payments";
import { syncAllLoans } from "@/lib/loan-preview";
import { dedupeClientsByRef, migrateLegacyRouteName, normalizeAllRouteOrders } from "@/lib/client-route-order";
import { normalizeClientLifecycle } from "@/lib/client-review";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { MiscPayment } from "@/lib/misc-payments";
import {
  ensureBankAccounts,
  normalizeBankAccount,
  normalizeBankMovements,
  swapReconciliationDebitCredit,
  type BankAccount,
  type BankMovement,
  type BankReconciliation,
} from "@/lib/bank";
import {
  CLIENTS,
  COLLECTORS,
  COLLECTOR_UNASSIGNED_ZONE,
  ROUTES,
  ensureCollectorsForUsers,
  routeSlug,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type UserRow,
} from "@/lib/mock-data";

export type OperationalDemoSnapshot = {
  users: UserRow[];
  collectors: CollectorRow[];
  clients: ClientRow[];
  routes: RouteRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  dailyLogs: CollectorDailyLogRow[];
  monthCloses: CollectorMonthCloseRecord[];
  bankAccounts: BankAccount[];
  bankMovements: BankMovement[];
  bankReconciliations: BankReconciliation[];
  miscPayments: MiscPayment[];
};

/** Prefijo de claves que disparan re-hidratación entre pestañas. */
export const OPERATIONAL_DEMO_STORAGE_PREFIX = "nexo-demo-";

/**
 * Lee localStorage → ciclo operativo → sync banco/cierres → escribe de vuelta.
 * Misma función para admin / cobrador / supervisor.
 */
export function hydrateOperationalDemo(): OperationalDemoSnapshot {
  syncDemoStorageToServedBuild();

  const { payments: storedPayments, loans: storedLoans } = loadDemoPaymentsBundle();
  const storedCollectors = readDemoJson(DEMO_COLLECTORS_KEY, COLLECTORS).map((row) => ({
    ...row,
    zone: COLLECTOR_UNASSIGNED_ZONE,
  }));
  const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(
    DEMO_DAILY_ASSIGNMENTS_KEY,
    [],
  );
  const storedRoutes = readDemoJson(DEMO_ROUTES_KEY, ROUTES).map((row) => {
    const name = migrateLegacyRouteName(row.name);
    return {
      ...row,
      name,
      id: routeSlug(name),
      zone: row.zone ?? "",
    };
  });
  const storedClients = normalizeAllRouteOrders(
    dedupeClientsByRef(
      loadDemoClients(CLIENTS).map((row) =>
        normalizeClientLifecycle({
          ...row,
          nickname: row.nickname ?? "",
          routeOrder: Number(row.routeOrder) || 0,
          route: migrateLegacyRouteName(row.route),
        }),
      ),
    ),
  );
  writeDemoJson(DEMO_CLIENTS_KEY, storedClients);

  const storedMovementsEarly = loadDemoBankMovements<BankMovement>();
  let nextPayments = recoverPaymentsFromAssignments(storedAssignments, storedPayments);
  nextPayments = recoverPaymentsFromBankMovements(
    storedMovementsEarly ?? [],
    storedAssignments,
    nextPayments,
  );
  const recoveredDayCloses = synthesizeDayClosesFromAssignments(
    storedAssignments,
    nextPayments,
    loadDemoDayCloses<CollectorDayCloseRecord>(),
  );

  const reconciledLoans = syncAllLoans(storedLoans, nextPayments) as LoanRow[];
  const linked = ensureCollectorsForUsers(loadDemoUsers(), storedCollectors);
  writeDemoJson(DEMO_USERS_KEY, linked.users);
  writeDemoJson(DEMO_COLLECTORS_KEY, linked.collectors);

  const rebuilt = rebuildDispatchRoutes(
    storedRoutes,
    storedAssignments,
    linked.collectors,
    reconciledLoans,
    storedClients,
  );
  const storedLogs = readDemoJson(DEMO_DAILY_LOGS_KEY, COLLECTOR_DAILY_LOGS_SEED);
  const storedExpenseDrafts = readDemoJson<CollectorDayExpenseDraft[]>(
    DEMO_COLLECTOR_DAY_EXPENSES_KEY,
    [],
  );

  const cycle = runOperationalDayCycle({
    assignments: storedAssignments,
    routes: rebuilt,
    logs: storedLogs,
    dayCloses: recoveredDayCloses,
    dayExpenseDrafts: storedExpenseDrafts,
    payments: nextPayments,
    loans: reconciledLoans,
    clients: storedClients,
    collectors: linked.collectors,
  });
  const deduped = dedupeDailyPaymentsByVisit(cycle.payments, cycle.assignments);
  nextPayments = deduped.payments;

  const storedAccounts = ensureBankAccounts(
    readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount),
  );
  const storedMovements = stripRemovedPaymentMovements(
    storedMovementsEarly ?? [],
    deduped.removedRefs,
  );
  const misc = readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []);
  const synced = synchronizeOperationalState({
    loans: cycle.loans,
    payments: nextPayments,
    collectors: linked.collectors,
    clients: storedClients,
    dayCloses: cycle.dayCloses,
    dayExpenseDrafts: cycle.dayExpenseDrafts,
    bankAccounts: storedAccounts,
    bankMovements: storedMovements.length ? normalizeBankMovements(storedMovements) : [],
    miscPayments: misc,
    assignments: cycle.assignments,
    dailyLogs: cycle.logs,
  });

  const storedReconciliations = readDemoJson<BankReconciliation[]>(
    DEMO_BANK_RECONCILIATIONS_KEY,
    [],
  );
  const sidesVersion = readDemoJson<number>(DEMO_BANK_SIDES_VERSION_KEY, 1);
  const nextReconciliations =
    sidesVersion < 2
      ? swapReconciliationDebitCredit(storedReconciliations)
      : storedReconciliations;
  const monthCloses = readDemoJson<CollectorMonthCloseRecord[]>(
    DEMO_COLLECTOR_MONTH_CLOSES_KEY,
    [],
  );

  writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, synced.assignments);
  writeDemoJson(DEMO_ROUTES_KEY, cycle.routes);
  writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments);
  writeDemoJson(DEMO_LOANS_KEY, synced.loans);
  writeDemoJson(DEMO_DAILY_LOGS_KEY, synced.dailyLogs);
  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, synced.dayCloses);
  writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, cycle.dayExpenseDrafts);
  writeDemoJson(DEMO_BANK_SIDES_VERSION_KEY, 2);
  writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, nextReconciliations);
  writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, storedAccounts);
  writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, synced.bankMovements);

  return {
    users: linked.users,
    collectors: linked.collectors,
    clients: storedClients,
    routes: cycle.routes,
    loans: synced.loans,
    payments: nextPayments,
    assignments: synced.assignments,
    dayCloses: synced.dayCloses,
    dayExpenseDrafts: cycle.dayExpenseDrafts,
    dailyLogs: synced.dailyLogs,
    monthCloses,
    bankAccounts: storedAccounts,
    bankMovements: synced.bankMovements,
    bankReconciliations: nextReconciliations,
    miscPayments: misc,
  };
}
