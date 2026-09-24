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
  assignClientToRouteOnLoan,
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
  applyDeclineLoanOfferToRoute,
  applySkipToRoute,
  assignmentFromItem,
  buildDispatchRoute,
  closeDispatchDay,
  collectorDayVisitsFullyClosed,
  DECLINED_LOAN_OFFER_TODAY_REASON,
  declineLoanOfferToday,
  dispatchRouteRef,
  markAssignmentsDispatched,
  NO_PAY_TODAY_REASON,
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
import { CarteraGroupView } from "@/components/CarteraGroupView";
import { CobranzaPaymentsView } from "@/components/CobranzaPaymentsView";
import { CollectorRecaudoReportView } from "@/components/CollectorRecaudoReportView";
import { AnulacionesView } from "@/components/AnulacionesView";
import { AuditoriaView } from "@/components/AuditoriaView";
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
import { projectOperationalMoney } from "@/lib/project-operational-money";
import {
  flushPaymentMirrorQueue,
  mergePaymentsByRef,
  pullRemotePaymentsIntoDemo,
  queuePaymentMirror,
  queuePaymentsMirror,
} from "@/lib/supabase/payment-mirror";
import { commitVoidPayment } from "@/lib/commit-void-payment";
import { synchronizeOperationalState } from "@/lib/operational-sync";
import { queueClientMirror, queueLoanMirror, queueLoansMirror, flushCatalogMirrorQueues } from "@/lib/supabase/catalog-mirror";
import {
  queueBankAccountMirror,
  flushBankAccountMirrorQueues,
} from "@/lib/supabase/bank-accounts-mirror";
import {
  commitUsersCatalog,
} from "@/lib/users-catalog";
import {
  commitConvertToCollector,
  commitCreateUser,
  commitDeleteUser,
  commitToggleUserActive,
  commitUpdateUser,
  commitUserPermissions,
  flushPeopleCatalogToCloud,
  type PeopleCatalogState,
} from "@/lib/commit-people-catalog";
import {
  flushOpsMirrorQueues,
  pullRemoteOpsIntoDemo,
  queueAssignmentsMirror,
  queueCollectorMirror,
  queueCollectorsMirror,
  queueDayCloseMirror,
  queueDayExpenseMirror,
  queueMiscPaymentMirror,
  queueRouteMirror,
  queueRouteDeleteMirror,
  queueRoutesMirror,
} from "@/lib/supabase/ops-mirror";
import {
  type OperationalDemoSnapshot,
} from "@/lib/hydrate-operational-demo";
import { refreshLabelsFromCatalog } from "@/lib/project-identity";
import { omitDeleted, readDeletedIds, rememberDeletedId } from "@/lib/deleted-ids";
import { mergeFresherByRef } from "@/lib/fresher-row";
import {
  applyWorkspaceRealtimeEvent,
  REALTIME_WORKSPACE_TABLES,
  type WorkspaceLiveSlice,
} from "@/lib/realtime-workspace";
import { bindMoneyRealtime, moneyRealtimeFilter } from "@/lib/realtime-money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { useOperationalDemoSync } from "@/lib/use-operational-demo-sync";
import { computeLoanFinancials, loanPaySummaryRows } from "@/lib/loan-balance";
import { buildRenewalLoans } from "@/lib/loan-renew";
import { markLoanFundedByBanco, markLoanFundedByNequi } from "@/lib/nequi-pool";
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
import { withPaymentEvidence, rememberPaymentEvidence } from "@/lib/payment-evidence-store";
import { preferRicherEvidence, evidenceHasPreview, type PaymentEvidenceRef } from "@/lib/payment-evidence";
import {
  buildRouteStop,
  isCombinedCollectorPayment,
  type CollectorPaymentRegisterInput,
} from "@/lib/route-sync";
import {
  dedupeClientsByRef,
  migrateLegacyRouteName,
  normalizeAllRouteOrders,
} from "@/lib/client-route-order";
import { newIdempotencyKey, pesos } from "@/lib/finance";
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
import {
  commitCollectorPayment,
  commitCollectorCombinedPayment,
  paymentsFromCollectorCommit,
} from "@/lib/commit-collector-payment";
import {
  commitCreateClient,
  commitCreateLoan,
  commitDeleteClient,
  commitNormalizeAllClientNamesTitleCase,
  DEMO_CLIENT_NAMES_TITLECASE_FLAG,
  commitRejectClients,
  commitUpdateClient,
  commitUpdateLoan,
  flushPortfolioCatalogToCloud,
  type PortfolioCatalogState,
  type PortfolioCommitResult,
} from "@/lib/commit-portfolio-catalog";
import { runOperationalDayCycle } from "@/lib/collector-day-auto-close";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
import { dedupeDailyPaymentsByVisit, reconcilePaymentsOntoPlanilla } from "@/lib/planilla-payment-reconcile";
import { collectorRecaudoBreakdown, collectorRecaudoForDate } from "@/lib/collector-mobile";
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
  listDeletedRouteRefs,
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
  expensesForCollectorDay,
  finalizeCollectorDayClose,
  findDayExpenseDraft,
  appendCashDisbursementExpense,
  applyDayCloseRecordsToAssignments,
  recoverPaymentsFromAssignments,
  recoverPaymentsFromBankMovements,
  removeDayExpenseDraft,
  synthesizeDayClosesFromAssignments,
  upsertAndTrimCollectorDayClose,
  upsertDayExpenseDraft,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";

import type { FileTab, LoanTab, WorkspaceProps } from "./types";

export function useWorkspace({
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
}: WorkspaceProps) {
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
  const [mobilePreviewCollectorRef, setMobilePreviewCollectorRef] = useState(COLLECTORS[0]?.ref ?? "");
  const [previewKind, setPreviewKind] = useState<"collector" | "supervisor">("collector");
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
  /** Ref de cuenta en edición (null = alta nueva en «Nueva cuenta»). */
  const [editBankAccountRef, setEditBankAccountRef] = useState<string | null>(null);
  const bankLedgerFromReportRef = useRef(false);
  const [openBankMovementRef, setOpenBankMovementRef] = useState("");
  const [bankExpenseReturn, setBankExpenseReturn] = useState<{ moduleId: ModuleId; viewId: string } | null>(
    null,
  );
  const [miscPayments, setMiscPayments] = useState<MiscPayment[]>([]);

  const prestamoListColumns = useColumnVisibility(PRESTAMO_LIST_COLUMNS, PRESTAMO_LIST_DEFAULT_COLS, {
    storageKey: "nexo.prestamos.listado.columns.v3",
  });

  const [deletedIds, setDeletedIds] = useState<string[]>(() => readDeletedIds());
  const deletedIdsRef = useRef(new Set(deletedIds));
  deletedIdsRef.current = new Set(deletedIds);

  function tombstone(ref: string) {
    const next = rememberDeletedId(ref);
    deletedIdsRef.current = new Set(next);
    setDeletedIds(next);
  }

  const applyOperationalSnapshot = useCallback((snap: OperationalDemoSnapshot) => {
    const gone = deletedIdsRef.current;
    setClients((current) => mergeFresherByRef(current, omitDeleted(snap.clients, gone)));
    setUsers(snap.users);
    setCollectors(snap.collectors);
    setRoutes((current) => mergeFresherByRef(current, omitDeleted(snap.routes, gone)));
    setLoans((current) => mergeFresherByRef(current, omitDeleted(snap.loans, gone)));
    setPayments((current) =>
      mergeFresherByRef(current, omitDeleted(snap.payments, gone)).map((row) => withPaymentEvidence(row)),
    );
    setDailyAssignments(snap.assignments);
    setDayCloses(snap.dayCloses);
    setDayExpenseDrafts(snap.dayExpenseDrafts);
    setDailyLogs(snap.dailyLogs);
    setMonthCloses(snap.monthCloses);
    setBankAccounts(snap.bankAccounts);
    setBankMovements(snap.bankMovements);
    setBankReconciliations(snap.bankReconciliations);
    setMiscPayments(snap.miscPayments);
    setBankAccountRef((current) => current || snap.bankAccounts[0]?.ref || "");
  }, []);

  const { hydrated: demoHydrated } = useOperationalDemoSync(
    applyOperationalSnapshot,
    {
      resyncActive: moduleId === "inicio" && viewId === "vista-movil",
      onEvidenceSync: ({ pushed, failed }) => {
        if (pushed > 0) {
          onToast(
            pushed === 1
              ? "1 comprobante local ya está en la nube."
              : `${pushed} comprobantes locales ya están en la nube.`,
          );
        } else if (failed > 0) {
          onToast("No se pudo subir un comprobante a la nube.");
        }
      },
    },
  );

  const liveRef = useRef<WorkspaceLiveSlice | null>(null);
  liveRef.current = {
    clients,
    users,
    collectors,
    loans,
    payments,
    routes,
    assignments: dailyAssignments,
    dayCloses,
    dayExpenseDrafts,
    bankAccounts,
    bankMovements,
    miscPayments,
  };

  useEffect(() => {
    if (!demoHydrated || !getSupabasePublicEnv().configured) return;
    let browser: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      browser = createSupabaseBrowserClient();
    } catch (error) {
      console.error("realtime-workspace", error);
      return;
    }
    const channel = browser.channel("realtime-workspace");
    for (const table of REALTIME_WORKSPACE_TABLES) {
      if (table === "payments") continue;
      channel.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        try {
          const live = liveRef.current;
          if (!live) return;
          const eventType = payload.eventType;
          if (eventType !== "INSERT" && eventType !== "UPDATE" && eventType !== "DELETE") return;
          const raw = eventType === "DELETE" ? payload.old : payload.new;
          const record =
            raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
          const next = applyWorkspaceRealtimeEvent(table, eventType, record, live);
          if (!next) return;
          if (eventType === "DELETE") {
            const ref = String(record?.ref || "").trim();
            if (ref) {
              deletedIdsRef.current = new Set(readDeletedIds());
              setDeletedIds(readDeletedIds());
            }
          }
          liveRef.current = next;
          setClients(next.clients);
          setLoans(next.loans);
          setPayments(next.payments.map((row) => withPaymentEvidence(row)));
          setRoutes(next.routes);
          setDailyAssignments(next.assignments);
          setDayCloses(next.dayCloses);
          setBankMovements(next.bankMovements);
          writeDemoJson(DEMO_CLIENTS_KEY, next.clients);
          writeDemoJson(DEMO_LOANS_KEY, next.loans);
          writeDemoJson(DEMO_PAYMENTS_KEY, next.payments);
          writeDemoJson(DEMO_ROUTES_KEY, next.routes);
          writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, next.assignments);
          writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, next.dayCloses);
          writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, next.bankMovements);
        } catch (error) {
          console.error("realtime-workspace", error);
        }
      });
    }
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("realtime-workspace", status);
      }
    });
    return () => {
      void browser.removeChannel(channel);
    };
  }, [demoHydrated]);

  const namesTitleCaseDoneRef = useRef(false);
  useEffect(() => {
    if (!demoHydrated || namesTitleCaseDoneRef.current) return;
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(DEMO_CLIENT_NAMES_TITLECASE_FLAG) === "1") {
        namesTitleCaseDoneRef.current = true;
        return;
      }
    } catch {
      return;
    }
    namesTitleCaseDoneRef.current = true;
    const result = commitNormalizeAllClientNamesTitleCase({
      clients: readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []),
      loans: readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []),
      routes: readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, []),
      assignments: readDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, []),
      collectors: readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, []),
      payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
    });
    try {
      window.localStorage.setItem(DEMO_CLIENT_NAMES_TITLECASE_FLAG, "1");
    } catch {
      /* ignore */
    }
    if (!result.ok) return;
    void applyPortfolioCommit(result);
  }, [demoHydrated]);

  /**
   * Antes de guardar o subir desde el panel: pull de payments y fusión por UUID / ref.
   * Un cobro que solo está en Supabase entra al estado. No se reemplaza por la lista local.
   */
  const pullChainRef = useRef<Promise<PaymentRow[]>>(Promise.resolve([]));
  const syncPaymentsFromCloud = useCallback((localOverride?: PaymentRow[]) => {
    const job = pullChainRef.current.catch(() => [] as PaymentRow[]).then(async () => {
      await pullRemotePaymentsIntoDemo();
      const stored = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
      const local = omitDeleted(localOverride ?? liveRef.current?.payments ?? []);
      const { merged } = mergePaymentsByRef(local, omitDeleted(stored));
      const live = merged.map((row) => withPaymentEvidence(row));
      if (liveRef.current) {
        liveRef.current = { ...liveRef.current, payments: live };
      }
      setPayments(live);
      writeDemoJson(DEMO_PAYMENTS_KEY, live);
      return live;
    });
    pullChainRef.current = job;
    return job;
  }, []);

  /**
   * Pull de cobros, gastos y cierres antes de pintar o encolar.
   * El merge por UUID integra el PG- que llegó desde Vercel.
   */
  const paintMoneyFromCloud = useCallback(async () => {
    const live = await syncPaymentsFromCloud();
    let opsOk = false;
    try {
      const ops = await pullRemoteOpsIntoDemo();
      opsOk = ops.ok;
    } catch (error) {
      console.error("realtime-money", error);
    }
    const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(
      DEMO_DAILY_ASSIGNMENTS_KEY,
      [],
    );
    const base = storedAssignments.length
      ? storedAssignments
      : (liveRef.current?.assignments ?? []);
    const assignments = reconcilePaymentsOntoPlanilla(base, live);
    if (liveRef.current) {
      liveRef.current = { ...liveRef.current, assignments, payments: live };
    }
    setDailyAssignments(assignments);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);
    if (!opsOk) return;
    const expenses = readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []);
    const closes = readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []);
    setDayExpenseDrafts(expenses);
    setDayCloses(closes);
    if (liveRef.current) {
      liveRef.current = {
        ...liveRef.current,
        dayExpenseDrafts: expenses,
        dayCloses: closes,
      };
    }
  }, [syncPaymentsFromCloud]);

  useEffect(() => {
    if (!demoHydrated) return;
    void paintMoneyFromCloud();
  }, [
    demoHydrated,
    moduleId,
    viewId,
    previewKind,
    mobilePreviewCollectorRef,
    session?.roleRef,
    paintMoneyFromCloud,
  ]);

  useEffect(() => {
    if (!demoHydrated || !getSupabasePublicEnv().configured) return;
    let browser: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      browser = createSupabaseBrowserClient();
    } catch (error) {
      console.error("realtime-money", error);
      return;
    }
    const filter = moneyRealtimeFilter(session?.roleRef, session?.collectorRef);
    const scope =
      session?.roleRef === COLLECTOR_ROLE_REF && session.collectorRef
        ? session.collectorRef
        : "global";
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void paintMoneyFromCloud();
      }, 250);
    };
    const channel = browser.channel(`realtime-money-${scope}`);
    bindMoneyRealtime(channel, schedule, filter);
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("realtime-money", status);
        schedule();
      }
    });
    return () => {
      window.clearTimeout(timer);
      void browser.removeChannel(channel);
    };
  }, [demoHydrated, session?.roleRef, session?.collectorRef, paintMoneyFromCloud]);

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
      void (async () => {
      const livePayments = await syncPaymentsFromCloud();
      const assignments = reconcilePaymentsOntoPlanilla(next.assignments, livePayments);
      setDailyAssignments(assignments);
      setRoutes(next.routes);
      setLoans(next.loans);
      setDailyLogs(next.logs);
      setDayCloses(next.dayCloses);
      setDayExpenseDrafts(next.dayExpenseDrafts);
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);
      queueAssignmentsMirror(assignments);
      writeDemoJson(DEMO_ROUTES_KEY, next.routes);
      writeDemoJson(DEMO_LOANS_KEY, next.loans);
      writeDemoJson(DEMO_DAILY_LOGS_KEY, next.logs);
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, next.dayCloses);
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, next.dayExpenseDrafts);
      // Cierre auto 23:30: proyectar gastos/CIE al banco de inmediato (misma raíz que cobrador).
      if (next.autoClosedCount > 0) {
        setBankMovements((rows) =>
          applyBankLedgerSync(rows, {
            payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
            accounts: bankAccounts,
            miscPayments: readDemoJson(DEMO_MISC_PAYMENTS_KEY, []),
            dayExpenseDrafts: next.dayExpenseDrafts,
            dayCloses: next.dayCloses,
            loans: next.loans,
          }),
        );
      }
      })();
    },
    [bankAccounts, syncPaymentsFromCloud],
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
        loans,
      }),
    );
  }, [demoHydrated, payments, dayExpenseDrafts, dayCloses, bankAccounts, miscPayments, loans]);

  useEffect(() => {
    if (!demoHydrated) return;
    commitUsersCatalog(users);
  }, [users, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_COLLECTORS_KEY, collectors);
  }, [collectors, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_ROUTES_KEY, omitDeleted(routes));
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
    if (clients.length === 0) return;
    writeDemoJson(DEMO_CLIENTS_KEY, omitDeleted(clients));
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
    const stored = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
    const { merged, added } = mergePaymentsByRef(omitDeleted(payments), omitDeleted(stored));
    writeDemoJson(DEMO_PAYMENTS_KEY, merged);
    if (added > 0) setPayments(merged.map((row) => withPaymentEvidence(row)));
  }, [payments, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_LOANS_KEY, omitDeleted(loans));
  }, [loans, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, bankAccounts);
  }, [bankAccounts, demoHydrated]);

  /** Al salir del formulario de cuenta, no dejar edición colgada. */
  useEffect(() => {
    if (moduleId === "banco" && viewId === "nueva-cuenta") return;
    setEditBankAccountRef(null);
  }, [moduleId, viewId]);

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
      const repaired = ensureCollectorsForUsers(users, collectors, { inventMissing: true });
      for (const cob of repaired.collectors) {
        if (!collectors.some((row) => row.ref === cob.ref)) queueCollectorMirror(cob);
      }
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
    setRoutes((current) => {
      const next = current.map((row) =>
        row.collectorRef === ref ? { ...row, collector: name } : row,
      );
      for (const row of next) {
        if (row.collectorRef === ref) queueRouteMirror(row);
      }
      return next;
    });
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

  function portfolioState(): PortfolioCatalogState {
    return {
      clients,
      loans,
      routes,
      assignments: dailyAssignments,
      collectors,
      payments,
    };
  }

  async function applyPortfolioCommit(
    result: PortfolioCommitResult,
    opts?: { deferToast?: boolean },
  ) {
    if (!result.ok) {
      onToast(result.error);
      return false;
    }
    const labeled = refreshLabelsFromCatalog({
      clients: result.state.clients,
      users,
      collectors,
      loans: result.state.loans,
      payments: result.state.payments,
      routes: result.state.routes,
      assignments: result.state.assignments,
    });
    if (labeled.loans !== result.state.loans) writeDemoJson(DEMO_LOANS_KEY, labeled.loans);
    if (labeled.routes !== result.state.routes) writeDemoJson(DEMO_ROUTES_KEY, labeled.routes);
    if (labeled.payments !== result.state.payments) writeDemoJson(DEMO_PAYMENTS_KEY, labeled.payments);
    if (labeled.assignments !== result.state.assignments) {
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, labeled.assignments);
      queueAssignmentsMirror(labeled.assignments);
    }
    setClients(result.state.clients);
    setLoans(labeled.loans);
    setRoutes(labeled.routes);
    setDailyAssignments(labeled.assignments);
    setPayments(labeled.payments.map((row) => withPaymentEvidence(row)));
    if (result.focusClientRef) {
      setOpenRef(result.focusClientRef);
      setFileTab("ficha");
    }
    if (result.focusLoanRef) {
      setOpenLoanRef(result.focusLoanRef);
      setLoanTab("ficha");
    }
    if (result.goTo) onGo(result.goTo.moduleId, result.goTo.viewId);
    if (!opts?.deferToast) onToast("Guardando en el sistema…");
    try {
      await flushPortfolioCatalogToCloud();
      if (!opts?.deferToast) onToast(result.message);
    } catch {
      if (!opts?.deferToast) {
        onToast(`${result.message} (sin nube; en este aparato ya está).`);
      }
    }
    return true;
  }

  function saveEdit(draft: ClientDraft) {
    if (!openClient) return;
    void applyPortfolioCommit(commitUpdateClient(openClient.ref, draft, portfolioState()));
  }

  function saveNew(draft: ClientDraft) {
    void applyPortfolioCommit(
      commitCreateClient(draft, portfolioState(), {
        canApprove: canApproveClient,
        createdBy: sessionUser?.name,
      }),
    );
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
    void applyPortfolioCommit(commitRejectClients(refs, portfolioState()));
  }

  function deleteClient() {
    if (!openClient) return;
    const ref = openClient.ref;
    const result = commitDeleteClient(ref, portfolioState());
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    tombstone(ref);
    void applyPortfolioCommit(result).then((ok) => {
      if (ok) setConfirmDelete(false);
    });
  }

  function saveNewLoan(draft: LoanDraft) {
    void (async () => {
      const cash = draft.fundedBy === "efectivo";
      const result = commitCreateLoan(draft, portfolioState());
      const ok = await applyPortfolioCommit(result, { deferToast: cash });
      if (!ok || !result.ok) return;
      if (!cash) return;

      const loan = result.focusLoanRef
        ? result.state.loans.find((row) => row.ref === result.focusLoanRef)
        : result.state.loans[0];
      if (!loan) {
        onToast(result.message);
        return;
      }

      const client = result.state.clients.find((row) => row.ref === draft.clientRef);
      const route = result.state.routes.find((row) => row.name === client?.route);
      const collector = collectors.find((row) => row.ref === route?.collectorRef);
      if (!collector || !route) {
        onToast(
          `${result.message} Origen efectivo: asigne cobrador a la ruta para descontar de su caja.`,
        );
        return;
      }

      const date = displayToIso(draft.date) || todayIso();
      const nextDrafts = appendCashDisbursementExpense(dayExpenseDrafts, {
        collectorRef: collector.ref,
        collectorName: collector.name,
        date,
        routeRef: route.ref,
        loan,
      });
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);
      setDayExpenseDrafts(nextDrafts);
      const expenseDraft = nextDrafts.find(
        (row) => row.ref === `GAS-${collector.ref}-${date}`,
      );
      if (expenseDraft) queueDayExpenseMirror(expenseDraft);
      const accounts = ensureBankAccounts(bankAccounts);
      if (!bankAccounts.length) setBankAccounts(accounts);
      setBankMovements((rows) =>
        applyBankLedgerSync(rows, {
          payments,
          accounts,
          miscPayments,
          dayExpenseDrafts: nextDrafts,
          dayCloses,
          loans: result.state.loans,
        }),
      );
      onToast(
        `Préstamo ${loan.ref}: capital ${money(loan.capital)} descontado del efectivo de ${collector.name}.`,
      );
    })();
  }

  function saveEditLoan(draft: LoanDraft) {
    if (!openLoan) return;
    void applyPortfolioCommit(commitUpdateLoan(openLoan.ref, draft, portfolioState()));
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
    const updated: RouteRow = {
      ...openRoute,
      id: routeSlug(name),
      name,
      updatedAt: new Date().toISOString(),
    };
    setRoutes((current) =>
      current.map((row) => (row.ref === openRoute.ref ? updated : row)),
    );
    queueRouteMirror(updated);
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
    const updated = { ...route, ...meta };
    setRoutes((current) =>
      current.map((row) => (row.ref === ref ? updated : row)),
    );
    queueRouteMirror(updated);
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
    tombstone(ref);
    setRoutes((current) => {
      const next = current.filter((row) => row.ref !== ref);
      writeDemoJson(DEMO_ROUTES_KEY, next);
      return next;
    });
    queueRouteDeleteMirror(ref);
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
    // Nunca reutilizar un ref con lápida (otros aparatos lo filtrarían del pull).
    const ref = nextRouteCode(catalogRouteList, listDeletedRouteRefs());
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
    queueRouteMirror(row);
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
    queueRoutesMirror(synced.routes);
    queueAssignmentsMirror(synced.assignments);
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
    queueRoutesMirror(synced.routes);
    queueAssignmentsMirror(synced.assignments);

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

    // Misma raíz que cierre móvil / 23:30: CIE + gastos → banco, no solo planilla.
    let nextCloses = dayCloses;
    let nextDrafts = dayExpenseDrafts;
    for (const collectorRef of result.collectorRefs) {
      const collector = collectors.find((row) => row.ref === collectorRef);
      if (!collector) continue;
      const draft = findDayExpenseDraft(nextDrafts, collectorRef, date);
      const lines = (draft?.expenses ?? []).filter((row) => row.amount > 0);
      const collected = collectorRecaudoForDate(collectorRef, date, payments, collectors);
      const cashCollected = collectorRecaudoBreakdown(
        collectorRef,
        date,
        payments,
        collectors,
      ).efectivo;
      const record = finalizeCollectorDayClose({
        draft: {
          collectorRef,
          collectorName: collector.name,
          date,
          routeRef: draft?.routeRef || `RUT-D-${collectorRef}-${date}`,
          collected,
          expenses: lines,
        },
        lines,
        cashCollected,
        movementRefs: lines.map((line) =>
          dayExpenseLineMovementRef(collectorRef, date, line.id, line.loanRef),
        ),
      });
      nextCloses = upsertAndTrimCollectorDayClose(nextCloses, record);
      nextDrafts = removeDayExpenseDraft(nextDrafts, collectorRef, date);
      queueDayCloseMirror(record);
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
    void flushOpsMirrorQueues().catch(() => {
      /* cola offline reintenta */
    });
    setDailyLogs(result.logs);
    writeDemoJson(DEMO_DAILY_LOGS_KEY, result.logs);
    setDayCloses(nextCloses);
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, nextCloses);
    setDayExpenseDrafts(nextDrafts);
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextDrafts);

    const accounts = ensureBankAccounts(bankAccounts);
    if (!bankAccounts.length) setBankAccounts(accounts);
    setBankMovements((rows) =>
      applyBankLedgerSync(rows, {
        payments,
        accounts,
        miscPayments,
        dayExpenseDrafts: nextDrafts,
        dayCloses: nextCloses,
        loans,
      }),
    );

    const alertResult = bumpMissedCollectionAlerts(loans, result.missedLoanRefs, date, payments);
    setLoans(alertResult.loans);
    const parts = [
      `${result.collectorsClosed} cobrador${result.collectorsClosed === 1 ? "" : "es"}`,
      formatCloseDayAlertSummary(alertResult.alerted, alertResult.toMora),
    ].filter(Boolean);
    onToast(`Día cerrado · ${parts.join(" · ")} · CIE y banco al día.`);
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
    queueDayExpenseMirror(draft);

    const accounts = ensureBankAccounts(bankAccounts);
    if (!bankAccounts.length) setBankAccounts(accounts);
    setBankMovements((rows) =>
      applyBankLedgerSync(rows, {
        payments,
        accounts,
        miscPayments,
        dayExpenseDrafts: nextDrafts,
        dayCloses,
        loans,
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
    const accounts = ensureBankAccounts(bankAccounts);
    if (!bankAccounts.length) setBankAccounts(accounts);

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

    const closes = loadDemoDayCloses<CollectorDayCloseRecord>();
    let nextCloses = closes;
    let nextDrafts = dayExpenseDrafts;
    let record: CollectorDayCloseRecord | null = null;

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

      setBankMovements((rows) =>
        applyBankLedgerSync(rows, {
          payments,
          accounts,
          miscPayments,
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
    void flushOpsMirrorQueues().catch(() => {
      /* cola offline reintenta */
    });
    setDailyLogs(result.logs);

    const alertResult = bumpMissedCollectionAlerts(
      loans,
      result.missedLoanRefs,
      payload.date,
      payments,
    );
    setLoans(alertResult.loans);

    if (!fullyClosed) {
      const label = payload.planillaRoute
        ? `Planilla ${payload.planillaRoute} cerrada`
        : "Planilla cerrada";
      onToast(
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

  function registerCollectorPayment(input: CollectorPaymentRegisterInput) {
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
      onToast(committed.error);
      return false;
    }

    const primaryDraft = isCombinedCollectorPayment(input) ? input.parts[0] : input;
    const paymentsCreated = paymentsFromCollectorCommit(committed);

    const paidRoute =
      committed.routes.find((row) => row.ref === committed.payment.routeRef) ??
      committed.routes.find((row) =>
        row.ref.startsWith(`RUT-D-${primaryDraft.collectorRef}-`),
      );
    let logsAfterPay = dailyLogs;
    if (paidRoute) {
      for (const pay of paymentsCreated) {
        logsAfterPay = upsertDailyLogPayment(logsAfterPay, pay, paidRoute);
      }
    }

    // Proyección única: préstamos + CIE + banco + planilla + logs (raíz PG-).
    const projected = projectOperationalMoney({
      loans: committed.loans,
      payments: committed.payments,
      collectors,
      clients: committed.clients,
      dayCloses,
      dayExpenseDrafts,
      bankAccounts,
      bankMovements,
      miscPayments,
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
    setBankMovements(projected.bankMovements);
    writeDemoJson(DEMO_LOANS_KEY, projected.loans);
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, projected.dayCloses);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, projected.assignments);
    writeDemoJson(DEMO_DAILY_LOGS_KEY, projected.dailyLogs);

    const toastRefs = paymentsCreated.map((row) => row.ref).join(" + ");
    onToast(`Cobro ${toastRefs} guardado · subiendo a la nube…`);
    void (async () => {
      const live = await syncPaymentsFromCloud(committed.payments);
      const assignments = reconcilePaymentsOntoPlanilla(projected.assignments, live);
      setDailyAssignments(assignments);
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);
      await queuePaymentsMirror(paymentsCreated);
      const paidLoan = committed.loans.find((row) => row.ref === committed.payment.loanRef);
      if (paidLoan) queueLoanMirror(paidLoan);
      const paidClient = committed.clients.find((row) =>
        committed.loans.some(
          (loan) => loan.ref === committed.payment.loanRef && loan.clientRef === row.ref,
        ),
      );
      if (paidClient) queueClientMirror(paidClient);
      queueAssignmentsMirror(assignments);
      try {
        await flushPaymentMirrorQueue();
        await flushCatalogMirrorQueues();
        await flushOpsMirrorQueues();
        onToast(`Cobro ${toastRefs} listo en la nube`);
      } catch {
        onToast(`Cobro ${toastRefs} guardado (sin nube; en este aparato ya está).`);
      }
    })();
    return true;
  }

  function attachPaymentEvidence(paymentRef: string, evidence: PaymentEvidenceRef[]) {
    const ref = paymentRef.trim();
    if (!ref || !evidence.length) return;
    rememberPaymentEvidence(ref, evidence);
    setPayments((current) => {
      const next = current.map((row) => {
        if (row.ref !== ref) return row;
        const merged = preferRicherEvidence(evidence, row.evidence) ?? evidence;
        return withPaymentEvidence({ ...row, evidence: merged });
      });
      writeDemoJson(DEMO_PAYMENTS_KEY, next);
      const row = next.find((entry) => entry.ref === ref);
      if (row) queuePaymentMirror(row);
      return next;
    });
    onToast("Comprobante guardado · subiendo a la nube…");
  }

  async function voidPayment(paymentRef: string, reason: string) {
    const currentPayments = await syncPaymentsFromCloud();
    const result = commitVoidPayment({
      paymentRef,
      reason,
      voidedBy: adminName || session.name || session.username || "admin",
      payments: currentPayments,
      loans,
    });
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    const projected = synchronizeOperationalState({
      payments: result.payments,
      loans: result.loans,
      collectors,
      clients,
      dayCloses,
      dayExpenseDrafts,
      bankAccounts,
      bankMovements,
      miscPayments,
      assignments: dailyAssignments,
    });
    const voidedAtStamp = new Date().toISOString();
    const stampedPayments = result.payments.map((row) =>
      row.ref === result.payment.ref ? { ...row, updatedAt: voidedAtStamp } : row,
    );
    setPayments(stampedPayments.map((row) => withPaymentEvidence(row)));
    setLoans(projected.loans);
    setDailyAssignments(projected.assignments);
    setDayCloses(projected.dayCloses);
    setBankMovements(projected.bankMovements);
    const livePayments = await syncPaymentsFromCloud(stampedPayments);
    const assignments = reconcilePaymentsOntoPlanilla(projected.assignments, livePayments);
    setDailyAssignments(assignments);
    writeDemoJson(DEMO_LOANS_KEY, projected.loans);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);
    queueAssignmentsMirror(assignments);
    const mirror = await queuePaymentMirror({ ...result.payment, updatedAt: voidedAtStamp });
    if (!mirror.ok) {
      onToast(`Anulado en local · nube pendiente: ${mirror.error || "sin red"}`);
      onGo("cobranza", "anulaciones");
      return;
    }
    await flushPaymentMirrorQueue();
    await flushOpsMirrorQueues().catch(() => undefined);
    onToast(`Pago ${result.payment.ref} anulado · sincronizado.`);
    onGo("cobranza", "anulaciones");
  }

  function skipCollectorVisit(draft: CollectorSkipVisitDraft) {
    const declinedOffer = draft.reason === DECLINED_LOAN_OFFER_TODAY_REASON;
    const nextAssignments = declinedOffer
      ? declineLoanOfferToday(dailyAssignments, {
          collectorRef: draft.collectorRef,
          dispatchDate: draft.dispatchDate,
          clientRef: draft.clientRef,
        })
      : skipAssignmentVisit(dailyAssignments, {
          collectorRef: draft.collectorRef,
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
    onToast(
      declinedOffer
        ? "Sale de por cobrar. Prestar sigue disponible si cambia de opinión."
        : draft.reason === NO_PAY_TODAY_REASON
          ? "Sale de por cobrar. Quedó en S/N."
          : draft.reason
            ? `Visita omitida · ${draft.reason}.`
            : "Visita omitida.",
    );
  }

  function renewLoan(loanRef: string) {
    const loan = loans.find((row) => row.ref === loanRef);
    if (!loan) {
      onToast("Préstamo no encontrado.");
      return;
    }
    const newRef = nextLoanCode(loans);
    // Admin/oficina: renovación sale de Nequi (Haber DSB- + resta acumulado).
    const result = buildRenewalLoans(loan, newRef, todayIso(), "nequi");
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
    queueLoansMirror([result.created, result.closed]);
    const renewedClient = clients.find((entry) => entry.ref === loan.clientRef);
    if (renewedClient) {
      queueClientMirror({
        ...renewedClient,
        total: renewedClient.total + (result.created.total ?? 0),
        pending: Math.max(
          0,
          renewedClient.pending - loan.balance + (result.created.total ?? 0),
        ),
      });
    }
    onToast(
      `Renovación ${newRef}: capital ${money(result.created.capital)} sale de Nequi · total ${money(result.created.total ?? 0)}.`,
    );
  }

  function createStreetClientFromMobile(draft: {
    name: string;
    lastName?: string;
    phone?: string;
  }) {
    const row = buildStreetClient(
      {
        name: draft.name,
        lastName: draft.lastName,
        phone: draft.phone,
        createdBy: sessionUser?.name ?? "Supervisor",
      },
      clients,
    );
    const nextClients = insertStreetClient(clients, row);
    setClients(nextClients);
    queueClientMirror(row);
    onToast(`Cliente ${row.name} guardado en el catálogo.`);
    void flushCatalogMirrorQueues().catch(() => {
      /* offline: queda en cola local */
    });
  }

  function updateClientFromMobile(draft: {
    ref: string;
    name: string;
    lastName: string;
    phone: string;
    document: string;
    address: string;
    city: string;
    barrio: string;
    notes: string;
    route: string;
    routeOrder: number;
  }) {
    const openClient = clients.find((row) => row.ref === draft.ref);
    if (!openClient) {
      onToast("Cliente no encontrado.");
      return;
    }
    void applyPortfolioCommit(
      commitUpdateClient(
        draft.ref,
        {
          name: draft.name,
          lastName: draft.lastName,
          nickname: openClient.nickname ?? "",
          document: draft.document,
          route: draft.route,
          routeOrder: draft.routeOrder,
          email: openClient.email ?? "",
          city: draft.city,
          barrio: draft.barrio,
          address: draft.address,
          notes: draft.notes,
          photo: openClient.photo,
          phone: draft.phone,
        },
        portfolioState(),
      ),
    );
  }

  function createQuickLoanFromMobile(draft: QuickLoanDraft) {
    const client = clients.find((row) => row.ref === draft.clientRef);
    if (!client) {
      onToast("Cliente no encontrado.");
      return;
    }
    const loan = buildQuickLoan(
      {
        ...draft,
        fundedBy: draft.fundedBy === "banco" ? "banco" : "nequi",
      },
      client,
      loans,
    );
    if (!loan) {
      onToast("Revise capital, interés, tiempo y frecuencia.");
      return;
    }
    const nextLoans = [loan, ...loans];
    const targetRoute = (draft.routeName ?? client.route).trim();
    const nextClients = assignClientToRouteOnLoan(clients, client, targetRoute, {
      awaitingLoan: false,
      status: CLIENT_STATUS_ACTIVE,
      kind: clientStatusKind(CLIENT_STATUS_ACTIVE),
      total: client.total + (loan.total ?? 0),
      pending: client.pending + (loan.total ?? 0),
    });
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
    queueLoanMirror(loan);
    const mirroredClient = nextClients.find((entry) => entry.ref === client.ref);
    if (mirroredClient) queueClientMirror(mirroredClient);
    onToast(`Préstamo ${loan.ref} creado · cuota ${money(loan.installment ?? 0)}.`);
  }

  function peopleState(): PeopleCatalogState {
    return { users, collectors, routes, payments };
  }

  async function applyPeopleCommit(
    result: ReturnType<typeof commitCreateUser>,
    options?: { goListado?: boolean; openFicha?: boolean },
  ) {
    if (!result.ok) {
      onToast(result.error);
      return false;
    }
    const labeled = refreshLabelsFromCatalog({
      clients,
      users: result.state.users,
      collectors: result.state.collectors,
      loans,
      payments: result.state.payments,
      routes: result.state.routes,
      assignments: dailyAssignments,
    });
    if (labeled.loans !== loans) writeDemoJson(DEMO_LOANS_KEY, labeled.loans);
    if (labeled.routes !== result.state.routes) writeDemoJson(DEMO_ROUTES_KEY, labeled.routes);
    if (labeled.payments !== result.state.payments) writeDemoJson(DEMO_PAYMENTS_KEY, labeled.payments);
    if (labeled.assignments !== dailyAssignments) {
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, labeled.assignments);
      queueAssignmentsMirror(labeled.assignments);
    }
    setUsers(result.state.users);
    setCollectors(result.state.collectors);
    setLoans(labeled.loans);
    setRoutes(labeled.routes);
    setDailyAssignments(labeled.assignments);
    setPayments(labeled.payments.map((row) => withPaymentEvidence(row)));
    if (options?.goListado) onGo("inicio", "listado");
    if (options?.openFicha && result.focusUserRef) openUserFicha(result.focusUserRef);
    onToast("Guardando acceso…");
    try {
      await flushPeopleCatalogToCloud();
      onToast(`${result.message} Acceso listo para ingresar.`);
    } catch {
      onToast(`${result.message} (sin nube; en este aparato ya puede entrar).`);
    }
    return true;
  }

  function toggleCollectorActive() {
    if (!openUser) return;
    void applyPeopleCommit(commitToggleUserActive(openUser.ref, peopleState())).then((ok) => {
      if (ok) setConfirmUserDelete(false);
    });
  }

  function deleteUser() {
    if (!openUser) return;
    const result = commitDeleteUser(openUser.ref, peopleState(), activities);
    if (!result.ok) {
      onToast(result.error);
      setConfirmUserDelete(false);
      return;
    }
    const synced = syncPermanentRoutePlanilla(
      todayIso(),
      result.state.routes,
      clients,
      loans,
      result.state.collectors,
      dailyAssignments,
      result.state.payments,
    );
    const labeled = refreshLabelsFromCatalog({
      clients,
      users: result.state.users,
      collectors: result.state.collectors,
      loans,
      payments: result.state.payments,
      routes: synced.routes,
      assignments: synced.assignments,
    });
    if (labeled.loans !== loans) writeDemoJson(DEMO_LOANS_KEY, labeled.loans);
    if (labeled.assignments !== synced.assignments) {
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, labeled.assignments);
      queueAssignmentsMirror(labeled.assignments);
    }
    if (labeled.routes !== synced.routes) writeDemoJson(DEMO_ROUTES_KEY, labeled.routes);
    if (labeled.payments !== result.state.payments) writeDemoJson(DEMO_PAYMENTS_KEY, labeled.payments);
    setUsers(result.state.users);
    setCollectors(result.state.collectors);
    setLoans(labeled.loans);
    setRoutes(labeled.routes);
    setDailyAssignments(labeled.assignments);
    setPayments(labeled.payments.map((row) => withPaymentEvidence(row)));
    setOpenUserRef(result.state.users[0]?.ref ?? "");
    setConfirmUserDelete(false);
    onGo("inicio", "listado");
    onToast("Guardando acceso…");
    void flushPeopleCatalogToCloud().then(() => {
      onToast(result.message);
    });
  }

  function saveNewUser(draft: UserDraft) {
    void applyPeopleCommit(commitCreateUser(draft, peopleState()), { goListado: true });
  }

  function convertUserToCollector(userRef: string) {
    void applyPeopleCommit(commitConvertToCollector(userRef, peopleState()), { openFicha: true });
  }

  function saveEditUser(draft: UserEditDraft) {
    if (!openUser) return;
    void applyPeopleCommit(commitUpdateUser(openUser.ref, draft, peopleState())).then((ok) => {
      if (ok) onGo("inicio", "ficha-usuario");
    });
  }

  function toggleUserActive() {
    if (!openUser) return;
    void applyPeopleCommit(commitToggleUserActive(openUser.ref, peopleState()));
  }

  function saveUserPermissions(userRef: string, permissions: string[]) {
    void applyPeopleCommit(commitUserPermissions(userRef, permissions, peopleState()));
  }

  function deleteLoan() {
    if (!openLoan) return;
    const removed = openLoan;
    tombstone(removed.ref);
    const delta = removed.total ?? removed.capital;
    setLoans((current) => {
      const next = omitDeleted(current.filter((row) => row.ref !== removed.ref));
      writeDemoJson(DEMO_LOANS_KEY, next);
      return next;
    });
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
    const loan = openLoan;
    const amountPesos = pesos(amount);
    const idempotencyKey = newIdempotencyKey("caja");
    void (async () => {
    const base = await syncPaymentsFromCloud();
    if (base.some((row) => row.idempotencyKey === idempotencyKey)) {
      onToast("Pago ya sincronizado (sin duplicar).");
      return;
    }
    const result = applyPay(loan, kind, amountPesos);
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    const target = cuotaTarget(loan);
    const paidTime = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const paidDay = todayIso();
    const row = buildPaymentRow(
      {
        ref: nextPaymentCode(base),
        loanRef: loan.ref,
        when: `${isoToDispatchLabel(paidDay)} · ${paidTime}`,
        paidDate: paidDay,
        paidTime,
        dueDate: target?.date,
        chargeLabel: target?.kind ? chargeLabel(target.kind) : result.type,
        client: loan.client,
        collector: "Caja / oficina",
        idempotencyKey,
        amount: amountPesos,
        type: result.type,
        kind: paymentRowKind(result),
        method: normalizePaymentMethod(method),
        source: "caja",
        updatedAt: new Date().toISOString(),
      },
      loan,
      result,
    );
    const drafted = [row, ...base];
    const livePayments = await syncPaymentsFromCloud(drafted);
    const nextLoans = loans.map((entry) =>
      entry.ref === loan.ref ? loanRowAfterPay(entry, result, livePayments) : entry,
    );
    const nextClients = clients.map((entry) =>
      entry.ref === loan.clientRef
        ? { ...entry, pending: Math.max(0, entry.pending - amountPesos) }
        : entry,
    );
    const nextAssignments = reconcilePaymentsOntoPlanilla(dailyAssignments, livePayments);
    const projected = projectOperationalMoney({
      loans: nextLoans,
      payments: livePayments,
      collectors,
      clients: nextClients,
      dayCloses,
      dayExpenseDrafts,
      bankAccounts,
      bankMovements,
      miscPayments,
      assignments: nextAssignments,
      dailyLogs,
    });

    setPayments(livePayments);
    setClients(nextClients);
    setLoans(projected.loans);
    setDayCloses(projected.dayCloses);
    setDailyAssignments(projected.assignments);
    setDailyLogs(projected.dailyLogs);
    setBankMovements(projected.bankMovements);
    writeDemoJson(DEMO_LOANS_KEY, projected.loans);
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, projected.dayCloses);
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, projected.assignments);
    writeDemoJson(DEMO_DAILY_LOGS_KEY, projected.dailyLogs);

    setPayMode(null);
    onToast(`${result.message} · guardando en el sistema…`);
    queuePaymentMirror(row);
    const nextLoan = projected.loans.find((entry) => entry.ref === loan.ref);
    if (nextLoan) queueLoanMirror(nextLoan);
    const cajaClient = nextClients.find((entry) => entry.ref === loan.clientRef);
    if (cajaClient) queueClientMirror(cajaClient);
    queueAssignmentsMirror(projected.assignments);
    try {
      await flushPaymentMirrorQueue();
      await Promise.all([flushCatalogMirrorQueues(), flushOpsMirrorQueues()]);
      onToast(`${result.message} · listo.`);
    } catch {
      onToast(`${result.message} (sin nube; en este aparato ya está).`);
    }
    })();
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
  return {
    key,
    clients,
    setClients,
    loans,
    setLoans,
    payments,
    setPayments,
    routes,
    setRoutes,
    collectors,
    setCollectors,
    users,
    setUsers,
    dailyLogs,
    setDailyLogs,
    dailyAssignments,
    setDailyAssignments,
    dayCloses,
    setDayCloses,
    dayExpenseDrafts,
    setDayExpenseDrafts,
    monthCloses,
    setMonthCloses,
    cobranzaPagosToday,
    setCobranzaPagosToday,
    activities,
    openRef,
    setOpenRef,
    openUserRef,
    setOpenUserRef,
    openCollectorRef,
    setOpenCollectorRef,
    collectorTab,
    setCollectorTab,
    userTab,
    setUserTab,
    confirmUserDelete,
    setConfirmUserDelete,
    openLoanRef,
    setOpenLoanRef,
    fileTab,
    setFileTab,
    confirmDelete,
    setConfirmDelete,
    confirmLoanDelete,
    setConfirmLoanDelete,
    openRouteRef,
    setOpenRouteRef,
    confirmRouteDelete,
    setConfirmRouteDelete,
    listCollectorRef,
    setListCollectorRef,
    listRouteName,
    setListRouteName,
    listDateFrom,
    setListDateFrom,
    listDateTo,
    setListDateTo,
    listQuery,
    setListQuery,
    payMode,
    setPayMode,
    loanTab,
    setLoanTab,
    navigationKey,
    seenKey,
    setSeenKey,
    mobilePreviewCollectorRef,
    setMobilePreviewCollectorRef,
    onPreviewKindChange: setPreviewKind,
    openPaymentRef,
    setOpenPaymentRef,
    paymentReturnView,
    setPaymentReturnView,
    paymentFichaReturn,
    setPaymentFichaReturn,
    openMiscPaymentRef,
    setOpenMiscPaymentRef,
    miscPaymentReturn,
    setMiscPaymentReturn,
    bankAccounts,
    setBankAccounts,
    bankMovements,
    setBankMovements,
    bankReconciliations,
    setBankReconciliations,
    bankPeriod,
    setBankPeriod,
    bankAccountRef,
    setBankAccountRef,
    bankLedgerPeriod,
    setBankLedgerPeriod,
    bankRecordsAccountRef,
    setBankRecordsAccountRef,
    editBankAccountRef,
    setEditBankAccountRef,
    bankLedgerFromReportRef,
    openBankMovementRef,
    setOpenBankMovementRef,
    bankExpenseReturn,
    setBankExpenseReturn,
    miscPayments,
    setMiscPayments,
    prestamoListColumns,
    applyOperationalSnapshot,
    namesTitleCaseDoneRef,
    applyPlanillaSync,
    openClient,
    rawOpenLoan,
    openLoan,
    openUser,
    openCollector,
    catalogRouteList,
    openRoute,
    activeCatalogRoutes,
    filterRouteNames,
    filterCollectors,
    listFilterOptions,
    loanMatchesListFilters,
    routeMatchesListFilters,
    sessionUser,
    canApproveClient,
    accessSession,
    viewAllowed,
    openFicha,
    goFileTab,
    openLoanAccount,
    openPaymentFicha,
    openMiscPaymentFromBank,
    openMiscPaymentFicha,
    openBankExpenseFicha,
    openExpenseFromMovement,
    returnFromBankExpensePanel,
    openBankLedgerFromReport,
    returnFromMiscPaymentPanel,
    openMiscPaymentEdit,
    openUserFicha,
    openUserByCollector,
    goUserTab,
    goCollectorTab,
    syncCollectorLinks,
    openLoanMovement,
    portfolioState,
    applyPortfolioCommit,
    saveEdit,
    saveNew,
    startClientApproval,
    rejectClients,
    deleteClient,
    saveNewLoan,
    saveEditLoan,
    openRouteEdit,
    saveEditRoute,
    toggleRouteActive,
    deleteRoute,
    saveNewRoute,
    assignRouteCollector,
    syncDailyPlanillaFromRoutes,
    generateDailyCollections,
    dispatchToCollectors,
    closeDailyCollections,
    saveCollectorExpensesFromMobile,
    closeCollectorMonthFromMobile,
    closeCollectorDayFromMobile,
    assignDailyCollectionHandler,
    registerCollectorPayment,
    attachPaymentEvidence,
    voidPayment,
    skipCollectorVisit,
    renewLoan,
    createStreetClientFromMobile,
    updateClientFromMobile,
    createQuickLoanFromMobile,
    peopleState,
    applyPeopleCommit,
    toggleCollectorActive,
    deleteUser,
    saveNewUser,
    convertUserToCollector,
    saveEditUser,
    toggleUserActive,
    saveUserPermissions,
    deleteLoan,
    registerPay,
    selectClientLoan,
    goLoanTab,
    startPay,
    demoHydrated,
  };
}
