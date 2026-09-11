"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleId } from "@/lib/navigation";
import { CLIENTS, COLLECTORS, ACTIVITY, ADMIN_ROLE_REF, ASSIGNABLE_ROLES, COLLECTOR_ROLE_REF, COLLECTOR_UNASSIGNED_ZONE, DEMO_USER_PASSWORD, activeLoans, loansForClient, LOANS, money, nextClientCode, clientCreationDate, nextCollectorCode, nextLoanCode, nextPaymentCode, nextRouteCode, nextUserCode, normalizeRouteNumber, normalizeUserPermissions, PAYMENTS, roleByRef, ROLES, ROUTES, routeSlug, catalogRoutes, clientsOnRouteListed, routeIsActive, routeStatusMeta, userForCollector, ensureCollectorsForUsers, collectorViewForUser, USERS, type ClientRow, type CollectorRow, type LoanRow, type PaymentRow, type RouteRow, type UserRow } from "@/lib/mock-data";
import {
  CLIENT_STATUS_ACTIVE,
  CLIENT_STATUS_REVIEW,
  clientNavBadges,
  clientsForView,
  clientStatusKind,
  isPendingReview,
  normalizeClientLifecycle,
  pendingReviewClients,
} from "@/lib/client-review";
import type { AppSession } from "@/lib/auth";
import { AccessDenied } from "@/components/AccessDenied";
import { canApproveFromPermissions, canAccessView } from "@/lib/session-access";
import { buildAlerts } from "@/lib/alerts";
import { EditUserForm, type UserEditDraft } from "@/components/EditUserForm";
import { UserFicha, type UserTab } from "@/components/UserFicha";
import { NewUserForm, type UserDraft } from "@/components/NewUserForm";
import { UserList } from "@/components/UserList";
import { DailyCollectionsView } from "@/components/DailyCollectionsView";
import {
  buildQuickLoan,
  buildStreetClient,
  insertStreetClient,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";
import {
  isoToDispatchLabel,
  isoToDispatchToken,
  monthStartIso,
  todayIso,
} from "@/lib/daily-dispatch";
import { buildDailyCollectionList, type DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  applySkipToRoute,
  assignmentFromItem,
  buildDispatchRoute,
  closeDispatchDay,
  dispatchRouteRef,
  markAssignmentsDispatched,
  rebuildDispatchRoutes,
  skipAssignmentVisit,
  upsertDispatchDailyLog,
  upsertDispatchRoute,
} from "@/lib/collector-dispatch-sync";
import { collectorPayments, userDeleteGuard, type CollectorTab } from "@/lib/collector-preview";
import { NewClientForm, type ClientDraft } from "@/components/NewClientForm";
import { CollectorActivityView } from "@/components/CollectorActivityView";
import { CollectorFicha } from "@/components/CollectorFicha";
import { CollectorZonesView } from "@/components/CollectorZonesView";
import { NewLoanForm, type LoanDraft } from "@/components/NewLoanForm";
import { NewRouteForm, type RouteDraft } from "@/components/NewRouteForm";
import { ClientDetailTable } from "@/components/ClientDetailTable";
import { LoanDetailView } from "@/components/LoanDetailView";
import { LoanFichaGrid } from "@/components/LoanFichaGrid";
import { LoanPayForm } from "@/components/LoanPayForm";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { PaymentFicha } from "@/components/PaymentFicha";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import { PaymentRefLink } from "@/components/PaymentRefLink";
import { LoanReportView } from "@/components/LoanReportView";
import { DataTable, Pill } from "@/components/ui";
import { ClientList } from "@/components/ClientList";
import { HomeDashboard } from "@/components/HomeDashboard";
import {
  assignCollectorToCatalogRoute,
  planillaDayBlockedReason,
  syncPermanentRoutePlanilla,
} from "@/lib/route-planilla";
import { usePlanillaDayRollover } from "@/lib/planilla-day-sync";
import { AssignRouteCollectorView } from "@/components/AssignRouteCollectorView";
import { PermissionsPanel, RolePanel } from "@/components/RolePanel";
import { CarteraView } from "@/components/CarteraView";
import { CobranzaPaymentsView } from "@/components/CobranzaPaymentsView";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import {
  CARTERA_POR_COBRADOR_COLUMNS,
  CARTERA_POR_RUTA_COLUMNS,
  REPORTES_GENERIC_COLUMNS,
} from "@/components/ListDataTableShell";
import { SystemSettingsView } from "@/components/SystemSettingsView";
import { AdminProfileView } from "@/components/AdminProfileView";
import { BankExtractView } from "@/components/BankExtractView";
import { BankExtractsListView } from "@/components/BankExtractsListView";
import { BankAccountListView } from "@/components/BankAccountListView";
import { BankNewAccountForm } from "@/components/BankNewAccountForm";
import { BankReportView } from "@/components/BankReportView";
import { BankReconciledLedgerView } from "@/components/BankReconciledLedgerView";
import { MiscPaymentNewForm } from "@/components/MiscPaymentNewForm";
import { MiscPaymentFicha } from "@/components/MiscPaymentFicha";
import { MiscPaymentListView } from "@/components/MiscPaymentListView";
import { BankExpenseFicha } from "@/components/BankExpenseFicha";
import { BankRecordsHistoryView } from "@/components/BankRecordsHistoryView";
import { CollectorMobilePreview } from "@/components/CollectorMobilePreview";
import type {
  CollectorSkipVisitDraft,
  CollectorCloseDayPayload,
  CollectorCloseMonthPayload,
  CollectorSaveExpensesPayload,
} from "@/components/CollectorMobileApp";
import { ColumnPicker, ColumnPickerBodyCell, useColumnVisibility } from "@/components/ColumnPicker";
import { LoanPaymentsTable } from "@/components/LoanPaymentsTable";
import {
  PRESTAMO_LIST_COLUMNS,
  PRESTAMO_LIST_DEFAULT_COLS,
} from "@/lib/table-columns";
import { loanStatusPill } from "@/lib/loan-status";
import { chargeLabel, displayToIso, isoToDisplay, normalizeLoan, syncAllLoans, syncLoan } from "@/lib/loan-preview";
import { synchronizeOperationalState } from "@/lib/operational-sync";
import { computeLoanFinancials, loanPaySummaryRows } from "@/lib/loan-balance";
import { buildRenewalLoans } from "@/lib/loan-renew";
import { buildPortfolioStats } from "@/lib/portfolio-stats";
import {
  enrichPaymentMovement,
  buildPaymentRow,
  loansByRef,
  sortPaymentsNewestFirst,
} from "@/lib/payment-detail";
import {
  normalizePaymentMethod,
  paymentMethodKind,
  paymentMethodLabel,
  type PaymentMethod,
} from "@/lib/payment-method";
import {
  buildRouteStop,
  type CollectorPaymentDraft,
} from "@/lib/route-sync";
import {
  dedupeClientsByRef,
  migrateLegacyRouteName,
  normalizeAllRouteOrders,
  placeClientOnRoute,
} from "@/lib/client-route-order";
import { applyPay, cuotaTarget, loanRowAfterPay, paymentRowKind, type PayKind } from "@/lib/loan-pay";
import {
  bumpMissedCollectionAlerts,
  formatCloseDayAlertSummary,
} from "@/lib/collection-alerts";
import {
  COLLECTOR_DAILY_LOGS_SEED,
  upsertDailyLogPayment,
  type CollectorDailyLogRow,
} from "@/lib/collector-daily-log";
import {
  currentPeriod,
  isBankExpenseMovement,
  normalizeBankAccount,
  normalizeBankMovements,
  ensureBankAccounts,
  swapReconciliationDebitCredit,
  type BankAccount,
  type BankLedgerKind,
  type BankMovement,
  type BankReconciliation,
} from "@/lib/bank";
import { applyBankLedgerSync, syncBankLedger } from "@/lib/bank-ledger-sync";
import {
  stripRemovedPaymentMovements,
} from "@/lib/purge-unclosed-payments";
import { commitCollectorPayment } from "@/lib/commit-collector-payment";
import { runOperationalDayCycle } from "@/lib/collector-day-auto-close";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
import { dedupeDailyPaymentsByVisit } from "@/lib/planilla-payment-reconcile";
import type { MiscPayment } from "@/lib/misc-payments";
import { findMiscPaymentForMovement, miscPaymentRefForMovement } from "@/lib/misc-payments";
import {
  DEMO_COLLECTORS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_USERS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  DEMO_BANK_SIDES_VERSION_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  loadDemoPaymentsBundle,
  loadDemoUsers,
  loadDemoClients,
  loadDemoDayCloses,
  loadDemoBankMovements,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  buildDayExpenseDraft,
  buildMonthCloseRecord,
  dayExpenseLineMovementRef,
  finalizeCollectorDayClose,
  applyDayCloseRecordsToAssignments,
  recoverPaymentsFromAssignments,
  recoverPaymentsFromBankMovements,
  removeDayExpenseDraft,
  synthesizeDayClosesFromAssignments,
  upsertDayExpenseDraft,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";

type FileTab = "ficha" | "activos" | "prestamos" | "evidencias";
type LoanTab = "ficha" | "prestamos" | "pagos";

/** Oculta el breadcrumb cuando la vista ya muestra su título en el panel (Listado 10, Activos 8, etc.). */
function shouldHideCrumb(moduleId: ModuleId, viewId: string) {
  if (moduleId === "prestamos") {
    return !["cuenta", "editar", "nuevo", "informe"].includes(viewId);
  }
  if (moduleId === "clientes") {
    return !["ficha"].includes(viewId);
  }
  if (moduleId === "inicio") {
    return !["ficha-usuario", "pagos-varios-ficha"].includes(viewId);
  }
  if (moduleId === "cartera" || moduleId === "reportes") {
    return true;
  }
  if (moduleId === "banco") {
    return (
      viewId !== "extracto" &&
      viewId !== "extracto-pendiente" &&
      viewId !== "nueva-cuenta" &&
      viewId !== "registro-gasto"
    );
  }
  if (moduleId === "cobranza") {
    return viewId !== "ficha-pago";
  }
  return false;
}

type Props = {
  moduleId: ModuleId;
  viewId: string;
  viewLabel: string;
  moduleLabel: string;
  onGo: (moduleId: ModuleId, viewId?: string) => void;
  onToast: (message?: string) => void;
  onNavBadges?: (badges: Record<string, string | undefined>) => void;
  adminName?: string;
  session: AppSession;
  onSessionChange: (session: AppSession) => void;
  sessionUserRef: string;
  sessionPermissions: string[];
};

export function Workspace({
  moduleId,
  viewId,
  viewLabel,
  moduleLabel,
  onGo,
  onToast,
  onNavBadges,
  adminName = "Administrador",
  session,
  onSessionChange,
  sessionUserRef,
  sessionPermissions,
}: Props) {
  const key = `${moduleId}:${viewId}`;
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>(PAYMENTS);
  const [routes, setRoutes] = useState<RouteRow[]>(ROUTES);
  const [collectors, setCollectors] = useState<CollectorRow[]>(COLLECTORS);
  const [users, setUsers] = useState<UserRow[]>(USERS);
  const [dailyLogs, setDailyLogs] = useState<CollectorDailyLogRow[]>(COLLECTOR_DAILY_LOGS_SEED);
  const [dailyAssignments, setDailyAssignments] = useState<DailyCollectionAssignment[]>([]);
  const [dayCloses, setDayCloses] = useState<CollectorDayCloseRecord[]>([]);
  const [dayExpenseDrafts, setDayExpenseDrafts] = useState<CollectorDayExpenseDraft[]>([]);
  const [monthCloses, setMonthCloses] = useState<CollectorMonthCloseRecord[]>([]);
  const [cobranzaPagosToday, setCobranzaPagosToday] = useState(false);
  const [activities] = useState(ACTIVITY);
  const [openRef, setOpenRef] = useState(CLIENTS[0]?.ref ?? "");
  const [openUserRef, setOpenUserRef] = useState(USERS[0]?.ref ?? "");
  const [openCollectorRef, setOpenCollectorRef] = useState(COLLECTORS[0]?.ref ?? "");
  const [collectorTab, setCollectorTab] = useState<CollectorTab>("ficha");
  const [userTab, setUserTab] = useState<UserTab>("ficha");
  const [confirmUserDelete, setConfirmUserDelete] = useState(false);
  const [openLoanRef, setOpenLoanRef] = useState(LOANS[0]?.ref ?? "");
  const [fileTab, setFileTab] = useState<FileTab>("ficha");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLoanDelete, setConfirmLoanDelete] = useState(false);
  const [openRouteRef, setOpenRouteRef] = useState("");
  const [confirmRouteDelete, setConfirmRouteDelete] = useState("");
  const [listCollectorRef, setListCollectorRef] = useState("");
  const [listRouteName, setListRouteName] = useState("");
  const [listDateFrom, setListDateFrom] = useState(monthStartIso);
  const [listDateTo, setListDateTo] = useState(todayIso);
  const [listQuery, setListQuery] = useState("");
  const [payMode, setPayMode] = useState<PayKind | null>(null);
  const [loanTab, setLoanTab] = useState<LoanTab>("ficha");
  const navigationKey = `${moduleId}:${viewId}:${openRef}:${fileTab}:${openUserRef}:${openCollectorRef}:${openRouteRef}:${collectorTab}:${userTab}`;
  const [seenKey, setSeenKey] = useState(navigationKey);
  const [demoHydrated, setDemoHydrated] = useState(false);
  const [mobilePreviewCollectorRef, setMobilePreviewCollectorRef] = useState(COLLECTORS[0]?.ref ?? "");
  const [openPaymentRef, setOpenPaymentRef] = useState(PAYMENTS[0]?.ref ?? "");
  const [paymentReturnView, setPaymentReturnView] = useState<"pagos" | "abonos">("pagos");
  const [paymentFichaReturn, setPaymentFichaReturn] = useState<{ moduleId: ModuleId; viewId: string } | null>(
    null,
  );
  const [openMiscPaymentRef, setOpenMiscPaymentRef] = useState("");
  const [miscPaymentReturn, setMiscPaymentReturn] = useState<{ moduleId: ModuleId; viewId: string } | null>(
    null,
  );
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankMovements, setBankMovements] = useState<BankMovement[]>([]);
  const [bankReconciliations, setBankReconciliations] = useState<BankReconciliation[]>([]);
  const [bankPeriod, setBankPeriod] = useState(currentPeriod());
  const [bankAccountRef, setBankAccountRef] = useState("");
  const [bankLedgerPeriod, setBankLedgerPeriod] = useState<string | null>(null);
  const [bankRecordsAccountRef, setBankRecordsAccountRef] = useState<string | null>(null);
  const bankLedgerFromReportRef = useRef(false);
  const [openBankMovementRef, setOpenBankMovementRef] = useState("");
  const [bankExpenseReturn, setBankExpenseReturn] = useState<{ moduleId: ModuleId; viewId: string } | null>(
    null,
  );
  const [miscPayments, setMiscPayments] = useState<MiscPayment[]>([]);

  const prestamoListColumns = useColumnVisibility(PRESTAMO_LIST_COLUMNS, PRESTAMO_LIST_DEFAULT_COLS, {
    storageKey: "nexo.prestamos.listado.columns.v3",
  });

  useEffect(() => {
    // Nuevo deploy → no heredar flags de jornada cerrada del build anterior.
    syncDemoStorageToServedBuild();
    const { payments: storedPayments, loans: storedLoans } = loadDemoPaymentsBundle();
    const storedCollectors = readDemoJson(DEMO_COLLECTORS_KEY, COLLECTORS).map((row) => ({
      ...row,
      zone: COLLECTOR_UNASSIGNED_ZONE,
    }));
    const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
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
    setClients(storedClients);
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

    setPayments(nextPayments);
    const reconciledLoans = syncAllLoans(storedLoans, nextPayments) as LoanRow[];
    setLoans(reconciledLoans);
    const linked = ensureCollectorsForUsers(loadDemoUsers(), storedCollectors);
    setUsers(linked.users);
    setCollectors(linked.collectors);
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
    // Ciclo operativo: cierra jornadas vencidas (23:30) y arma planilla de hoy.
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

    setRoutes(cycle.routes);
    setDailyAssignments(synced.assignments);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, synced.assignments);
    writeDemoJson(DEMO_ROUTES_KEY, cycle.routes);
    setPayments(nextPayments);
    setLoans(synced.loans);
    writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments);
    writeDemoJson(DEMO_LOANS_KEY, synced.loans);
    setDailyLogs(synced.dailyLogs);
    writeDemoJson(DEMO_DAILY_LOGS_KEY, synced.dailyLogs);
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, synced.dayCloses);
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, cycle.dayExpenseDrafts);
    setDayCloses(synced.dayCloses);
    setDayExpenseDrafts(cycle.dayExpenseDrafts);
    setMonthCloses(
      readDemoJson<CollectorMonthCloseRecord[]>(DEMO_COLLECTOR_MONTH_CLOSES_KEY, []),
    );
    const storedReconciliations = readDemoJson<BankReconciliation[]>(DEMO_BANK_RECONCILIATIONS_KEY, []);
    const sidesVersion = readDemoJson<number>(DEMO_BANK_SIDES_VERSION_KEY, 1);
    const nextReconciliations =
      sidesVersion < 2 ? swapReconciliationDebitCredit(storedReconciliations) : storedReconciliations;
    setBankAccounts(storedAccounts);
    setBankMovements(synced.bankMovements);
    setBankReconciliations(nextReconciliations);
    writeDemoJson(DEMO_BANK_SIDES_VERSION_KEY, 2);
    writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, nextReconciliations);
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, storedAccounts);
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, synced.bankMovements);
    setBankAccountRef(storedAccounts[0]?.ref ?? "");
    setMiscPayments(misc);
    setDemoHydrated(true);
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
    },
    [],
  );

  usePlanillaDayRollover(
    demoHydrated,
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
    if (moduleId !== "cobranza" || viewId !== "pagos") {
      setCobranzaPagosToday(false);
    }
  }, [moduleId, viewId]);

  // Una sola sincronización banco ← cobros / gastos / pagos varios (idempotente).
  useEffect(() => {
    if (!demoHydrated) return;
    setBankMovements((rows) =>
      applyBankLedgerSync(rows, {
        payments,
        accounts: bankAccounts,
        miscPayments,
        dayExpenseDrafts,
        dayCloses,
      }),
    );
  }, [demoHydrated, payments, dayExpenseDrafts, dayCloses, bankAccounts, miscPayments]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_USERS_KEY, users);
  }, [users, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_COLLECTORS_KEY, collectors);
  }, [collectors, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_ROUTES_KEY, routes);
  }, [routes, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_DAILY_LOGS_KEY, dailyLogs);
  }, [dailyLogs, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, dayCloses);
  }, [dayCloses, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, dayExpenseDrafts);
  }, [dayExpenseDrafts, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, monthCloses);
  }, [monthCloses, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_CLIENTS_KEY, clients);
  }, [clients, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    const alerts = buildAlerts(pendingReviewClients(clients).length, loans, clients, payments);
    onNavBadges?.({
      ...clientNavBadges(clients),
      "inicio:alertas": alerts.length > 0 ? String(alerts.length) : undefined,
    });
  }, [clients, loans, demoHydrated, onNavBadges]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, dailyAssignments);
  }, [dailyAssignments, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_PAYMENTS_KEY, payments);
  }, [payments, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_LOANS_KEY, loans);
  }, [loans, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, bankAccounts);
  }, [bankAccounts, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, bankMovements);
  }, [bankMovements, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, bankReconciliations);
  }, [bankReconciliations, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_MISC_PAYMENTS_KEY, miscPayments);
  }, [miscPayments, demoHydrated]);

  useEffect(() => {
    if (
      moduleId === "banco" &&
      (viewId === "informe-ingresos" || viewId === "informe-gastos") &&
      !bankLedgerFromReportRef.current
    ) {
      setBankLedgerPeriod(null);
    }
    bankLedgerFromReportRef.current = false;
  }, [moduleId, viewId]);

  if (seenKey !== navigationKey) {
    setSeenKey(navigationKey);
    setConfirmDelete(false);
    setConfirmLoanDelete(false);
    setConfirmUserDelete(false);
    setConfirmRouteDelete("");
    setPayMode(null);
  }

  const openClient = clients.find((row) => row.ref === openRef) ?? null;
  const rawOpenLoan = loans.find((row) => row.ref === openLoanRef) ?? null;
  const openLoan = rawOpenLoan ? (syncLoan(rawOpenLoan, payments) as LoanRow) : null;
  const openUser = users.find((row) => row.ref === openUserRef) ?? null;
  /** Cobrador de la ficha: siempre el del usuario abierto (sin cruzar con otro). */
  const openCollector = openUser ? collectorViewForUser(openUser, collectors) : null;
  const catalogRouteList = catalogRoutes(routes);
  const openRoute = catalogRouteList.find((row) => row.ref === openRouteRef) ?? null;
  const activeCatalogRoutes = catalogRouteList.filter(routeIsActive);
  const filterRouteNames = catalogRouteList
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((row) => row.name);
  const filterCollectors = collectors
    .filter((row) => row.active)
    .map((row) => ({ ref: row.ref, name: row.name }));
  const listFilterOptions = {
    collectors: filterCollectors,
    routes: filterRouteNames,
    collectorRef: listCollectorRef,
    routeName: listRouteName,
    dateFrom: listDateFrom,
    dateTo: listDateTo,
    query: listQuery,
    onCollectorChange: setListCollectorRef,
    onRouteChange: setListRouteName,
    onDateFromChange: setListDateFrom,
    onDateToChange: setListDateTo,
    onQueryChange: setListQuery,
  };

  function loanMatchesListFilters(loan: LoanRow) {
    const client = clients.find((entry) => entry.ref === loan.clientRef);
    if (listRouteName && client?.route !== listRouteName) return false;
    if (listCollectorRef) {
      const route = catalogRouteList.find((row) => row.name === client?.route);
      if (!route || route.collectorRef !== listCollectorRef) return false;
    }
    const iso = displayToIso(loan.date);
    if (iso && listDateFrom && iso < listDateFrom) return false;
    if (iso && listDateTo && iso > listDateTo) return false;
    const q = listQuery.trim().toLowerCase();
    if (q) {
      const hay = [loan.ref, loan.client, client?.document, client?.route, client?.name, client?.lastName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function routeMatchesListFilters(route: RouteRow) {
    if (listRouteName && route.name !== listRouteName) return false;
    if (listCollectorRef && route.collectorRef !== listCollectorRef) return false;
    const q = listQuery.trim().toLowerCase();
    if (q) {
      const hay = `${route.ref} ${route.name} ${route.collector ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  const sessionUser = users.find((row) => row.ref === sessionUserRef) ?? null;
  const canApproveClient = canApproveFromPermissions(sessionPermissions);
  const accessSession = { permissions: sessionPermissions } as AppSession;
  const viewAllowed = canAccessView(accessSession, moduleId, viewId);

  function openFicha(ref: string) {
    setOpenRef(ref);
    setFileTab("ficha");
    onGo("clientes", "ficha");
  }

  function goFileTab(id: FileTab) {
    setFileTab(id);
    onGo("clientes", "ficha");
  }

  function openLoanAccount(ref: string) {
    setOpenLoanRef(ref);
    setLoanTab("ficha");
    setPayMode(null);
    onGo("prestamos", "cuenta");
  }

  function openPaymentFicha(
    ref: string,
    returnView: "pagos" | "abonos" = "pagos",
    returnTo?: { moduleId: ModuleId; viewId: string },
  ) {
    setOpenPaymentRef(ref);
    setPaymentReturnView(returnView);
    setPaymentFichaReturn(returnTo ?? null);
    onGo("cobranza", "ficha-pago");
  }

  function openMiscPaymentFromBank(
    ref: string,
    returnTo: { moduleId: ModuleId; viewId: string },
  ) {
    setOpenMiscPaymentRef(ref);
    setMiscPaymentReturn(returnTo);
    onGo("inicio", "pagos-varios-listado");
  }

  function openMiscPaymentFicha(
    ref: string,
    returnTo?: { moduleId: ModuleId; viewId: string },
  ) {
    setOpenMiscPaymentRef(ref);
    setMiscPaymentReturn(returnTo ?? null);
    onGo("inicio", "pagos-varios-ficha");
  }

  function openBankExpenseFicha(
    movementRef: string,
    returnTo?: { moduleId: ModuleId; viewId: string },
  ) {
    setOpenBankMovementRef(movementRef);
    setBankExpenseReturn(returnTo ?? null);
    onGo("banco", "registro-gasto");
  }

  function openExpenseFromMovement(
    row: BankMovement,
    returnTo: { moduleId: ModuleId; viewId: string },
  ) {
    const miscRef = miscPaymentRefForMovement(row, miscPayments);
    if (miscRef) {
      openMiscPaymentFicha(miscRef, returnTo);
      return;
    }
    openBankExpenseFicha(row.ref, returnTo);
  }

  function returnFromBankExpensePanel() {
    const target = bankExpenseReturn ?? { moduleId: "banco" as ModuleId, viewId: "informe-gastos" };
    setBankExpenseReturn(null);
    setOpenBankMovementRef("");
    onGo(target.moduleId, target.viewId);
  }

  function openBankLedgerFromReport(kind: BankLedgerKind, period: string) {
    bankLedgerFromReportRef.current = true;
    setBankLedgerPeriod(period);
    onGo("banco", kind === "income" ? "informe-ingresos" : "informe-gastos");
  }

  function returnFromMiscPaymentPanel() {
    const target = miscPaymentReturn ?? { moduleId: "inicio" as ModuleId, viewId: "pagos-varios-listado" };
    setMiscPaymentReturn(null);
    setOpenMiscPaymentRef("");
    onGo(target.moduleId, target.viewId);
  }

  function openMiscPaymentEdit(
    ref: string,
    returnTo?: { moduleId: ModuleId; viewId: string },
  ) {
    setOpenMiscPaymentRef(ref);
    if (returnTo) setMiscPaymentReturn(returnTo);
    onGo("inicio", "pagos-varios-editar");
  }

  function openUserFicha(userRef: string, tab: CollectorTab | UserTab = "ficha") {
    const wanted = String(userRef ?? "").trim();
    let user = users.find((row) => row.ref === wanted);
    if (!user) {
      onToast("Usuario no encontrado.");
      return;
    }

    let collectorRows = collectors;
    // Si es cobrador sin COB válido, reparar antes de abrir la ficha.
    if (user.roleRef === COLLECTOR_ROLE_REF && !collectorViewForUser(user, collectors)) {
      const repaired = ensureCollectorsForUsers(users, collectors);
      setUsers(repaired.users);
      setCollectors(repaired.collectors);
      collectorRows = repaired.collectors;
      user = repaired.users.find((row) => row.ref === wanted) ?? user;
    }

    setOpenUserRef(user.ref);
    const linkedCollector = collectorViewForUser(user, collectorRows);
    if (linkedCollector) {
      const switchingCollector = linkedCollector.ref !== openCollectorRef;
      setOpenCollectorRef(linkedCollector.ref);
      // Independiente por cobrador: al cambiar, inicio en ficha (salvo deep-link a actividad).
      const nextTab =
        switchingCollector && tab !== "actividad" ? "ficha" : (tab as CollectorTab);
      setCollectorTab(nextTab);
      if (user.collectorRef !== linkedCollector.ref) {
        setUsers((current) =>
          current.map((row) =>
            row.ref === user!.ref ? { ...row, collectorRef: linkedCollector.ref } : row,
          ),
        );
      }
    } else {
      setOpenCollectorRef("");
      setUserTab(tab === "acceso" ? "acceso" : "ficha");
    }
    setConfirmUserDelete(false);
    onGo("inicio", "ficha-usuario");
  }

  function openUserByCollector(collectorRef: string, tab: CollectorTab = "ficha") {
    const linked = userForCollector(collectorRef, users);
    if (linked) {
      openUserFicha(linked.ref, tab);
      return;
    }
    const collector = collectors.find((row) => row.ref === collectorRef);
    if (!collector) {
      onToast("Cobrador no encontrado.");
      return;
    }
    const switching = collectorRef !== openCollectorRef;
    setOpenUserRef("");
    setOpenCollectorRef(collectorRef);
    setCollectorTab(switching && tab !== "actividad" ? "ficha" : tab);
    onGo("inicio", "ficha-usuario");
  }

  function goUserTab(tab: UserTab) {
    setUserTab(tab);
    onGo("inicio", "ficha-usuario");
  }

  function goCollectorTab(tab: CollectorTab) {
    setCollectorTab(tab);
    onGo("inicio", "ficha-usuario");
  }

  function syncCollectorLinks(ref: string, name: string) {
    setRoutes((current) =>
      current.map((row) => (row.collectorRef === ref ? { ...row, collector: name } : row)),
    );
    setPayments((current) =>
      current.map((row) =>
        row.collectorRef === ref ? { ...row, collector: name, collectorRef: ref } : row,
      ),
    );
  }

  function openLoanMovement(ref: string) {
    setOpenLoanRef(ref);
    setLoanTab("pagos");
    setPayMode(null);
    onGo("prestamos", "cuenta");
  }

  function saveEdit(draft: ClientDraft) {
    if (!openClient) return;
    const approving = isPendingReview(openClient);
    const doc = draft.document.trim();
    const hasRealDoc = Boolean(doc) && !doc.toUpperCase().startsWith("S/");
    const hasContactOrPlace = Boolean(
      openClient.phone?.trim() ||
        draft.address.trim() ||
        draft.city.trim() ||
        draft.barrio.trim(),
    );
    const profileComplete = hasRealDoc && hasContactOrPlace;
    const updated: ClientRow = {
      ...openClient,
      name: draft.name,
      lastName: draft.lastName,
      nickname: draft.nickname,
      document: draft.document,
      city: draft.city,
      barrio: draft.barrio,
      email: draft.email,
      address: draft.address,
      notes: draft.notes,
      photo: draft.photo,
      profilePending: profileComplete ? false : openClient.profilePending,
      ...(approving
        ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
        : {}),
    };
    const nextClients = placeClientOnRoute(clients, updated, draft.route, draft.routeOrder);
    setClients(nextClients);
    const synced = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      loans,
      collectors,
      dailyAssignments,
      payments,
    );
    setRoutes(synced.routes);
    setDailyAssignments(synced.assignments);
    if (approving) {
      onGo("clientes", "listado");
      onToast(
        draft.route
          ? `Cliente aprobado en ruta ${draft.route} y cargado a la planilla.`
          : "Cliente aprobado y agregado al listado.",
      );
      return;
    }
    onGo("clientes", "ficha");
    onToast(
      updated.profilePending
        ? "Cliente actualizado. Aún faltan datos de ficha (alerta activa)."
        : "Cliente actualizado.",
    );
  }

  function saveNew(draft: ClientDraft) {
    const ref = nextClientCode(clients);
    const review = canApproveClient
      ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
      : { status: CLIENT_STATUS_REVIEW, kind: clientStatusKind(CLIENT_STATUS_REVIEW) };
    const row: ClientRow = {
      ref,
      alta: clientCreationDate(),
      name: draft.name,
      lastName: draft.lastName,
      nickname: draft.nickname,
      document: draft.document,
      city: draft.city,
      barrio: draft.barrio,
      route: review.status === CLIENT_STATUS_REVIEW ? "" : draft.route,
      routeOrder: review.status === CLIENT_STATUS_REVIEW ? 0 : draft.routeOrder,
      email: draft.email,
      phone: "",
      address: draft.address,
      notes: draft.notes,
      photo: draft.photo,
      total: 0,
      pending: 0,
      status: review.status,
      kind: review.kind,
      createdBy: sessionUser?.name,
    };
    const nextClients =
      review.status === CLIENT_STATUS_REVIEW
        ? [...clients, row]
        : placeClientOnRoute(clients, row, draft.route, draft.routeOrder);
    setClients(nextClients);
    setOpenRef(ref);
    setFileTab("ficha");
    if (review.status === CLIENT_STATUS_REVIEW) {
      onGo("clientes", "revision");
      onToast("Enviado a revisión. Aún no es cliente de ruta ni cobros.");
      return;
    }
    const synced = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      loans,
      collectors,
      dailyAssignments,
      payments,
    );
    setRoutes(synced.routes);
    setDailyAssignments(synced.assignments);
    onGo("clientes", "ficha");
    onToast(`Cliente creado en ruta ${draft.route}, posición ${draft.routeOrder}.`);
  }

  function startClientApproval(refs: string[]) {
    if (!refs.length) return;
    if (refs.length > 1) {
      onToast("Apruebe de a un cliente: complete la ficha y pulse Guardar.");
      return;
    }
    const ref = refs[0]!;
    setOpenRef(ref);
    onGo("clientes", "editar");
  }

  function rejectClients(refs: string[]) {
    const pending = new Set(refs);
    const remaining = clients.filter((row) => !pending.has(row.ref));
    setClients(remaining);
    setOpenRef(remaining[0]?.ref ?? "");
    onGo("clientes", "revision");
    onToast(
      refs.length === 1
        ? "Cliente rechazado y retirado de revisión."
        : `${refs.length} clientes rechazados.`,
    );
  }

  function deleteClient() {
    if (!openClient) return;
    if (loansForClient(openClient.ref, loans).length > 0) {
      setConfirmDelete(false);
      onToast("No se puede eliminar: el cliente tiene préstamos.");
      return;
    }
    const remaining = clients.filter((row) => row.ref !== openClient.ref);
    setClients(remaining);
    setOpenRef(remaining[0]?.ref ?? "");
    setConfirmDelete(false);
    onGo("clientes", "listado");
    onToast("Cliente eliminado del listado.");
  }

  function saveNewLoan(draft: LoanDraft) {
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) return;
    if (isPendingReview(client)) {
      onToast("No se puede prestar: el registro aún está en revisión.");
      return;
    }
    const ref = nextLoanCode(loans);
    const row = syncLoan(
      {
        ref,
        clientRef: client.ref,
        client: `${client.name} ${client.lastName}`.trim(),
        date: draft.date,
        due: draft.due,
        capital: draft.capital,
        paid: 0,
        balance: draft.total,
        status: "Activo",
        kind: "ok",
        notes: draft.notes,
        rate: draft.rate,
        frequency: draft.frequency,
        mode: draft.mode,
        pact: draft.pact,
        days: draft.days,
        interest: draft.interest,
        total: draft.total,
        installment: draft.installment,
        schedule: draft.schedule,
      },
      payments,
    ) as LoanRow;
    setLoans((current) => [row, ...current]);
    setClients((current) =>
      current.map((entry) =>
        entry.ref === client.ref
          ? { ...entry, total: entry.total + draft.total, pending: entry.pending + draft.total }
          : entry,
      ),
    );
    setOpenLoanRef(ref);
    setOpenRef(client.ref);
    setLoanTab("ficha");
    onGo("prestamos", "cuenta");
    onToast("Préstamo creado.");
  }

  function saveEditLoan(draft: LoanDraft) {
    if (!openLoan) return;
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) return;
    const oldTotal = openLoan.total ?? openLoan.capital;
    setLoans((current) =>
      current.map((row) =>
        row.ref === openLoan.ref
          ? (syncLoan(
              {
                ...row,
                clientRef: client.ref,
                client: `${client.name} ${client.lastName}`.trim(),
                date: draft.date,
                due: draft.due,
                capital: draft.capital,
                paid: row.paid,
                notes: draft.notes,
                rate: draft.rate,
                frequency: draft.frequency,
                mode: draft.mode,
                pact: draft.pact,
                days: draft.days,
                interest: draft.interest,
                total: draft.total,
                installment: draft.installment,
                schedule: draft.schedule,
                termsPending: false,
              },
              payments,
            ) as LoanRow)
          : row,
      ),
    );
    setClients((current) =>
      current.map((entry) =>
        entry.ref === client.ref
          ? {
              ...entry,
              total: Math.max(0, entry.total - oldTotal + draft.total),
              pending: Math.max(0, entry.pending - oldTotal + draft.total),
            }
          : entry,
      ),
    );
    onGo("prestamos", "cuenta");
    onToast(
      openLoan.termsPending
        ? "Préstamo actualizado. Ya no aparece en alertas de revisión."
        : "Préstamo actualizado.",
    );
  }

  function openRouteEdit(ref: string) {
    setOpenRouteRef(ref);
    setConfirmRouteDelete("");
    onGo("inicio", "editar-ruta");
  }

  function saveEditRoute(draft: RouteDraft) {
    if (!openRoute) return;
    const name = normalizeRouteNumber(draft.name);
    if (!name) {
      onToast("Indique un número de ruta válido.");
      return;
    }
    const previousName = openRoute.name;
    setRoutes((current) =>
      current.map((row) =>
        row.ref === openRoute.ref
          ? {
              ...row,
              id: routeSlug(name),
              name,
            }
          : row,
      ),
    );
    if (name !== previousName) {
      setClients((current) =>
        current.map((client) =>
          client.route === previousName ? { ...client, route: name } : client,
        ),
      );
    }
    onGo("inicio", "lista");
    onToast(`Ruta ${name} actualizada.`);
  }

  function toggleRouteActive(ref: string) {
    const route = catalogRouteList.find((row) => row.ref === ref);
    if (!route) return;
    const nextActive = !routeIsActive(route);
    const meta = routeStatusMeta(nextActive);
    setRoutes((current) =>
      current.map((row) => (row.ref === ref ? { ...row, ...meta } : row)),
    );
    onToast(nextActive ? `Ruta "${route.name}" activada.` : `Ruta "${route.name}" desactivada.`);
  }

  function deleteRoute(ref: string) {
    const route = catalogRouteList.find((row) => row.ref === ref);
    if (!route) return;
    const assigned = clientsOnRouteListed(route.name, clients).length;
    if (assigned > 0) {
      onToast(`No se puede eliminar: ${assigned} cliente(s) usan esta ruta.`);
      setConfirmRouteDelete("");
      return;
    }
    setRoutes((current) => current.filter((row) => row.ref !== ref));
    setConfirmRouteDelete("");
    onGo("inicio", "lista");
    onToast(`Ruta "${route.name}" eliminada.`);
  }

  function saveNewRoute(draft: RouteDraft) {
    const name = normalizeRouteNumber(draft.name);
    if (!name) {
      onToast("Indique un número de ruta válido.");
      return;
    }
    if (catalogRouteList.some((row) => row.name === name)) {
      onToast(`Ya existe la ruta ${name}. Asígnele cobrador o clientes a esa ruta.`);
      return;
    }
    const ref = nextRouteCode(catalogRouteList);
    const row: RouteRow = {
      ref,
      id: routeSlug(name),
      name,
      collectorRef: "",
      collector: "—",
      zone: "",
      frequency: "Lun–Sáb",
      notes: "",
      stops: [],
      clients: 0,
      status: "Activa",
      kind: "ok",
    };
    setRoutes((current) => [...current, row]);
    onGo("inicio", "lista");
    onToast(`Ruta ${name} creada. Asígnela a un cobrador para que aparezca en la app.`);
  }

  function assignRouteCollector(routeRef: string, collectorRef: string) {
    const collector = collectors.find((row) => row.ref === collectorRef);
    const nextRoutes = assignCollectorToCatalogRoute(
      routes,
      routeRef,
      collector?.ref ?? "",
      collector?.name ?? "",
    );
    const synced = syncPermanentRoutePlanilla(
      todayIso(),
      nextRoutes,
      clients,
      loans,
      collectors,
      dailyAssignments,
      payments,
    );
    setRoutes(synced.routes);
    setDailyAssignments(synced.assignments);
    const route = synced.routes.find((row) => row.ref === routeRef) ?? catalogRouteList.find((row) => row.ref === routeRef);
    onToast(
      collector
        ? `Ruta ${route?.name ?? ""} asignada a ${collector.name}. Ya aparece en supervisor y app.`
        : `Ruta ${route?.name ?? ""} sin cobrador.`,
    );
  }

  /** Planilla del día desde rutas fijas (cobrador permanente). */
  function syncDailyPlanillaFromRoutes(date: string, announce: boolean) {
    const synced = syncPermanentRoutePlanilla(
      date,
      routes,
      clients,
      loans,
      collectors,
      dailyAssignments,
      payments,
    );
    setRoutes(synced.routes);
    setDailyAssignments(synced.assignments);

    if (!announce) return;

    const blocked = planillaDayBlockedReason(date);
    if (blocked) {
      onToast(blocked);
      return;
    }

    const inApp = synced.assignments.filter(
      (row) => row.dispatchDate === date && row.dispatched,
    );
    if (!inApp.length) {
      onToast(
        "Sin planilla en app. Asigna cobrador a cada ruta en Inicio → Asignar cobrador (queda fijo).",
      );
      return;
    }

    const byCollector = new Map<string, number>();
    for (const row of inApp) {
      byCollector.set(row.collector, (byCollector.get(row.collector) ?? 0) + 1);
    }
    const summary = [...byCollector.entries()]
      .map(([name, count]) => `${name}: ${count}`)
      .join(" · ");
    onToast(`Planilla ${isoToDispatchLabel(date)} en app · ${summary}.`);
  }

  function generateDailyCollections(date: string) {
    syncDailyPlanillaFromRoutes(date, false);
  }

  function dispatchToCollectors(date: string) {
    if (date < todayIso()) {
      onToast("No se pueden actualizar planillas de días anteriores. Use hoy o una fecha futura.");
      return;
    }
    syncDailyPlanillaFromRoutes(date, true);
  }

  function closeDailyCollections(date: string) {
    const result = closeDispatchDay(
      dailyAssignments,
      routes,
      dailyLogs,
      date,
      collectors,
      loans,
      clients,
      undefined,
      payments,
    );
    if (!result.collectorsClosed) {
      onToast("No hay rutas enviadas para cerrar en esta fecha.");
      return;
    }
    setDailyAssignments(result.assignments);
    setRoutes(result.routes);
    setDailyLogs(result.logs);
    const alertResult = bumpMissedCollectionAlerts(loans, result.missedLoanRefs, date, payments);
    setLoans(alertResult.loans);
    const parts = [
      `${result.collectorsClosed} cobrador${result.collectorsClosed === 1 ? "" : "es"}`,
      formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora),
    ].filter(Boolean);
    onToast(`Día cerrado · ${parts.join(" · ")}.`);
  }

  function saveCollectorExpensesFromMobile(payload: CollectorSaveExpensesPayload) {
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

    const accounts = ensureBankAccounts(bankAccounts);
    if (!bankAccounts.length) setBankAccounts(accounts);
    setBankMovements((rows) =>
      applyBankLedgerSync(rows, {
        payments,
        accounts,
        miscPayments,
        dayExpenseDrafts: nextDrafts,
        dayCloses,
      }),
    );

    onToast(
      draft.expensesTotal > 0
        ? `Gastos guardados · ${money(draft.expensesTotal)} · en Registros`
        : "Gastos limpiados.",
    );
  }

  function closeCollectorMonthFromMobile(payload: CollectorCloseMonthPayload) {
    const record = buildMonthCloseRecord(payload);
    const next = [record, ...monthCloses.filter((row) => row.ref !== record.ref)];
    writeDemoJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, next);
    setMonthCloses(next);
    onToast(
      `Mes ${payload.period} guardado · saldo arrastrado ${money(record.closingSaldo)}. Empieza el mes nuevo.`,
    );
  }

  function closeCollectorDayFromMobile(payload: CollectorCloseDayPayload) {
    const lines = payload.expenses.filter((row) => row.amount > 0);
    const accounts = ensureBankAccounts(bankAccounts);
    if (!bankAccounts.length) setBankAccounts(accounts);

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

    setBankMovements((rows) =>
      applyBankLedgerSync(rows, {
        payments,
        accounts,
        miscPayments,
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

    const parts = [
      `caja menor ${money(record.cashFloat)}`,
      record.expensesTotal > 0 ? `gastos ${money(record.expensesTotal)} (Haber)` : null,
      formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora),
    ].filter(Boolean);
    onToast(`Día cerrado · ${parts.join(" · ")}.`);
  }

  function assignDailyCollectionHandler(
    itemId: string,
    loanRef: string,
    collectorRef: string,
    date: string,
  ) {
    const existing = dailyAssignments.find(
      (row) => row.itemId === itemId && row.dispatchDate === date,
    );
    if (existing) {
      onToast("Este cobro ya está asignado para este día.");
      return;
    }
    if (date < todayIso()) {
      onToast("Solo puedes asignar cobros desde hoy en adelante.");
      return;
    }
    const collector = collectors.find((row) => row.ref === collectorRef);
    if (!collector) {
      onToast("Cobrador no encontrado.");
      return;
    }
    const item = buildDailyCollectionList(loans, clients, date, payments).find((row) => row.id === itemId);
    if (!item || item.loanRef !== loanRef) {
      onToast("Cobro no encontrado en la lista del día.");
      return;
    }
    setDailyAssignments((current) => [...current, assignmentFromItem(item, collector, date)]);
    onToast(`Asignado a ${collector.name} · ${isoToDispatchLabel(date)}.`);
  }

  function registerCollectorPayment(draft: CollectorPaymentDraft) {
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
      onToast(committed.error);
      return false;
    }

    setPayments(committed.payments);
    setLoans(committed.loans);
    setClients(committed.clients);
    setDailyAssignments(committed.assignments);
    setRoutes(committed.routes);
    setBankMovements((rows) =>
      applyBankLedgerSync(rows, {
        payments: committed.payments,
        accounts: bankAccounts,
        miscPayments,
        dayExpenseDrafts,
        dayCloses,
      }),
    );
    const paidRoute =
      committed.routes.find((row) => row.ref === committed.payment.routeRef) ??
      committed.routes.find((row) =>
        row.ref.startsWith(`RUT-D-${draft.collectorRef}-`),
      );
    if (paidRoute) {
      setDailyLogs((current) => upsertDailyLogPayment(current, committed.payment, paidRoute));
    }
    onToast(`Cobro ${committed.payment.ref} sincronizado · Registros y planillas al día.`);
    return true;
  }

  function skipCollectorVisit(draft: CollectorSkipVisitDraft) {
    const nextAssignments = skipAssignmentVisit(dailyAssignments, {
      collectorRef: draft.collectorRef,
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
    onToast(
      draft.reason
        ? `Visita omitida · ${draft.reason}. Queda para reprogramar.`
        : "Visita omitida. Queda para reprogramar.",
    );
  }

  function renewLoan(loanRef: string) {
    const loan = loans.find((row) => row.ref === loanRef);
    if (!loan) {
      onToast("Préstamo no encontrado.");
      return;
    }
    const newRef = nextLoanCode(loans);
    const result = buildRenewalLoans(loan, newRef);
    if (!result) {
      onToast("La renovación se activa cuando se cumpla el plazo del préstamo.");
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
    onToast(
      `Nuevo préstamo ${newRef}: capital ${money(result.created.capital)} + 20% · total ${money(result.created.total ?? 0)} · 1 mes.`,
    );
  }

  function createStreetClientFromMobile(draft: {
    name: string;
    lastName?: string;
    phone?: string;
    routeOrder: number;
    routeName: string;
    routeRef: string;
  }) {
    const row = buildStreetClient(
      {
        name: draft.name,
        lastName: draft.lastName,
        phone: draft.phone,
        routeOrder: draft.routeOrder,
        routeName: draft.routeName,
        createdBy: sessionUser?.name ?? "Supervisor",
      },
      clients,
    );
    const nextClients = insertStreetClient(clients, row);
    setClients(nextClients);
    const planilla = syncPermanentRoutePlanilla(
      todayIso(),
      routes,
      nextClients,
      loans,
      collectors,
      dailyAssignments,
      payments,
    );
    setDailyAssignments(planilla.assignments);
    setRoutes(planilla.routes);
    onToast(
      `Cliente ${row.name} en ruta ${draft.routeName}, posición ${row.routeOrder}: listo para prestar.`,
    );
  }

  function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      onToast("Cliente no encontrado.");
      return;
    }
    const loan = buildQuickLoan(draft, client, loans);
    if (!loan) {
      onToast("Revise capital, interés, tiempo y frecuencia.");
      return;
    }
    const nextLoans = [loan, ...loans];
    const targetRoute = (draft.routeName ?? client.route).trim() || client.route;
    const nextClients = clients.map((entry) =>
      entry.ref === client.ref
        ? {
            ...entry,
            awaitingLoan: false,
            status: CLIENT_STATUS_ACTIVE,
            kind: clientStatusKind(CLIENT_STATUS_ACTIVE),
            route: targetRoute,
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
    onToast(`Préstamo ${loan.ref} creado · cuota ${money(loan.installment ?? 0)}.`);
  }

  function toggleCollectorActive() {
    const collectorRef = openUser?.collectorRef;
    if (!collectorRef) return;
    const collector = collectors.find((row) => row.ref === collectorRef);
    if (!collector) return;
    const nextActive = !collector.active;
    setCollectors((current) =>
      current.map((row) => (row.ref === collectorRef ? { ...row, active: nextActive } : row)),
    );
    if (openUser) {
      setUsers((current) =>
        current.map((row) => (row.ref === openUser.ref ? { ...row, active: nextActive } : row)),
      );
    }
    setConfirmUserDelete(false);
    onToast(nextActive ? "Cobrador activado." : "Cobrador desactivado.");
  }

  function deleteUser() {
    if (!openUser) return;
    const guard = userDeleteGuard(openUser, routes, payments, activities, collectors);
    if (!guard.canDelete) {
      onToast(guard.reason ?? "No se puede eliminar.");
      setConfirmUserDelete(false);
      return;
    }
    const deletedRef = openUser.ref;
    const collectorRef = openUser.collectorRef;
    const remaining = users.filter((row) => row.ref !== deletedRef);

    setUsers(remaining);
    if (collectorRef) {
      const nextCollectors = collectors.filter((row) => row.ref !== collectorRef);
      const nextRoutes = routes.map((route) =>
        route.collectorRef === collectorRef
          ? { ...route, collectorRef: "", collector: "—" }
          : route,
      );
      setCollectors(nextCollectors);
      const synced = syncPermanentRoutePlanilla(
        todayIso(),
        nextRoutes,
        clients,
        loans,
        nextCollectors,
        dailyAssignments,
      payments,
    );
      setRoutes(synced.routes);
      setDailyAssignments(synced.assignments);
    }
    setOpenUserRef(remaining[0]?.ref ?? "");
    setConfirmUserDelete(false);
    onGo("inicio", "listado");
    onToast("Usuario eliminado del listado.");
  }

  function saveNewUser(draft: UserDraft) {
    if (!draft.name || !draft.phone || !draft.email || !draft.login) return;
    if (users.some((row) => row.login.toLowerCase() === draft.login.toLowerCase())) {
      onToast("Ese usuario de acceso ya está en uso.");
      return;
    }
    if (
      users.some(
        (row) => row.email?.toLowerCase() === draft.email.toLowerCase(),
      )
    ) {
      onToast("Ese correo ya está registrado.");
      return;
    }
    const role = roleByRef(draft.roleRef, ROLES);
    if (!role) return;

    const userRef = nextUserCode(users);
    let collectorRef: string | undefined;

    if (draft.roleRef === COLLECTOR_ROLE_REF) {
      const cobRef = nextCollectorCode(collectors);
      collectorRef = cobRef;
      const collector: CollectorRow = {
        ref: cobRef,
        name: draft.name,
        zone: COLLECTOR_UNASSIGNED_ZONE,
        phone: draft.phone,
        document: draft.document || undefined,
        active: draft.active,
        userRef,
        login: draft.login,
        mobileAccess: true,
      };
      setCollectors((current) => [...current, collector]);
    }

    const userRow: UserRow = {
      ref: userRef,
      login: draft.login,
      email: draft.email,
      password: draft.password || DEMO_USER_PASSWORD,
      name: draft.name,
      phone: draft.phone,
      document: draft.document || undefined,
      roleRef: draft.roleRef,
      collectorRef,
      channels: [...role.channels],
      permissions: draft.permissions.length
        ? [...draft.permissions]
        : [...role.permissions],
      active: draft.active,
    };
    setUsers((current) => [...current, userRow]);
    onGo("inicio", "listado");
    onToast(
      collectorRef
        ? `Usuario ${userRef} creado. Acceso móvil = cobrador ${collectorRef}.`
        : `Usuario ${userRef} (${role.name}) creado.`,
    );
  }

  function convertUserToCollector(userRef: string) {
    const user = users.find((row) => row.ref === userRef);
    if (!user) return;
    if (user.roleRef === ADMIN_ROLE_REF) {
      onToast("El administrador no se asigna como cobrador.");
      return;
    }
    if (!user.active) {
      onToast("Activa el usuario antes de asignarlo como cobrador.");
      return;
    }

    const existing = collectorViewForUser(user, collectors);
    if (existing) {
      setUsers((current) =>
        current.map((row) =>
          row.ref === userRef
            ? {
                ...row,
                roleRef: COLLECTOR_ROLE_REF,
                collectorRef: existing.ref,
                channels: row.channels.includes("mobile")
                  ? row.channels
                  : [...row.channels, "mobile"],
              }
            : row,
        ),
      );
      onToast(`Cobrador ${existing.ref} vinculado a ${user.name}.`);
      openUserFicha(userRef);
      return;
    }

    const repaired = ensureCollectorsForUsers(
      users.map((row) =>
        row.ref === userRef
          ? {
              ...row,
              roleRef: COLLECTOR_ROLE_REF,
              channels: row.channels.includes("mobile")
                ? row.channels
                : [...row.channels, "mobile"],
              permissions: row.permissions?.length
                ? row.permissions
                : [...(roleByRef(COLLECTOR_ROLE_REF, ROLES)?.permissions ?? [])],
            }
          : row,
      ),
      collectors,
    );
    setUsers(repaired.users);
    setCollectors(repaired.collectors);
    const linked = repaired.users.find((row) => row.ref === userRef);
    onToast(
      linked?.collectorRef
        ? `${user.name} listo como cobrador ${linked.collectorRef}. Ya puede entrar al celular.`
        : `${user.name} preparado como cobrador.`,
    );
    openUserFicha(userRef);
  }

  function saveEditUser(draft: UserEditDraft) {
    if (!openUser) return;
    if (users.some((row) => row.login.toLowerCase() === draft.login.toLowerCase() && row.ref !== openUser.ref)) {
      onToast("Ese usuario de acceso ya está en uso.");
      return;
    }
    if (
      users.some(
        (row) =>
          row.email?.toLowerCase() === draft.email.toLowerCase() && row.ref !== openUser.ref,
      )
    ) {
      onToast("Ese correo ya está registrado.");
      return;
    }
    const role = roleByRef(draft.roleRef, ROLES);
    if (!role) return;

    setUsers((current) =>
      current.map((row) =>
        row.ref === openUser.ref
          ? {
              ...row,
              name: draft.name,
              login: draft.login,
              email: draft.email,
              password: draft.password?.trim() ? draft.password.trim() : row.password,
              phone: draft.phone,
              document: draft.document || undefined,
              roleRef: draft.roleRef,
              active: draft.active,
              channels: [...role.channels],
              permissions: draft.permissions.length
                ? [...draft.permissions]
                : [...role.permissions],
            }
          : row,
      ),
    );

    if (openUser.collectorRef) {
      setCollectors((current) =>
        current.map((row) =>
          row.ref === openUser.collectorRef
            ? {
                ...row,
                name: draft.name,
                phone: draft.phone,
                document: draft.document || undefined,
                login: draft.login,
                active: draft.active,
                notes: draft.collectorNotes || undefined,
                mobileAccess: true,
              }
            : row,
        ),
      );
      syncCollectorLinks(openUser.collectorRef, draft.name);
    }

    onGo("inicio", "ficha-usuario");
    onToast("Usuario actualizado.");
  }

  function toggleUserActive() {
    if (!openUser) return;
    const nextActive = !openUser.active;
    setUsers((current) =>
      current.map((row) => (row.ref === openUser.ref ? { ...row, active: nextActive } : row)),
    );
    if (openUser.collectorRef) {
      setCollectors((current) =>
        current.map((row) =>
          row.ref === openUser.collectorRef ? { ...row, active: nextActive } : row,
        ),
      );
    }
    onToast(nextActive ? "Usuario activado." : "Usuario desactivado.");
  }

  function saveUserPermissions(userRef: string, permissions: string[]) {
    setUsers((current) =>
      current.map((row) => (row.ref === userRef ? { ...row, permissions: [...permissions] } : row)),
    );
    onToast("Permisos actualizados según la confianza asignada.");
  }

  function deleteLoan() {
    if (!openLoan) return;
    const removed = openLoan;
    const delta = removed.total ?? removed.capital;
    setLoans((current) => current.filter((row) => row.ref !== removed.ref));
    setClients((current) =>
      current.map((entry) =>
        entry.ref === removed.clientRef
          ? {
              ...entry,
              total: Math.max(0, entry.total - delta),
              pending: Math.max(0, entry.pending - delta),
            }
          : entry,
      ),
    );
    setConfirmLoanDelete(false);
    setOpenLoanRef((current) => (current === removed.ref ? "" : current));
    onGo("prestamos", "listado");
    onToast("Préstamo eliminado.");
  }

  function registerPay(kind: PayKind, amount: number, method: PaymentMethod = "efectivo") {
    if (!openLoan) return;
    const result = applyPay(openLoan, kind, amount);
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    const target = cuotaTarget(openLoan);
    const paidTime = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const paidDay = todayIso();
    const row = buildPaymentRow(
      {
        ref: nextPaymentCode(payments),
        loanRef: openLoan.ref,
        when: `${isoToDispatchLabel(paidDay)} · ${paidTime}`,
        paidDate: paidDay,
        paidTime,
        dueDate: target?.date,
        chargeLabel: target?.kind ? chargeLabel(target.kind) : result.type,
        client: openLoan.client,
        collector: "Caja / oficina",
        amount,
        type: result.type,
        kind: paymentRowKind(result),
        method: normalizePaymentMethod(method),
        source: "caja",
      },
      openLoan,
      result,
    );
    setPayments((current) => {
      const nextPayments = [row, ...current];
      setLoans((rows) =>
        rows.map((loan) =>
          loan.ref === openLoan!.ref ? loanRowAfterPay(loan, result, nextPayments) : loan,
        ),
      );
      return nextPayments;
    });
    setClients((current) =>
      current.map((entry) =>
        entry.ref === openLoan.clientRef
          ? { ...entry, pending: Math.max(0, entry.pending - amount) }
          : entry,
      ),
    );
    setPayMode(null);
    onToast(result.message);
  }

  function selectClientLoan(ref: string) {
    setOpenLoanRef(ref);
    setLoanTab("ficha");
    setPayMode(null);
  }

  function goLoanTab(id: LoanTab) {
    setLoanTab(id);
    if (id !== "pagos") setPayMode(null);
  }

  function startPay(kind: PayKind) {
    setLoanTab("pagos");
    setPayMode(kind);
  }

  if (!viewAllowed) {
    return (
      <AccessDenied
        detail="Tu rol no incluye permiso para esta pantalla."
        onBack={() => onGo("inicio", "resumen")}
      />
    );
  }

  return (
    <>
      {!shouldHideCrumb(moduleId, viewId) ? (
        <div className="crumb">{viewLabel}</div>
      ) : null}
      {renderView()}
    </>
  );

  function renderView() {
    if (key === "inicio:resumen" || key === "inicio:hoy" || key === "inicio:ruta-clientes") {
      return (
        <HomeDashboard
          clients={clients}
          routes={routes}
          loans={loans}
          payments={payments}
          collectors={collectors}
          activities={activities}
          assignments={dailyAssignments}
          onRenewLoan={renewLoan}
          onOpenLoan={openLoanAccount}
          onOpenClient={openFicha}
          onGo={onGo}
          onOpenPayment={(ref) =>
            openPaymentFicha(ref, "pagos", { moduleId: "inicio", viewId: "resumen" })
          }
        />
      );
    }

    if (key === "inicio:alertas") {
      const alerts = buildAlerts(pendingReviewClients(clients).length, loans, clients, payments);
      return (
        <section className="panel">
          <div className="head">
            <h1>Alertas</h1>
            <span className="count">{alerts.length}</span>
          </div>
          <div className="table-wrap">
            <table className="data alerts-table">
              <colgroup>
                <col className="alerts-col-when" />
                <col className="alerts-col-message" />
                <col className="alerts-col-type" />
                <col className="alerts-col-action" />
              </colgroup>
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Alerta</th>
                  <th>Tipo</th>
                  <th className="right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td className="alerts-when">{alert.when}</td>
                    <td className="alerts-message">{alert.message}</td>
                    <td>
                      <Pill label={alert.pill} kind={alert.kind} />
                    </td>
                    <td className="right">
                      <button
                        type="button"
                        className="btn-bar ev-go"
                        onClick={() => onGo(alert.module, alert.view)}
                      >
                        Ir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }

    if (
      moduleId === "clientes" &&
      ["listado", "revision", "activos", "inactivos"].includes(viewId)
    ) {
      const titles: Record<string, string> = {
        listado: "Clientes",
        revision: "Pendientes de revisión",
        activos: "Clientes activos",
        inactivos: "Clientes cerrados",
      };
      const rows = clientsForView(viewId, clients);
      return (
        <ClientList
          title={titles[viewId]}
          count={rows.length}
          rows={rows}
          variant={viewId === "revision" ? "revision" : "default"}
          clientView={viewId as "listado" | "revision" | "activos" | "inactivos"}
          canApprove={viewId === "revision" ? canApproveClient : false}
          onCreate={() => onGo("clientes", "nuevo")}
          onOpen={openFicha}
          onApprove={viewId === "revision" ? startClientApproval : undefined}
          onReject={viewId === "revision" ? rejectClients : undefined}
        />
      );
    }

    if (key === "clientes:nuevo") {
      return (
        <section className="panel">
          <div className="head">
            <h1>Nuevo cliente</h1>
          </div>
          <NewClientForm
            code={nextClientCode(clients)}
            routes={activeCatalogRoutes}
            clients={clients}
            onCancel={() => onGo("clientes", "listado")}
            onSave={saveNew}
          />
        </section>
      );
    }

    if (key === "clientes:editar") {
      if (!openClient) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Modificar cliente</h1>
            </div>
            <p className="ficha-empty">No hay un cliente seleccionado.</p>
          </section>
        );
      }
      return (
        <section className="panel">
          <div className="head">
            <h1>Modificar cliente</h1>
          </div>
          <NewClientForm
            client={openClient}
            routes={activeCatalogRoutes}
            clients={clients}
            onCancel={() =>
              onGo("clientes", isPendingReview(openClient) ? "revision" : "ficha")
            }
            onSave={saveEdit}
          />
        </section>
      );
    }

    if (key === "clientes:ficha") {
      if (!openClient) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Ficha</h1>
            </div>
            <p className="ficha-empty">No hay un cliente seleccionado.</p>
          </section>
        );
      }
      const fileTabs: { id: FileTab; label: string }[] = [
        { id: "ficha", label: "Ficha" },
        { id: "activos", label: "Préstamos activos" },
        { id: "prestamos", label: "Historial de préstamos" },
        { id: "evidencias", label: "Evidencias" },
      ];
      const fileTitle = fileTabs.find((tab) => tab.id === fileTab)?.label ?? "Ficha";
      const initials = `${openClient.name.charAt(0)}${openClient.lastName.charAt(0)}`.toUpperCase();
      const address = [openClient.address, openClient.city].filter(Boolean).join(", ");
      const clientLoans = loansForClient(openClient.ref, loans);
      const hasActiveLoans = activeLoans(clientLoans).length > 0;
      const hasLoanHistory = clientLoans.length > 0;
      const canDelete = !hasActiveLoans && !hasLoanHistory;
      const pendingReview = isPendingReview(openClient);
      return (
        <section className="panel">
          <nav className="tabs">
            {fileTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={fileTab === tab.id ? "tab on" : "tab"}
                onClick={() => goFileTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="file-title">
            <h1>{fileTitle}</h1>
          </div>
          <div className="ficha">
            <aside className="ficha-side">
              <div className="photo">
                {openClient.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={openClient.photo} alt={`${openClient.name} ${openClient.lastName}`} />
                ) : (
                  initials
                )}
              </div>
              <h2>
                {openClient.name} {openClient.lastName}
              </h2>
              <p>
                {pendingReview ? "Pte. revisión" : "Cliente activo"} · desde {openClient.alta}
              </p>
              <div className="meta">
                <div>
                  <span>Teléfono</span>
                  {openClient.phone || "—"}
                </div>
                <div>
                  <span>Dirección</span>
                  {address || "—"}
                </div>
              </div>
            </aside>
            <div className="ficha-main">
              {fileTab === "ficha" ? (
                <>
                  <div className="file-toolbar">
                    <div className="file-toolbar-actions">
                      {confirmDelete ? (
                        <>
                          <p className="ficha-warn">¿Eliminar este cliente? Saldrá del listado.</p>
                          <button type="button" className="btn-bar" onClick={() => setConfirmDelete(false)}>
                            Cancelar
                          </button>
                          <button type="button" className="btn-bar" onClick={deleteClient}>
                            Sí, eliminar
                          </button>
                        </>
                      ) : pendingReview && canApproveClient ? (
                        <>
                          <button type="button" className="btn-bar" onClick={() => startClientApproval([openClient.ref])}>
                            Aprobar
                          </button>
                          <button type="button" className="btn-bar" onClick={() => rejectClients([openClient.ref])}>
                            Rechazar
                          </button>
                          <button type="button" className="btn-bar" onClick={() => onGo("clientes", "editar")}>
                            Modificar
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="btn-bar" onClick={() => onGo("clientes", "editar")}>
                            Modificar
                          </button>
                          <button
                            type="button"
                            className="btn-bar"
                            disabled={!canDelete || pendingReview}
                            onClick={() => canDelete && !pendingReview && setConfirmDelete(true)}
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <ClientDetailTable client={openClient} />
                  {pendingReview ? (
                    <p className="route-gps-note">
                      Este cliente espera aprobación de un administrador o supervisor antes de entrar al
                      listado general.
                    </p>
                  ) : null}
                </>
              ) : null}
              {fileTab === "activos" ? (
                <LoanFichaGrid
                  loans={activeLoans(clientLoans)}
                  payments={payments}
                  onSelect={openLoanAccount}
                />
              ) : null}
              {fileTab === "prestamos" ? (
                <LoanFichaGrid
                  loans={clientLoans}
                  payments={payments}
                  onSelect={openLoanAccount}
                />
              ) : null}
              {fileTab === "evidencias" ? (
                <p className="ficha-empty">Las evidencias de campo de este cliente se verán aquí.</p>
              ) : null}
            </div>
          </div>
        </section>
      );
    }

    if (key === "prestamos:nuevo") {
      return (
        <section className="panel">
          <NewLoanForm
            clients={clients}
            loanCode={nextLoanCode(loans)}
            onCancel={() => onGo("prestamos", "listado")}
            onSave={saveNewLoan}
          />
        </section>
      );
    }

    if (key === "prestamos:informe") {
      if (!openLoan) {
        return (
          <section className="panel">
            <p className="ficha-empty">No hay un préstamo seleccionado.</p>
          </section>
        );
      }
      const loanClient = clients.find((row) => row.ref === openLoan.clientRef) ?? null;
      return (
        <section className="panel">
          <LoanReportView
            key={openLoan.ref}
            loan={openLoan}
            client={loanClient}
            payments={payments}
            assignments={dailyAssignments}
            onBack={() => onGo("prestamos", "cuenta")}
          />
        </section>
      );
    }

    if (key === "prestamos:editar") {
      if (!openLoan) {
        return (
          <section className="panel">
            <p className="ficha-empty">No hay un préstamo seleccionado.</p>
          </section>
        );
      }
      return (
        <section className="panel">
          <NewLoanForm
            key={openLoan.ref}
            clients={clients}
            loan={openLoan}
            onCancel={() => onGo("prestamos", "cuenta")}
            onSave={saveEditLoan}
            onDelete={deleteLoan}
          />
        </section>
      );
    }

    if (moduleId === "prestamos" && viewId === "cuenta") {
      const loanPays = openLoan
        ? sortPaymentsNewestFirst(payments.filter((row) => row.loanRef === openLoan.ref))
        : [];
      const loanFinancials = openLoan ? computeLoanFinancials(openLoan, payments) : null;
      const paySummary = loanFinancials ? loanPaySummaryRows(loanFinancials, money) : [];
      const loanClient = openLoan ? clients.find((row) => row.ref === openLoan.clientRef) : null;
      const loanInitials = loanClient
        ? `${loanClient.name.charAt(0)}${loanClient.lastName.charAt(0)}`.toUpperCase()
        : "";
      const loanAddress = loanClient
        ? [loanClient.address, loanClient.barrio, loanClient.city].filter(Boolean).join(", ")
        : "";
      const clientLoans = loanClient ? loansForClient(loanClient.ref, loans) : [];
      const canPay = Boolean(openLoan && openLoan.balance > 0 && openLoan.status !== "Finalizado");
      const canPayCuota = Boolean(canPay && openLoan && cuotaTarget(openLoan));
      const loanTabs: { id: LoanTab; label: string }[] = [
        { id: "ficha", label: "Ficha" },
        { id: "prestamos", label: "Préstamos" },
        { id: "pagos", label: "Pagos" },
      ];
      const loanTitle = loanTabs.find((tab) => tab.id === loanTab)?.label ?? "Ficha";
      return (
        <section className="panel">
          <nav className="tabs">
            {loanTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={loanTab === tab.id ? "tab on" : "tab"}
                onClick={() => goLoanTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="file-title">
            <h1>{loanTitle}</h1>
            {openLoan ? (() => {
              const status = loanStatusPill(openLoan);
              return <Pill label={status.label} kind={status.kind} />;
            })() : null}
            {openLoan && loanTab === "pagos" ? (
              <span className="file-title-ref ref">{openLoan.ref}</span>
            ) : null}
            {openLoan && loanTab !== "prestamos" ? (
              <div className="file-toolbar-actions">
                {confirmLoanDelete ? (
                  <>
                    <p className="ficha-warn">¿Eliminar este préstamo? Saldrá del listado.</p>
                    <button type="button" className="btn-bar" onClick={() => setConfirmLoanDelete(false)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn-bar" onClick={deleteLoan}>
                      Sí, eliminar
                    </button>
                  </>
                ) : (
                  <>
                    {canPay && loanTab === "pagos" ? (
                      <>
                        <button
                          type="button"
                          className="btn-bar"
                          disabled={!canPayCuota}
                          onClick={() => startPay("cuota")}
                        >
                          Pagar cuota
                        </button>
                        <button type="button" className="btn-bar" onClick={() => startPay("abono")}>
                          Abono
                        </button>
                      </>
                    ) : null}
                    {loanTab !== "pagos" ? (
                      <button type="button" className="btn-bar" onClick={() => onGo("prestamos", "informe")}>
                        Ver informe
                      </button>
                    ) : null}
                    {loanTab !== "pagos" ? (
                      <button type="button" className="btn-bar" onClick={() => onGo("prestamos", "editar")}>
                        Modificar
                      </button>
                    ) : null}
                    {loanTab !== "pagos" ? (
                      <button type="button" className="btn-bar" onClick={() => setConfirmLoanDelete(true)}>
                        Borrar
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="ficha">
            <aside className="ficha-side">
              {loanClient ? (
                <>
                  <div className="photo">
                    {loanClient.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={loanClient.photo} alt={`${loanClient.name} ${loanClient.lastName}`} />
                    ) : (
                      loanInitials
                    )}
                  </div>
                  <h2>
                    {loanClient.name} {loanClient.lastName}
                  </h2>
                  <p>{loanClient.ref}</p>
                  <div className="meta">
                    <div>
                      <span>Documento</span>
                      {loanClient.document || "—"}
                    </div>
                    <div>
                      <span>Teléfono</span>
                      {loanClient.phone || "—"}
                    </div>
                    <div>
                      <span>Dirección</span>
                      {loanAddress || "—"}
                    </div>
                    <div>
                      <span>Ruta</span>
                      {loanClient.route || "—"}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h2>{openLoan?.client ?? "Cliente"}</h2>
                  <p>{openLoan?.clientRef ?? ""}</p>
                </>
              )}
            </aside>
            <div className="ficha-main">
              {openLoan && payMode && loanTab === "pagos" ? (
                <LoanPayForm
                  key={payMode}
                  loan={openLoan}
                  mode={payMode}
                  onCancel={() => setPayMode(null)}
                  onRegister={(amount, payMethod) => registerPay(payMode, amount, payMethod)}
                />
              ) : null}

              {loanTab === "ficha" && openLoan ? (
                <LoanDetailView loan={openLoan} payments={payments} />
              ) : null}

              {loanTab === "prestamos" ? (
                <LoanFichaGrid
                  loans={clientLoans}
                  payments={payments}
                  selectedRef={openLoan?.ref}
                  onSelect={selectClientLoan}
                />
              ) : null}

              {loanTab === "pagos" ? (
                <LoanPaymentsTable
                  payments={loanPays}
                  loan={openLoan}
                  assignments={dailyAssignments}
                  onOpenPayment={openPaymentFicha}
                  footer={openLoan ? paySummary : undefined}
                />
              ) : null}
            </div>
          </div>
        </section>
      );
    }

    if (moduleId === "prestamos") {
      const baseRows =
        viewId === "activos"
          ? loans.filter((row) => row.status !== "Finalizado")
          : viewId === "finalizados"
            ? loans.filter((row) => row.status === "Finalizado")
            : loans;
      const rows = baseRows.filter(loanMatchesListFilters);
      return (
        <DataTable
          title={viewLabel}
          count={rows.length}
          fixedColumns
          filterOptions={listFilterOptions}
          toolbarEnd={
            <ColumnPicker
              columns={PRESTAMO_LIST_COLUMNS}
              visibleCols={prestamoListColumns.visibleCols}
              onToggle={prestamoListColumns.toggleColumn}
            />
          }
          headers={[
            { t: "Ref", width: "9%" },
            { t: "Cliente", width: "22%" },
            { t: "Desembolso", width: "12%" },
            { t: "Capital", right: true, width: "13%" },
            { t: "Valor cuota", right: true, width: "13%" },
            { t: "Saldo", right: true, width: "13%" },
            { t: "Estado", center: true, width: "14%" },
          ].filter((_, index) => prestamoListColumns.isVisible(PRESTAMO_LIST_COLUMNS[index]!.id))}
          onCreate={() => onGo("prestamos", "nuevo")}
        >
          {rows.map((row) => {
            const synced = syncLoan(row, payments) as LoanRow;
            const status = loanStatusPill(synced);
            const financials = computeLoanFinancials(synced, payments);
            const balance = financials.balancePending;
            const installment = financials.installment;
            return (
            <tr key={row.ref} onClick={() => openLoanAccount(row.ref)}>
              {prestamoListColumns.isVisible("ref") ? <td className="ref">{row.ref}</td> : null}
              {prestamoListColumns.isVisible("client") ? <td>{row.client}</td> : null}
              {prestamoListColumns.isVisible("date") ? <td>{row.date}</td> : null}
              {prestamoListColumns.isVisible("capital") ? (
                <td className="money right">{money(row.capital)}</td>
              ) : null}
              {prestamoListColumns.isVisible("installment") ? (
                <td className="money right">{installment > 0 ? money(installment) : "—"}</td>
              ) : null}
              {prestamoListColumns.isVisible("balance") ? (
                <td className="money right">{money(balance)}</td>
              ) : null}
              {prestamoListColumns.isVisible("status") ? (
                <td className="center">
                  <Pill label={status.label} kind={status.kind} />
                </td>
              ) : null}
              <ColumnPickerBodyCell />
            </tr>
            );
          })}
        </DataTable>
      );
    }

    if (moduleId === "cartera") {
      if (viewId === "cobrador") {
        return (
          <ComingSoonPanel
            title="Cartera por cobrador"
            purpose="Vista operativa: saldos y exposición agrupados por cobrador asignado, para supervisar en el día a día."
            later="No es el informe imprimible de Reportes. Aquí se abrirá el detalle vivo; el informe formal con exportación irá en Reportes → Por cobrador."
            tableColumns={CARTERA_POR_COBRADOR_COLUMNS}
            tableTitle="Por cobrador"
          />
        );
      }
      if (viewId === "ruta") {
        return (
          <ComingSoonPanel
            title="Cartera por ruta"
            purpose="Vista operativa: saldos y clientes pendientes agrupados por ruta o zona."
            later="Se activará cuando las rutas y asignaciones diarias estén conectadas al backend."
            tableColumns={CARTERA_POR_RUTA_COLUMNS}
            tableTitle="Por ruta"
          />
        );
      }

      const carteraViewId = viewId === "mora" ? "mora" : "resumen";
      return (
        <CarteraView
          viewId={carteraViewId}
          loans={loans}
          payments={payments}
          clients={clients}
          onOpenClient={openFicha}
          onOpenLoan={openLoanAccount}
          onGo={onGo}
        />
      );
    }

    if (moduleId === "cobranza" && viewId === "hoy") {
      return (
        <DailyCollectionsView
          loans={loans}
          payments={payments}
          clients={clients}
          collectors={collectors}
          routes={routes}
          assignments={dailyAssignments}
          onGenerate={generateDailyCollections}
          onDispatch={dispatchToCollectors}
          onCloseDay={closeDailyCollections}
          onAssignItem={assignDailyCollectionHandler}
          onOpenClient={openFicha}
          onOpenLoan={openLoanAccount}
          onOpenMobile={(collectorRef) => {
            if (collectorRef) setMobilePreviewCollectorRef(collectorRef);
            onGo("inicio", "vista-movil");
          }}
          onToast={onToast}
          onGo={onGo}
        />
      );
    }

    if (moduleId === "cobranza" && viewId === "ficha-pago") {
      const payment = payments.find((row) => row.ref === openPaymentRef) ?? null;
      if (!payment) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Ficha de pago</h1>
            </div>
            <p className="ficha-empty">No hay un pago seleccionado.</p>
            <button type="button" className="btn secondary" onClick={() => {
              if (paymentFichaReturn) {
                onGo(paymentFichaReturn.moduleId, paymentFichaReturn.viewId);
                setPaymentFichaReturn(null);
                return;
              }
              onGo("cobranza", paymentReturnView);
            }}>
              Volver al listado
            </button>
          </section>
        );
      }

      const loan = loans.find((row) => row.ref === payment.loanRef) ?? null;
      const movement = enrichPaymentMovement(payment, loan, dailyAssignments);
      const route = payment.routeRef
        ? routes.find((row) => row.ref === payment.routeRef) ?? null
        : null;
      const clientRef =
        loan?.clientRef ??
        clients.find((row) => `${row.name} ${row.lastName}` === payment.client)?.ref;

      return (
        <PaymentFicha
          payment={payment}
          movement={movement}
          loan={loan}
          route={route}
          clientRef={clientRef}
          onOpenClient={openFicha}
          onOpenLoan={openLoanAccount}
        />
      );
    }

    if (moduleId === "cobranza" && viewId === "anulaciones") {
      return (
        <ComingSoonPanel
          title="Anulaciones"
          purpose="Registro de pagos anulados: quién anuló, motivo, fecha y el pago original."
          later="Requiere permisos de anulación y auditoría en el backend. Hoy no se anulan pagos en la demo."
        />
      );
    }

    if (moduleId === "cobranza" && (viewId === "pagos" || viewId === "abonos")) {
      const collectorNames = [...new Set(collectors.map((row) => row.name))].sort((a, b) =>
        a.localeCompare(b, "es"),
      );
      const today = todayIso();
      const pagosTodayRange =
        cobranzaPagosToday && viewId === "pagos"
          ? { fromIso: today, toIso: today }
          : undefined;
      return (
        <CobranzaPaymentsView
          key={pagosTodayRange ? `pagos-today-${today}` : `pagos-${viewId}`}
          kind={viewId === "abonos" ? "abonos" : "pagos"}
          payments={payments}
          loans={loans}
          clients={clients}
          routes={routes}
          collectors={collectorNames}
          assignments={dailyAssignments}
          initialRange={pagosTodayRange}
          onOpenPayment={(ref) =>
            openPaymentFicha(ref, viewId === "abonos" ? "abonos" : "pagos")
          }
        />
      );
    }

    if (moduleId === "inicio" && viewId === "editar-ruta") {
      if (!openRoute) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Modificar ruta</h1>
            </div>
            <p className="ficha-empty">No hay una ruta seleccionada.</p>
          </section>
        );
      }
      return (
        <section className="panel">
          <NewRouteForm
            route={openRoute}
            existingRoutes={catalogRouteList}
            onCancel={() => onGo("inicio", "lista")}
            onSave={saveEditRoute}
          />
        </section>
      );
    }

    if (moduleId === "inicio" && viewId === "nueva-ruta") {
      return (
        <section className="panel">
          <NewRouteForm
            existingRoutes={catalogRouteList}
            onCancel={() => onGo("inicio", "lista")}
            onSave={saveNewRoute}
          />
        </section>
      );
    }

    if (moduleId === "inicio" && viewId === "lista") {
      const routeRows = catalogRouteList.filter(routeMatchesListFilters);
      return (
        <DataTable
          title="Lista de rutas"
          count={routeRows.length}
          filterOptions={listFilterOptions}
          headers={[
            { t: "Código" },
            { t: "Ruta" },
            { t: "Cobrador" },
            { t: "Clientes" },
            { t: "Estado" },
            { t: "Acciones" },
          ]}
          onCreate={() => onGo("inicio", "nueva-ruta")}
        >
          {routeRows.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={6}>Aún no hay rutas creadas.</td>
            </tr>
          ) : (
            routeRows.map((row) => {
              const clientCount = clientsOnRouteListed(row.name, clients).length;
              const active = routeIsActive(row);
              const deleting = confirmRouteDelete === row.ref;
              return (
                <tr key={row.ref}>
                  <td className="ref">{row.ref}</td>
                  <td>{row.name}</td>
                  <td>{row.collectorRef ? row.collector : "Sin asignar"}</td>
                  <td>{clientCount}</td>
                  <td>
                    <Pill label={active ? "Activa" : "Inactiva"} kind={active ? "ok" : "draft"} />
                  </td>
                  <td className="row-actions">
                    <button type="button" className="btn-link" onClick={() => openRouteEdit(row.ref)}>
                      Modificar
                    </button>
                    <button type="button" className="btn-link" onClick={() => toggleRouteActive(row.ref)}>
                      {active ? "Desactivar" : "Activar"}
                    </button>
                    {deleting ? (
                      <span className="row-actions-confirm">
                        <span>¿Eliminar?</span>
                        <button type="button" className="btn-link danger" onClick={() => deleteRoute(row.ref)}>
                          Sí
                        </button>
                        <button type="button" className="btn-link" onClick={() => setConfirmRouteDelete("")}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-link danger"
                        onClick={() => setConfirmRouteDelete(row.ref)}
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </DataTable>
      );
    }

    if (moduleId === "inicio" && viewId === "asignar-clientes") {
      return (
        <AssignRouteCollectorView
          routes={routes}
          collectors={collectors}
          clients={clients}
          onAssign={assignRouteCollector}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "editar-usuario") {
      if (!openUser) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Modificar usuario</h1>
            </div>
            <p className="ficha-empty">No hay un usuario seleccionado.</p>
          </section>
        );
      }
      const linkedCollector = openUser ? collectorViewForUser(openUser, collectors) : null;
      return (
        <section className="panel">
          <EditUserForm
            user={openUser}
            collector={linkedCollector}
            roles={ASSIGNABLE_ROLES}
            onCancel={() => onGo("inicio", "ficha-usuario")}
            onSave={saveEditUser}
          />
        </section>
      );
    }

    if (moduleId === "inicio" && viewId === "ficha-usuario") {
      if (!openUser) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Ficha</h1>
            </div>
            <p className="ficha-empty">No hay un usuario seleccionado.</p>
          </section>
        );
      }
      if (openUser.collectorRef || openUser.roleRef === COLLECTOR_ROLE_REF) {
        const collector = collectorViewForUser(openUser, collectors);
        if (collector) {
          const linkedRole = roleByRef(openUser.roleRef, ROLES);
          return (
            <>
              <div className="collector-admin-toolbar">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setMobilePreviewCollectorRef(collector.ref);
                    onGo("inicio", "vista-movil");
                  }}
                >
                  Ver app móvil
                </button>
                <span className="collector-admin-toolbar-hint">
                  Misma pantalla que verá {openUser.name} en el celular
                </span>
              </div>
              <CollectorFicha
              key={openUser.ref}
              collector={collector}
              tab={collectorTab}
              routes={routes}
              clients={clients}
              loans={loans}
              payments={payments}
              activities={activities}
              dailyLogs={dailyLogs}
              dailyAssignments={dailyAssignments}
              dayCloses={dayCloses}
              dayExpenseDrafts={dayExpenseDrafts}
              monthCloses={monthCloses}
              collectors={collectors}
              user={openUser}
              role={linkedRole}
              confirmDelete={confirmUserDelete}
              onTab={goCollectorTab}
              onEdit={() => onGo("inicio", "editar-usuario")}
              onConfirmDelete={setConfirmUserDelete}
              onDelete={deleteUser}
              onToggleActive={toggleCollectorActive}
              onSavePermissions={(permissions) => saveUserPermissions(openUser.ref, permissions)}
              onRegisterCollectorPayment={registerCollectorPayment}
            />
            </>
        );
        }
        // Usuario cobrador sin fila de cobrador válida: no mostrar otro cobrador.
        const role = roleByRef(openUser.roleRef, ROLES);
        const deleteGuard = userDeleteGuard(openUser, routes, payments, activities, collectors);
        return (
          <UserFicha
            key={openUser.ref}
            user={openUser}
            role={role}
            tab={userTab}
            deleteGuard={deleteGuard}
            confirmDelete={confirmUserDelete}
            onTab={goUserTab}
            onEdit={() => onGo("inicio", "editar-usuario")}
            onToggleActive={toggleUserActive}
            onConfirmDelete={setConfirmUserDelete}
            onDelete={deleteUser}
            onConvertToCollector={
              openUser.active ? () => convertUserToCollector(openUser.ref) : undefined
            }
            onSavePermissions={(permissions) => saveUserPermissions(openUser.ref, permissions)}
          />
        );
      }
      const role = roleByRef(openUser.roleRef, ROLES);
      const deleteGuard = userDeleteGuard(openUser, routes, payments, activities, collectors);
      const canAssign =
        openUser.roleRef !== ADMIN_ROLE_REF && !openUser.collectorRef && openUser.active;
      return (
        <UserFicha
          user={openUser}
          role={role}
          tab={userTab}
          deleteGuard={deleteGuard}
          confirmDelete={confirmUserDelete}
          onTab={goUserTab}
          onEdit={() => onGo("inicio", "editar-usuario")}
          onToggleActive={toggleUserActive}
          onConfirmDelete={setConfirmUserDelete}
          onDelete={deleteUser}
          onConvertToCollector={canAssign ? () => convertUserToCollector(openUser.ref) : undefined}
          onSavePermissions={(permissions) => saveUserPermissions(openUser.ref, permissions)}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "zonas") {
      return (
        <CollectorZonesView
          collectors={collectors}
          routes={routes}
          payments={payments}
          clients={clients}
          assignments={dailyAssignments}
          onOpenCollector={(ref) => openUserByCollector(ref)}
          onAssignCollectors={() => onGo("inicio", "asignar-clientes")}
          onOpenRouteClients={() => onGo("inicio", "resumen")}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "actividad") {
      return (
        <CollectorActivityView
          collectors={collectors}
          payments={payments}
          activities={activities}
          onOpenCollector={(ref) => openUserByCollector(ref, "actividad")}
        />
      );
    }

    if (moduleId === "banco" && viewId === "extractos") {
      return (
        <BankExtractsListView
          accounts={bankAccounts}
          accountRef={bankAccountRef}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          onAccountChange={setBankAccountRef}
          onMovementsChange={setBankMovements}
          onReconciliationsChange={setBankReconciliations}
          onOpenExtract={(accountRef, period) => {
            setBankAccountRef(accountRef);
            setBankPeriod(period);
            onGo("banco", "extracto");
          }}
          onToast={onToast}
        />
      );
    }

    if (moduleId === "banco" && (viewId === "extracto" || viewId === "extracto-pendiente")) {
      return (
        <BankExtractView
          accounts={bankAccounts}
          accountRef={bankAccountRef}
          period={bankPeriod}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          payments={payments}
          miscPayments={miscPayments}
          onAccountChange={setBankAccountRef}
          onPeriodChange={setBankPeriod}
          onMovementsChange={setBankMovements}
          onReconciliationsChange={setBankReconciliations}
          onOpenMiscPayment={(ref) =>
            openMiscPaymentFicha(ref, { moduleId: "banco", viewId })
          }
          onOpenPaymentFicha={(ref) =>
            openPaymentFicha(ref, "pagos", { moduleId: "banco", viewId })
          }
          onOpenExpense={(row) => openExpenseFromMovement(row, { moduleId: "banco", viewId })}
          onToast={onToast}
          filterMode={viewId === "extracto-pendiente" ? "pending" : "all"}
        />
      );
    }

    if (moduleId === "banco" && viewId === "registros") {
      return (
        <BankRecordsHistoryView
          accounts={bankAccounts}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          initialAccountRef={bankRecordsAccountRef}
          onMovementsChange={setBankMovements}
          onReconciliationsChange={setBankReconciliations}
          onOpenPeriod={(accountRef, period) => {
            setBankAccountRef(accountRef);
            setBankPeriod(period);
            onGo("banco", "extracto");
          }}
          onOpenPaymentFicha={(ref) =>
            openPaymentFicha(ref, "pagos", { moduleId: "banco", viewId: "registros" })
          }
          onOpenExpense={(row) =>
            openExpenseFromMovement(row, { moduleId: "banco", viewId: "registros" })
          }
          onToast={onToast}
        />
      );
    }

    if (moduleId === "banco" && viewId === "listado") {
      return (
        <BankAccountListView
          accounts={bankAccounts}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          onNewAccount={() => onGo("banco", "nueva-cuenta")}
          onOpenPending={(accountRef, period) => {
            if (accountRef) setBankRecordsAccountRef(accountRef);
            if (accountRef) setBankAccountRef(accountRef);
            if (period) setBankPeriod(period);
            onGo("banco", "registros");
          }}
        />
      );
    }

    if (moduleId === "banco" && viewId === "nueva-cuenta") {
      return (
        <BankNewAccountForm
          accounts={bankAccounts}
          onSave={(account) => {
            setBankAccounts((rows) => [...rows, account]);
            setBankAccountRef(account.ref);
            onGo("banco", "listado");
          }}
          onCancel={() => onGo("banco", "listado")}
          onToast={onToast}
        />
      );
    }

    if (moduleId === "banco" && viewId === "informe-resultado") {
      return (
        <BankReportView
          movements={bankMovements}
          onOpenLedger={openBankLedgerFromReport}
        />
      );
    }

    if (moduleId === "banco" && viewId === "informe-ingresos") {
      return (
        <BankReconciledLedgerView
          key={bankLedgerPeriod ?? "all-ingresos"}
          kind="income"
          accounts={bankAccounts}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          initialPeriod={bankLedgerPeriod}
          onOpenPaymentFicha={(ref) =>
            openPaymentFicha(ref, "pagos", { moduleId: "banco", viewId: "informe-ingresos" })
          }
        />
      );
    }

    if (moduleId === "banco" && viewId === "informe-gastos") {
      return (
        <BankReconciledLedgerView
          key={bankLedgerPeriod ?? "all-gastos"}
          kind="expense"
          accounts={bankAccounts}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          initialPeriod={bankLedgerPeriod}
          onOpenExpense={(row) =>
            openExpenseFromMovement(row, { moduleId: "banco", viewId: "informe-gastos" })
          }
        />
      );
    }

    if (moduleId === "banco" && viewId === "registro-gasto") {
      const movement =
        bankMovements.find((row) => row.ref === openBankMovementRef) ?? null;
      if (!movement || !isBankExpenseMovement(movement)) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Registro bancario</h1>
            </div>
            <p className="ficha-empty">No hay un gasto bancario seleccionado.</p>
            <button type="button" className="btn secondary" onClick={returnFromBankExpensePanel}>
              Volver
            </button>
          </section>
        );
      }
      const miscPayment = findMiscPaymentForMovement(movement, miscPayments);
      return (
        <BankExpenseFicha
          movement={movement}
          accounts={bankAccounts}
          reconciliations={bankReconciliations}
          miscPayment={miscPayment}
          onSave={(updated) => {
            setBankMovements((rows) => rows.map((row) => (row.ref === updated.ref ? updated : row)));
          }}
          onOpenMiscPayment={(ref) =>
            openMiscPaymentFicha(ref, { moduleId: "banco", viewId: "registro-gasto" })
          }
          onToast={onToast}
          onBack={bankExpenseReturn ? returnFromBankExpensePanel : undefined}
        />
      );
    }

    if (moduleId === "reportes") {
      if (viewId === "diarios") {
        return (
          <CobranzaPaymentsView
            kind="pagos"
            payments={payments}
            loans={loans}
            clients={clients}
            routes={routes}
            collectors={[...new Set(collectors.map((row) => row.name))].sort((a, b) =>
              a.localeCompare(b, "es"),
            )}
            assignments={dailyAssignments}
            onOpenPayment={(ref) =>
              openPaymentFicha(ref, "pagos", { moduleId: "reportes", viewId: "diarios" })
            }
          />
        );
      }
      const reportCopy: Record<string, { purpose: string; later: string }> = {
        "por-cobrador": {
          purpose: "Informe de rendimiento y recaudo por cobrador en un rango de fechas.",
          later: "Distinto de Cartera → Por cobrador (vista operativa). Este es el reporte imprimible.",
        },
        cartera: {
          purpose: "Informe de cartera total: capital, saldos, activos y finalizados.",
          later: "Distinto del módulo Cartera (operación diaria). Aquí: snapshot exportable.",
        },
        mora: {
          purpose: "Informe de créditos en atraso con días de mora y saldos vencidos.",
          later: "Distinto de Cartera → Mora (lista operativa). Aquí: reporte formal con filtros.",
        },
      };
      const copy = reportCopy[viewId] ?? {
        purpose: "Informe reservado para la fase de reportes con PostgreSQL.",
        later: "Filtros de fecha, cobrador y ruta. Exportación a Excel/PDF.",
      };
      return (
        <ComingSoonPanel
          title={viewLabel}
          purpose={copy.purpose}
          later={copy.later}
          tableColumns={REPORTES_GENERIC_COLUMNS}
          tableTitle={viewLabel}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "nuevo-usuario") {
      return (
        <section className="panel">
          <NewUserForm
            roles={ASSIGNABLE_ROLES}
            onCancel={() => onGo("inicio", "listado")}
            onSave={saveNewUser}
          />
        </section>
      );
    }

    if (moduleId === "inicio" && viewId === "listado") {
      return (
        <UserList
          title="Listado"
          viewId="listado"
          users={users}
          roles={ASSIGNABLE_ROLES}
          variant="cobradores"
          onCreate={() => onGo("inicio", "nuevo-usuario")}
          onOpenUser={(ref) => openUserFicha(ref)}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "roles") {
      return <RolePanel roles={ROLES} />;
    }

    if (moduleId === "inicio" && viewId === "permisos") {
      return <PermissionsPanel />;
    }

    if (moduleId === "inicio" && viewId === "vista-movil") {
      return (
        <CollectorMobilePreview
          collectors={collectors}
          users={users}
          selectedRef={mobilePreviewCollectorRef}
          onSelect={setMobilePreviewCollectorRef}
          assignments={dailyAssignments}
          routes={routes}
          loans={loans}
          clients={clients}
          payments={payments}
          dayCloses={dayCloses}
          dayExpenseDrafts={dayExpenseDrafts}
          monthCloses={monthCloses}
          onRegisterPayment={registerCollectorPayment}
          onSkipVisit={skipCollectorVisit}
          onRenewLoan={renewLoan}
          onSaveExpenses={saveCollectorExpensesFromMobile}
          onCloseDay={closeCollectorDayFromMobile}
          onCloseMonth={closeCollectorMonthFromMobile}
          onCreateStreetClient={createStreetClientFromMobile}
          onCreateQuickLoan={createQuickLoanFromMobile}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "auditoria") {
      return (
        <ComingSoonPanel
          title="Auditoría"
          purpose="Historial oficial de acciones: quién creó, modificó o anuló clientes, préstamos y pagos."
          later="La línea de tiempo demo se reemplazará por el log de auditoría del servidor."
          tableColumns={[
            { id: "when", label: "Fecha" },
            { id: "user", label: "Usuario" },
            { id: "action", label: "Acción" },
            { id: "entity", label: "Entidad" },
            { id: "detail", label: "Detalle" },
          ]}
          tableTitle="Auditoría"
        />
      );
    }

    if (moduleId === "inicio" && viewId === "perfil") {
      return (
        <AdminProfileView
          session={session}
          onSessionChange={onSessionChange}
          onToast={onToast}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "config") {
      return <SystemSettingsView adminName={adminName} onToast={onToast} />;
    }

    if (moduleId === "inicio" && viewId === "pagos-varios-nuevo") {
      return (
        <MiscPaymentNewForm
          bankAccounts={bankAccounts}
          existing={miscPayments}
          onSave={(payment) => {
            setMiscPayments((rows) => [...rows, payment]);
            openMiscPaymentFicha(payment.ref);
          }}
          onCancel={() => onGo("inicio", "pagos-varios-listado")}
          onToast={onToast}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "pagos-varios-editar") {
      const payment = miscPayments.find((row) => row.ref === openMiscPaymentRef) ?? null;
      if (!payment) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Modificar pago varios</h1>
            </div>
            <p className="ficha-empty">No hay un pago varios seleccionado.</p>
            <button type="button" className="btn secondary" onClick={returnFromMiscPaymentPanel}>
              Volver
            </button>
          </section>
        );
      }

      return (
        <MiscPaymentNewForm
          bankAccounts={bankAccounts}
          existing={miscPayments}
          payment={payment}
          onSave={(updated) => {
            setMiscPayments((rows) => rows.map((row) => (row.ref === updated.ref ? updated : row)));
            setOpenMiscPaymentRef(updated.ref);
            if (miscPaymentReturn?.viewId === "pagos-varios-ficha") {
              onGo("inicio", "pagos-varios-ficha");
            } else if (miscPaymentReturn) {
              returnFromMiscPaymentPanel();
            } else {
              onGo("inicio", "pagos-varios-listado");
            }
          }}
          onCancel={() => {
            if (miscPaymentReturn?.viewId === "pagos-varios-ficha") {
              onGo("inicio", "pagos-varios-ficha");
            } else if (miscPaymentReturn) {
              returnFromMiscPaymentPanel();
            } else {
              onGo("inicio", "pagos-varios-listado");
            }
          }}
          onToast={onToast}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "pagos-varios-ficha") {
      const payment = miscPayments.find((row) => row.ref === openMiscPaymentRef) ?? null;
      if (!payment) {
        return (
          <section className="panel">
            <div className="head">
              <h1>Pago varios</h1>
            </div>
            <p className="ficha-empty">No hay un pago varios seleccionado.</p>
            <button type="button" className="btn secondary" onClick={returnFromMiscPaymentPanel}>
              Volver
            </button>
          </section>
        );
      }

      return (
        <MiscPaymentFicha
          payment={payment}
          bankAccounts={bankAccounts}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          onEdit={() =>
            openMiscPaymentEdit(payment.ref, {
              moduleId: "inicio",
              viewId: "pagos-varios-ficha",
            })
          }
          onOpenBankRecord={(movementRef) =>
            openBankExpenseFicha(movementRef, {
              moduleId: "inicio",
              viewId: "pagos-varios-ficha",
            })
          }
          onBack={miscPaymentReturn ? returnFromMiscPaymentPanel : undefined}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "pagos-varios-listado") {
      return (
        <MiscPaymentListView
          payments={miscPayments}
          bankAccounts={bankAccounts}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          highlightRef={openMiscPaymentRef || undefined}
          onBack={miscPaymentReturn ? returnFromMiscPaymentPanel : undefined}
          onOpenFicha={(ref) => openMiscPaymentFicha(ref)}
          onEdit={openMiscPaymentEdit}
          onCreate={() => onGo("inicio", "pagos-varios-nuevo")}
        />
      );
    }

    return (
      <section className="panel">
        <div className="head">
          <h1>{viewLabel}</h1>
        </div>
        <div className="ficha-main">
          <p style={{ color: "#4a5f56" }}>Vista de {moduleLabel}. La conectaremos a la API en las siguientes fases.</p>
        </div>
      </section>
    );
  }
}
