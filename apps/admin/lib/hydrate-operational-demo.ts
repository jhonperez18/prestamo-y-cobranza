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
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  DEMO_ROUTES_KEY,
  DEMO_USERS_KEY,
  dedupeCatalogRoutesByName,
  isVirginOpsMode,
  listDeletedRouteRefs,
} from "@/lib/demo-persist";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
import { ensureManualTLaunchClose, projectPceTFromDayCloses } from "@/lib/planilla-cash-chain";
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
import { restoreSealedVisitsFromPrior } from "@/lib/planilla-sealed-visits";
import { refreshLabelsFromCatalog } from "@/lib/project-identity";
import { omitDeleted } from "@/lib/deleted-ids";
import { dedupeDailyPaymentsByVisit } from "@/lib/planilla-payment-reconcile";
import { stripRemovedPaymentMovements } from "@/lib/purge-unclosed-payments";
import { syncAllLoans } from "@/lib/loan-preview";
import {
  indexPaymentEvidenceFromPayments,
  withPaymentEvidence,
} from "@/lib/payment-evidence-store";
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
  COLLECTOR_UNASSIGNED_ZONE,
  ROUTES,
  ensureCollectorsForUsers,
  syncRouteCollectorNames,
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
  const storedCollectors = readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, []).map((row) => ({
    ...row,
    zone: COLLECTOR_UNASSIGNED_ZONE,
  }));
  const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(
    DEMO_DAILY_ASSIGNMENTS_KEY,
    [],
  );
  const deletedRoutes = new Set(listDeletedRouteRefs());
  const storedRoutes = dedupeCatalogRoutesByName(
    readDemoJson(DEMO_ROUTES_KEY, isVirginOpsMode() ? [] : ROUTES)
      .filter((row) => row?.ref && !deletedRoutes.has(row.ref))
      .map((row) => {
        const name = migrateLegacyRouteName(row.name);
        return {
          ...row,
          name,
          id: routeSlug(name),
          zone: row.zone ?? "",
        };
      }),
  );
  writeDemoJson(DEMO_ROUTES_KEY, storedRoutes);
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
  const liveClients = omitDeleted(storedClients);
  writeDemoJson(DEMO_CLIENTS_KEY, liveClients);

  const storedMovementsEarly = loadDemoBankMovements<BankMovement>();
  // Virgen: no resucitar PG- desde planilla/banco viejos.
  let nextPayments = isVirginOpsMode()
    ? storedPayments
    : recoverPaymentsFromAssignments(storedAssignments, storedPayments);
  if (!isVirginOpsMode()) {
    nextPayments = recoverPaymentsFromBankMovements(
      storedMovementsEarly ?? [],
      storedAssignments,
      nextPayments,
    );
  }
  const recoveredDayCloses = isVirginOpsMode()
    ? loadDemoDayCloses<CollectorDayCloseRecord>()
    : synthesizeDayClosesFromAssignments(
        storedAssignments,
        nextPayments,
        loadDemoDayCloses<CollectorDayCloseRecord>(),
      );

  const reconciledLoans = syncAllLoans(storedLoans, nextPayments) as LoanRow[];
  // No inventar COB en hydrate (evita diego fantasma entre localhost/Vercel).
  const linked = ensureCollectorsForUsers(loadDemoUsers(), storedCollectors, {
    inventMissing: false,
  });
  // Solo cobradores atados al listado (o huérfanos aún en cola de mirror).
  const linkedRefs = new Set(
    linked.users.map((row) => row.collectorRef).filter(Boolean) as string[],
  );
  const prunedCollectors = linked.collectors.filter(
    (row) => linkedRefs.has(row.ref) || Boolean(row.userRef && linked.users.some((u) => u.ref === row.userRef)),
  );
  const namedRoutes = syncRouteCollectorNames(
    storedRoutes,
    linked.users,
    prunedCollectors,
  );
  writeDemoJson(DEMO_USERS_KEY, linked.users);
  writeDemoJson(DEMO_COLLECTORS_KEY, prunedCollectors);
  writeDemoJson(DEMO_ROUTES_KEY, namedRoutes);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("nexo-users-catalog-changed"));
  }

  const rebuilt = rebuildDispatchRoutes(
    namedRoutes,
    storedAssignments,
    prunedCollectors,
    reconciledLoans,
    liveClients,
  );
  const storedLogs = readDemoJson(DEMO_DAILY_LOGS_KEY, COLLECTOR_DAILY_LOGS_SEED);
  const storedExpenseDrafts = readDemoJson<CollectorDayExpenseDraft[]>(
    DEMO_COLLECTOR_DAY_EXPENSES_KEY,
    [],
  );
  const storedPlanillaCash = projectPceTFromDayCloses(
    ensureManualTLaunchClose(
      readDemoJson<
        import("@/lib/planilla-cash-chain").PlanillaCashCloseRecord[]
      >(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
    ),
    recoveredDayCloses,
  );
  const monthClosesEarly = readDemoJson<CollectorMonthCloseRecord[]>(
    DEMO_COLLECTOR_MONTH_CLOSES_KEY,
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
    clients: liveClients,
    collectors: prunedCollectors,
    planillaCashCloses: storedPlanillaCash,
    monthCloses: monthClosesEarly,
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
    collectors: prunedCollectors,
    clients: liveClients,
    dayCloses: cycle.dayCloses,
    dayExpenseDrafts: cycle.dayExpenseDrafts,
    bankAccounts: storedAccounts,
    bankMovements: storedMovements.length ? normalizeBankMovements(storedMovements) : [],
    miscPayments: misc,
    assignments: cycle.assignments,
    dailyLogs: cycle.logs,
  });
  const labeled = refreshLabelsFromCatalog({
    clients: liveClients,
    users: linked.users,
    collectors: prunedCollectors,
    loans: synced.loans,
    payments: nextPayments,
    routes: cycle.routes,
    assignments: restoreSealedVisitsFromPrior(synced.assignments, storedAssignments),
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
  const monthCloses = monthClosesEarly;

  const liveRoutes = omitDeleted(labeled.routes);
  const livePayments = omitDeleted(labeled.payments);
  const liveLoans = omitDeleted(labeled.loans);
  writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, labeled.assignments);
  writeDemoJson(DEMO_ROUTES_KEY, liveRoutes);
  writeDemoJson(DEMO_PAYMENTS_KEY, livePayments);
  writeDemoJson(DEMO_LOANS_KEY, liveLoans);
  writeDemoJson(DEMO_DAILY_LOGS_KEY, synced.dailyLogs);
  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, synced.dayCloses);
  writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, cycle.dayExpenseDrafts);
  writeDemoJson(
    DEMO_PLANILLA_CASH_CLOSES_KEY,
    projectPceTFromDayCloses(
      ensureManualTLaunchClose(cycle.planillaCashCloses),
      synced.dayCloses,
    ),
  );
  writeDemoJson(DEMO_BANK_SIDES_VERSION_KEY, 2);
  writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, nextReconciliations);
  writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, storedAccounts);
  writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, synced.bankMovements);

  indexPaymentEvidenceFromPayments(livePayments);
  const paymentsWithEvidence = livePayments.map(withPaymentEvidence);

  return {
    users: linked.users,
    collectors: prunedCollectors,
    clients: liveClients,
    routes: liveRoutes,
    loans: liveLoans,
    payments: paymentsWithEvidence,
    assignments: labeled.assignments,
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
