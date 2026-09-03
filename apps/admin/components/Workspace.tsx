"use client";

import { useEffect, useRef, useState } from "react";
import type { ModuleId } from "@/lib/navigation";
import { CLIENTS, COLLECTORS, ACTIVITY, ADMIN_ROLE_REF, ASSIGNABLE_ROLES, COLLECTOR_ROLE_REF, COLLECTOR_UNASSIGNED_ZONE, DEMO_USER_PASSWORD, activeLoans, loansForClient, LOANS, money, nextClientCode, clientCreationDate, nextCollectorCode, nextLoanCode, nextPaymentCode, nextRouteCode, nextUserCode, normalizeUserPermissions, PAYMENTS, roleByRef, ROLES, ROUTES, routeSlug, catalogRoutes, clientsOnRoute, routeIsActive, routeStatusMeta, userForCollector, USERS, type ClientRow, type CollectorRow, type LoanRow, type PaymentRow, type RouteRow, type UserRow } from "@/lib/mock-data";
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
import { TodayMovementsTable } from "@/components/TodayMovementsTable";
import {
  isoToDispatchLabel,
  isoToDispatchToken,
  todayIso,
} from "@/lib/daily-dispatch";
import { buildDailyCollectionList, type DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  applyPaymentToAssignments,
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
import { DataTable, Kpi, Pill } from "@/components/ui";
import { ClientList } from "@/components/ClientList";
import { HomeDashboard } from "@/components/HomeDashboard";
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
import type { CollectorSkipVisitDraft } from "@/components/CollectorMobileApp";
import { ColumnPicker, ColumnPickerBodyCell, useColumnVisibility } from "@/components/ColumnPicker";
import { LoanPaymentsTable } from "@/components/LoanPaymentsTable";
import {
  PRESTAMO_LIST_COLUMNS,
  PRESTAMO_LIST_DEFAULT_COLS,
} from "@/lib/table-columns";
import { loanStatusPill } from "@/lib/loan-status";
import { chargeLabel, isoToDisplay, normalizeLoan, syncAllLoans, syncLoan } from "@/lib/loan-preview";
import { computeLoanFinancials, loanPaySummaryRows } from "@/lib/loan-balance";
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
import { validatePaymentEvidence } from "@/lib/payment-evidence";
import { applyCollectorPaymentResult, buildRouteStop, type CollectorPaymentDraft } from "@/lib/route-sync";
import { applyPay, cuotaTarget, lineStatus, loanRowAfterPay, paymentRowKind, type PayKind } from "@/lib/loan-pay";
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
  repairMiscPaymentLinks,
  seedBankMovements,
  swapReconciliationDebitCredit,
  syncAllPaymentsToMovements,
  syncMiscPaymentsToMovements,
  syncPaymentsToMovements,
  type BankAccount,
  type BankLedgerKind,
  type BankMovement,
  type BankReconciliation,
} from "@/lib/bank";
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
  loadDemoPaymentsBundle,
  loadDemoUsers,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";

type FileTab = "ficha" | "activos" | "prestamos" | "evidencias";
type LoanTab = "ficha" | "prestamos" | "fechas" | "pagos";

/** Oculta el breadcrumb cuando la vista ya muestra su título en el panel (Listado 10, Activos 8, etc.). */
function shouldHideCrumb(moduleId: ModuleId, viewId: string) {
  if (moduleId === "prestamos") {
    return !["cuenta", "editar", "nuevo", "informe"].includes(viewId);
  }
  if (moduleId === "clientes") {
    return !["ficha"].includes(viewId);
  }
  if (moduleId === "inicio") {
    return !["ficha-usuario", "editar-usuario", "pagos-varios-ficha"].includes(viewId);
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
  const [clients, setClients] = useState<ClientRow[]>(CLIENTS);
  const [loans, setLoans] = useState<LoanRow[]>(() => syncAllLoans(LOANS, PAYMENTS));
  const [payments, setPayments] = useState<PaymentRow[]>(PAYMENTS);
  const [routes, setRoutes] = useState<RouteRow[]>(ROUTES);
  const [collectors, setCollectors] = useState<CollectorRow[]>(COLLECTORS);
  const [users, setUsers] = useState<UserRow[]>(USERS);
  const [dailyLogs, setDailyLogs] = useState<CollectorDailyLogRow[]>(COLLECTOR_DAILY_LOGS_SEED);
  const [dailyAssignments, setDailyAssignments] = useState<DailyCollectionAssignment[]>([]);
  const [cobranzaPagosToday, setCobranzaPagosToday] = useState(false);
  const [activities] = useState(ACTIVITY);
  const [openRef, setOpenRef] = useState(CLIENTS[0]?.ref ?? "");
  const [openUserRef, setOpenUserRef] = useState(USERS[0]?.ref ?? "");
  const [openCollectorRef, setOpenCollectorRef] = useState(COLLECTORS[0]?.ref ?? "");
  const [collectorTab, setCollectorTab] = useState<CollectorTab>("ficha");
  const [userTab, setUserTab] = useState<UserTab>("ficha");
  const [confirmUserDelete, setConfirmUserDelete] = useState(false);
  const [collectorListZone, setCollectorListZone] = useState("");
  const [openLoanRef, setOpenLoanRef] = useState(LOANS[0]?.ref ?? "");
  const [fileTab, setFileTab] = useState<FileTab>("ficha");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLoanDelete, setConfirmLoanDelete] = useState(false);
  const [openRouteRef, setOpenRouteRef] = useState("");
  const [confirmRouteDelete, setConfirmRouteDelete] = useState("");
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
  const bankLedgerFromReportRef = useRef(false);
  const [openBankMovementRef, setOpenBankMovementRef] = useState("");
  const [bankExpenseReturn, setBankExpenseReturn] = useState<{ moduleId: ModuleId; viewId: string } | null>(
    null,
  );
  const [miscPayments, setMiscPayments] = useState<MiscPayment[]>([]);

  const prestamoListColumns = useColumnVisibility(PRESTAMO_LIST_COLUMNS, PRESTAMO_LIST_DEFAULT_COLS, {
    storageKey: "nexo.prestamos.listado.columns",
  });

  useEffect(() => {
    const storedCollectors = readDemoJson(DEMO_COLLECTORS_KEY, COLLECTORS).map((row) => ({
      ...row,
      zone: COLLECTOR_UNASSIGNED_ZONE,
    }));
    const storedAssignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
    const storedRoutes = readDemoJson(DEMO_ROUTES_KEY, ROUTES);
    const storedClients = readDemoJson(DEMO_CLIENTS_KEY, CLIENTS).map(normalizeClientLifecycle);
    const { payments: storedPayments, loans: storedLoans } = loadDemoPaymentsBundle();
    setUsers(loadDemoUsers());
    setClients(storedClients);
    setCollectors(storedCollectors);
    setPayments(storedPayments);
    setLoans(storedLoans);
    writeDemoJson(DEMO_PAYMENTS_KEY, storedPayments);
    setDailyAssignments(storedAssignments);
    setRoutes(rebuildDispatchRoutes(storedRoutes, storedAssignments, storedCollectors, storedLoans, storedClients));
    setDailyLogs(readDemoJson(DEMO_DAILY_LOGS_KEY, COLLECTOR_DAILY_LOGS_SEED));
    const storedAccounts = readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(
      normalizeBankAccount,
    );
    const storedMovements = readDemoJson<BankMovement[] | null>(DEMO_BANK_MOVEMENTS_KEY, null);
    const storedReconciliations = readDemoJson<BankReconciliation[]>(DEMO_BANK_RECONCILIATIONS_KEY, []);
    const sidesVersion = readDemoJson<number>(DEMO_BANK_SIDES_VERSION_KEY, 1);
    const nextReconciliations =
      sidesVersion < 2 ? swapReconciliationDebitCredit(storedReconciliations) : storedReconciliations;
    const nextMovements = storedMovements?.length
      ? normalizeBankMovements(storedMovements)
      : storedAccounts.length
        ? seedBankMovements(storedPayments)
        : [];
    setBankAccounts(storedAccounts);
    setBankMovements(nextMovements);
    setBankReconciliations(nextReconciliations);
    writeDemoJson(DEMO_BANK_SIDES_VERSION_KEY, 2);
    writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, nextReconciliations);
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, nextMovements);
    setBankAccountRef(storedAccounts[0]?.ref ?? "");
    setMiscPayments(readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []));
    setDemoHydrated(true);
  }, []);

  useEffect(() => {
    if (moduleId !== "cobranza" || viewId !== "pagos") {
      setCobranzaPagosToday(false);
    }
  }, [moduleId, viewId]);

  useEffect(() => {
    if (!demoHydrated) return;
    setBankMovements((rows) =>
      normalizeBankMovements(
        syncMiscPaymentsToMovements(miscPayments, repairMiscPaymentLinks(miscPayments, rows)),
      ),
    );
  }, [miscPayments, demoHydrated]);

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
    writeDemoJson(DEMO_CLIENTS_KEY, clients);
  }, [clients, demoHydrated]);

  useEffect(() => {
    if (!demoHydrated) return;
    onNavBadges?.(clientNavBadges(clients));
  }, [clients, demoHydrated, onNavBadges]);

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
    if (!demoHydrated || moduleId !== "banco") return;

    if (viewId === "registros") {
      setBankMovements((rows) => syncAllPaymentsToMovements(payments, rows, bankAccounts));
      return;
    }

    if (viewId !== "extracto" && viewId !== "extracto-pendiente") return;
    if (!bankAccountRef) return;
    setBankMovements((rows) => syncPaymentsToMovements(payments, rows, bankAccountRef, bankPeriod));
  }, [demoHydrated, moduleId, viewId, payments, bankAccountRef, bankPeriod, bankAccounts]);

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

  const openClient = clients.find((row) => row.ref === openRef) ?? clients[0] ?? null;
  const rawOpenLoan = loans.find((row) => row.ref === openLoanRef) ?? loans[0] ?? null;
  const openLoan = rawOpenLoan ? (syncLoan(rawOpenLoan, payments) as LoanRow) : null;
  const openUser = users.find((row) => row.ref === openUserRef) ?? users[0] ?? null;
  const openCollector = collectors.find((row) => row.ref === openCollectorRef) ?? collectors[0] ?? null;
  const catalogRouteList = catalogRoutes(routes);
  const openRoute = catalogRouteList.find((row) => row.ref === openRouteRef) ?? null;
  const activeCatalogRoutes = catalogRouteList.filter(routeIsActive);
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
    setOpenUserRef(userRef);
    const user = users.find((row) => row.ref === userRef);
    if (user?.collectorRef) {
      setOpenCollectorRef(user.collectorRef);
      setCollectorTab(tab as CollectorTab);
    } else {
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
    setOpenCollectorRef(collectorRef);
    setCollectorTab(tab);
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
    setClients((current) =>
      current.map((row) =>
        row.ref === openClient.ref
          ? {
              ...row,
              ...draft,
              ...(approving
                ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
                : {}),
            }
          : row,
      ),
    );
    if (approving) {
      onGo("clientes", "listado");
      onToast("Cliente aprobado y agregado al listado.");
      return;
    }
    onGo("clientes", "ficha");
    onToast("Cliente actualizado.");
  }

  function saveNew(draft: ClientDraft) {
    const ref = nextClientCode(clients.length);
    const review = canApproveClient
      ? { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) }
      : { status: CLIENT_STATUS_REVIEW, kind: clientStatusKind(CLIENT_STATUS_REVIEW) };
    const row: ClientRow = {
      ref,
      alta: clientCreationDate(),
      name: draft.name,
      lastName: draft.lastName,
      document: draft.document,
      city: draft.city,
      barrio: draft.barrio,
      route: draft.route,
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
    setClients((current) => [row, ...current]);
    setOpenRef(ref);
    setFileTab("ficha");
    if (review.status === CLIENT_STATUS_REVIEW) {
      onGo("clientes", "revision");
      onToast("Cliente enviado a pendiente de revisión.");
      return;
    }
    onGo("clientes", "ficha");
    onToast("Cliente creado y activo en el listado.");
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
        mode: "interes",
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
                mode: "interes",
                pact: draft.pact,
                days: draft.days,
                interest: draft.interest,
                total: draft.total,
                installment: draft.installment,
                schedule: draft.schedule,
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
    onToast("Préstamo actualizado.");
  }

  function openRouteEdit(ref: string) {
    setOpenRouteRef(ref);
    setConfirmRouteDelete("");
    onGo("inicio", "editar-ruta");
  }

  function saveEditRoute(draft: RouteDraft) {
    if (!openRoute) return;
    const previousName = openRoute.name;
    setRoutes((current) =>
      current.map((row) =>
        row.ref === openRoute.ref
          ? {
              ...row,
              id: routeSlug(draft.name),
              name: draft.name,
              zone: draft.zone,
              frequency: draft.frequency,
              notes: draft.notes,
            }
          : row,
      ),
    );
    if (draft.name !== previousName) {
      setClients((current) =>
        current.map((client) =>
          client.route === previousName ? { ...client, route: draft.name } : client,
        ),
      );
    }
    onGo("inicio", "lista");
    onToast(`Ruta "${draft.name}" actualizada.`);
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
    const assigned = clientsOnRoute(route.name, clients).length;
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
    if (!draft.name) return;
    const ref = nextRouteCode(catalogRouteList);
    const row: RouteRow = {
      ref,
      id: routeSlug(draft.name),
      name: draft.name,
      collectorRef: "",
      collector: "—",
      zone: draft.zone,
      frequency: draft.frequency,
      notes: draft.notes,
      stops: [],
      clients: 0,
      status: "Activa",
      kind: "ok",
    };
    setRoutes((current) => [...current, row]);
    onGo("inicio", "lista");
    onToast(`Ruta "${draft.name}" creada. Asígnela a clientes al darlos de alta.`);
  }

  function generateDailyCollections(date: string) {
    const count = buildDailyCollectionList(loans, clients, date).length;
    onToast(`${count} cobros listos para ${isoToDispatchLabel(date)}.`);
  }

  function dispatchToCollectors(date: string) {
    if (date < todayIso()) {
      onToast("No se pueden enviar cobros de días anteriores. Use hoy o una fecha futura.");
      return;
    }
    const assigned = dailyAssignments.filter((row) => row.dispatchDate === date);
    if (!assigned.length) {
      onToast("No hay cobros asignados para enviar.");
      return;
    }
    const collectorRefs = [...new Set(assigned.map((row) => row.collectorRef))];
    const at = new Date().toISOString();
    const marked = markAssignmentsDispatched(dailyAssignments, date, collectorRefs, at);

    setRoutes((current) => {
      let next = current;
      for (const collectorRef of collectorRefs) {
        const collector = collectors.find((row) => row.ref === collectorRef);
        if (!collector) continue;
        const existing = next.find((row) => row.ref === dispatchRouteRef(collectorRef, date));
        next = upsertDispatchRoute(
          next,
          buildDispatchRoute(collectorRef, collector.name, date, marked, loans, clients, existing),
        );
      }
      return next;
    });

    setDailyAssignments(marked);

    setDailyLogs((current) => {
      let next = current;
      for (const collectorRef of collectorRefs) {
        const collector = collectors.find((row) => row.ref === collectorRef);
        if (!collector) continue;
        const route = buildDispatchRoute(collectorRef, collector.name, date, marked, loans, clients);
        next = upsertDispatchDailyLog(next, route, date);
      }
      return next;
    });

    const byCollector = new Map<string, number>();
    for (const row of assigned) {
      byCollector.set(row.collector, (byCollector.get(row.collector) ?? 0) + 1);
    }
    const summary = [...byCollector.entries()]
      .map(([name, count]) => `${name}: ${count}`)
      .join(" · ");
    onToast(`Enviado a cobradores · ${summary}. Visible en la app móvil del cobrador.`);
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
    );
    if (!result.collectorsClosed) {
      onToast("No hay rutas enviadas para cerrar en esta fecha.");
      return;
    }
    setDailyAssignments(result.assignments);
    setRoutes(result.routes);
    setDailyLogs(result.logs);
    const parts = [
      `${result.collectorsClosed} cobrador${result.collectorsClosed === 1 ? "" : "es"}`,
      result.skipped
        ? `${result.skipped} no visitado${result.skipped === 1 ? "" : "s"} → mora mañana`
        : null,
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
    const item = buildDailyCollectionList(loans, clients, date).find((row) => row.id === itemId);
    if (!item || item.loanRef !== loanRef) {
      onToast("Cobro no encontrado en la lista del día.");
      return;
    }
    setDailyAssignments((current) => [...current, assignmentFromItem(item, collector, date)]);
    onToast(`Asignado a ${collector.name} · ${isoToDispatchLabel(date)}.`);
  }

  function registerCollectorPayment(draft: CollectorPaymentDraft) {
    const route = routes.find((row) => row.ref === draft.routeRef);
    const loan = loans.find((row) => row.ref === draft.loanRef);
    const keys = new Set(payments.map((row) => row.idempotencyKey).filter(Boolean) as string[]);

    if (keys.has(draft.idempotencyKey)) {
      onToast("Pago ya sincronizado (sin duplicar).");
      return;
    }

    const evidenceError = validatePaymentEvidence(draft.method, draft.evidence);
    if (evidenceError) {
      onToast(evidenceError);
      return;
    }

    const result = applyCollectorPaymentResult(loan!, draft, route!);
    if (!result.ok || !loan || !route) {
      onToast(!result.ok ? result.error : "No se pudo registrar el cobro.");
      return;
    }
    const pay = result.pay;

    const paymentRef = nextPaymentCode(payments);
    const dispatchDate = route.scheduledDate ?? todayIso();
    const paidTime = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    const assignment = dailyAssignments.find(
      (row) =>
        row.loanRef === draft.loanRef &&
        row.collectorRef === draft.collectorRef &&
        row.dispatchDate === dispatchDate,
    );
    const payTarget = cuotaTarget(loan);
    const payment = buildPaymentRow(
      {
        ref: paymentRef,
        loanRef: draft.loanRef,
        when: `${isoToDispatchLabel(dispatchDate)} · ${paidTime}`,
        paidDate: dispatchDate,
        paidTime,
        dueDate: assignment?.chargeDate ?? payTarget?.date,
        chargeLabel: assignment?.chargeLabel ?? (payTarget?.kind ? chargeLabel(payTarget.kind) : undefined),
        client: draft.clientName,
        collector: draft.collectorName,
        collectorRef: draft.collectorRef,
        routeRef: draft.routeRef,
        idempotencyKey: draft.idempotencyKey,
        amount: draft.amount,
        type: pay.type,
        kind: paymentRowKind(pay),
        method: normalizePaymentMethod(draft.method),
        evidence: draft.evidence?.length ? draft.evidence : undefined,
        source: "pwa",
        gps: true,
      },
      loan,
      pay,
    );

    setPayments((current) => {
      const nextPayments = [payment, ...current];
      setLoans((rows) =>
        rows.map((row) =>
          row.ref === loan.ref ? loanRowAfterPay(row, pay, nextPayments) : row,
        ),
      );
      return nextPayments;
    });
    setDailyLogs((current) => upsertDailyLogPayment(current, payment, result.updatedRoute ?? route));
    setDailyAssignments((current) => applyPaymentToAssignments(current, payment, dispatchDate));
    setRoutes((current) =>
      current.map((row) => (row.ref === route.ref ? result.updatedRoute : row)),
    );
    setClients((current) =>
      current.map((entry) => {
        if (entry.ref !== draft.clientRef) return entry;
        return { ...entry, pending: Math.max(0, entry.pending - draft.amount) };
      }),
    );
    onToast(`Cobro ${paymentRef} sincronizado desde móvil.`);
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

  function toggleCollectorActive() {
    if (!openCollector) return;
    const nextActive = !openCollector.active;
    setCollectors((current) =>
      current.map((row) =>
        row.ref === openCollector.ref ? { ...row, active: nextActive } : row,
      ),
    );
    const linked = userForCollector(openCollector.ref, users);
    if (linked) {
      setUsers((current) =>
        current.map((row) => (row.ref === linked.ref ? { ...row, active: nextActive } : row)),
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
      setCollectors((current) => current.filter((row) => row.ref !== collectorRef));
      setRoutes((current) =>
        current.map((route) =>
          route.collectorRef === collectorRef
            ? { ...route, collectorRef: "", collector: "Sin asignar" }
            : route,
        ),
      );
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
    if (user.collectorRef) {
      openUserFicha(userRef);
      return;
    }
    if (!user.active) {
      onToast("Activa el usuario antes de asignarlo como cobrador.");
      return;
    }

    const cobRef = nextCollectorCode(collectors);
    const collector: CollectorRow = {
      ref: cobRef,
      name: user.name,
      zone: COLLECTOR_UNASSIGNED_ZONE,
      phone: user.phone,
      document: user.document,
      active: true,
      userRef: user.ref,
      login: user.login,
      mobileAccess: true,
    };

    setCollectors((current) => [...current, collector]);
    setUsers((current) =>
      current.map((row) =>
        row.ref === userRef
          ? {
              ...row,
              roleRef: COLLECTOR_ROLE_REF,
              collectorRef: cobRef,
              channels: ["mobile"],
              permissions: [...(roleByRef(COLLECTOR_ROLE_REF, ROLES)?.permissions ?? [])],
            }
          : row,
      ),
    );
    onToast(`${user.name} asignado como cobrador ${cobRef}. Ya puede ingresar al celular.`);
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

  function goFromHome(nextModule: ModuleId, nextView?: string) {
    if (nextModule === "cobranza" && nextView === "pagos-hoy") {
      setCobranzaPagosToday(true);
      onGo("cobranza", "pagos");
      return;
    }
    onGo(nextModule, nextView);
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
    if (key === "inicio:resumen") {
      return (
        <HomeDashboard
          adminName={adminName}
          clients={clients}
          loans={loans}
          payments={payments}
          routes={routes}
          collectors={collectors}
          activities={activities}
          onGo={goFromHome}
        />
      );
    }

    if (key === "inicio:hoy") {
      return (
        <>
          <div className="kpis tone-kpis">
            <Kpi label="Clientes activos" value="1.284" hint="+18 esta semana" tone="teal" />
            <Kpi label="Préstamos vigentes" value="936" hint={`Cartera ${money(428900000)}`} tone="sage" />
            <Kpi label="Cobrado hoy" value={money(1840000)} hint="142 operaciones" tone="amber" />
            <Kpi label="Mora" value={money(27650000)} hint="61 créditos" tone="coral" />
          </div>
          <div className="grid-2">
            <TodayMovementsTable
              payments={payments}
              loans={loans}
              onCreate={() => onGo("cobranza", "hoy")}
              onOpenPayment={(ref) =>
                openPaymentFicha(ref, "pagos", { moduleId: "inicio", viewId: "hoy" })
              }
            />
            <section className="panel">
              <div className="head">
                <h2>Rutas en campo</h2>
                <span className="count">{routes.length}</span>
              </div>
              <div className="table-wrap">
                <table className="data routes-table">
                  <colgroup>
                    <col className="routes-col-zone" />
                    <col className="routes-col-assignment" />
                    <col className="routes-col-status" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Zona</th>
                      <th>Asignación</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((row) => (
                      <tr key={row.ref}>
                        <td className="routes-zone">{row.zone}</td>
                        <td className="routes-assignment">
                          {row.collector} · {row.clients} clientes
                        </td>
                        <td>
                          <Pill label={row.status} kind={row.kind} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      );
    }

    if (key === "inicio:alertas") {
      const alerts = buildAlerts(pendingReviewClients(clients).length);
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
            code={nextClientCode(clients.length)}
            routes={activeCatalogRoutes}
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
        { id: "fechas", label: "Fechas de cobro" },
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
            {loanTab === "fechas" && openLoan?.schedule?.length ? (
              <span className="count">{openLoan.schedule.length}</span>
            ) : null}
            {openLoan && (loanTab === "fechas" || loanTab === "pagos") ? (
              <span className="file-title-ref ref">{openLoan.ref}</span>
            ) : null}
            {openLoan &&
            loanTab !== "prestamos" &&
            (loanTab !== "fechas" || canPay || confirmLoanDelete) ? (
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
                    {canPay && loanTab === "fechas" ? (
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
                    {loanTab !== "fechas" ? (
                      <button type="button" className="btn-bar" onClick={() => onGo("prestamos", "informe")}>
                        Ver informe
                      </button>
                    ) : null}
                    {loanTab !== "fechas" ? (
                      <button type="button" className="btn-bar" onClick={() => onGo("prestamos", "editar")}>
                        Modificar
                      </button>
                    ) : null}
                    {loanTab !== "fechas" && loanTab !== "pagos" ? (
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

              {loanTab === "ficha" && openLoan ? <LoanDetailView loan={openLoan} /> : null}

              {loanTab === "prestamos" ? (
                <LoanFichaGrid
                  loans={clientLoans}
                  payments={payments}
                  selectedRef={openLoan?.ref}
                  onSelect={selectClientLoan}
                />
              ) : null}

              {loanTab === "fechas" ? (
                openLoan?.schedule?.length ? (
                  <div className="mini-block loan-fechas-block">
                    <div className="table-wrap pay-dates">
                      <table className="data mini-grid loan-fechas-table">
                        <colgroup>
                          <col className="loan-fechas-col-num" />
                          <col className="loan-fechas-col-date" />
                          <col className="loan-fechas-col-concept" />
                          <col className="loan-fechas-col-amount" />
                          <col className="loan-fechas-col-status" />
                        </colgroup>
                        <thead>
                          <tr className="col-titles">
                            <th>N.º</th>
                            <th>Fecha</th>
                            <th>Concepto</th>
                            <th className="right">A cobrar</th>
                            <th>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openLoan.schedule.map((line, index) => {
                            const state = lineStatus(line);
                            return (
                              <tr key={`${line.kind ?? "pago"}-${line.date}-${index}`}>
                                <td>{index + 1}</td>
                                <td>{isoToDisplay(line.date)}</td>
                                <td>{chargeLabel(line.kind)}</td>
                                <td className="money right">{money(line.amount)}</td>
                                <td>
                                  <Pill label={state.label} kind={state.kind} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="ficha-empty">Este préstamo no tiene fechas de cobro.</p>
                )
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
      const rows =
        viewId === "activos"
          ? loans.filter((row) => row.status !== "Finalizado")
          : viewId === "finalizados"
            ? loans.filter((row) => row.status === "Finalizado")
            : loans;
      return (
        <DataTable
          title={viewLabel}
          count={rows.length}
          fixedColumns
          toolbarEnd={
            <ColumnPicker
              columns={PRESTAMO_LIST_COLUMNS}
              visibleCols={prestamoListColumns.visibleCols}
              onToggle={prestamoListColumns.toggleColumn}
            />
          }
          headers={[
            { t: "Ref", width: "10%" },
            { t: "Cliente", width: "28%" },
            { t: "Desembolso", width: "14%" },
            { t: "Capital", right: true, width: "16%" },
            { t: "Saldo", right: true, width: "16%" },
            { t: "Estado", center: true, width: "16%" },
          ].filter((_, index) => prestamoListColumns.isVisible(PRESTAMO_LIST_COLUMNS[index]!.id))}
          onCreate={() => onGo("prestamos", "nuevo")}
        >
          {rows.map((row) => {
            const synced = syncLoan(row, payments) as LoanRow;
            const status = loanStatusPill(synced);
            const balance = computeLoanFinancials(synced, payments).balancePending;
            return (
            <tr key={row.ref} onClick={() => openLoanAccount(row.ref)}>
              {prestamoListColumns.isVisible("ref") ? <td className="ref">{row.ref}</td> : null}
              {prestamoListColumns.isVisible("client") ? <td>{row.client}</td> : null}
              {prestamoListColumns.isVisible("date") ? <td>{row.date}</td> : null}
              {prestamoListColumns.isVisible("capital") ? (
                <td className="money right">{money(row.capital)}</td>
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
          <NewRouteForm route={openRoute} onCancel={() => onGo("inicio", "lista")} onSave={saveEditRoute} />
        </section>
      );
    }

    if (moduleId === "inicio" && viewId === "nueva-ruta") {
      return (
        <section className="panel">
          <NewRouteForm onCancel={() => onGo("inicio", "lista")} onSave={saveNewRoute} />
        </section>
      );
    }

    if (moduleId === "inicio" && viewId === "lista") {
      return (
        <DataTable
          title="Lista de rutas"
          count={catalogRouteList.length}
          headers={[
            { t: "Código" },
            { t: "Ruta" },
            { t: "Zona" },
            { t: "Clientes" },
            { t: "Frecuencia" },
            { t: "Estado" },
            { t: "Acciones" },
          ]}
          onCreate={() => onGo("inicio", "nueva-ruta")}
        >
          {catalogRouteList.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={7}>Aún no hay rutas creadas.</td>
            </tr>
          ) : (
            catalogRouteList.map((row) => {
              const clientCount = clientsOnRoute(row.name, clients).length;
              const active = routeIsActive(row);
              const deleting = confirmRouteDelete === row.ref;
              return (
                <tr key={row.ref}>
                  <td className="ref">{row.ref}</td>
                  <td>{row.name}</td>
                  <td>{row.zone}</td>
                  <td>{clientCount}</td>
                  <td>{row.frequency}</td>
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
        <DataTable
          title="Asignar clientes a rutas"
          count={clients.length}
          headers={[
            { t: "Código" },
            { t: "Cliente" },
            { t: "Barrio" },
            { t: "Ruta actual" },
            { t: "" },
          ]}
        >
          {clients.map((row) => (
            <tr key={row.ref}>
              <td className="ref">{row.ref}</td>
              <td>
                {row.name} {row.lastName}
              </td>
              <td>{row.barrio || "—"}</td>
              <td>{row.route || "—"}</td>
              <td>
                <button type="button" className="btn-link" onClick={() => openFicha(row.ref)}>
                  Cambiar ruta
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
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
      const linkedCollector = openUser.collectorRef
        ? collectors.find((row) => row.ref === openUser.collectorRef) ?? openCollector
        : null;
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
      if (openUser.collectorRef) {
        const collector =
          collectors.find((row) => row.ref === openUser.collectorRef) ?? openCollector;
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
              collector={collector}
              tab={collectorTab}
              routes={routes}
              clients={clients}
              loans={loans}
              payments={payments}
              activities={activities}
              dailyLogs={dailyLogs}
              dailyAssignments={dailyAssignments}
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
          onOpenCollector={(ref) => openUserByCollector(ref)}
          onOpenZoneList={(zone) => {
            setCollectorListZone(zone);
            onGo("inicio", "listado");
          }}
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
          onOpenExtract={(ref, period) => {
            setBankAccountRef(ref);
            setBankPeriod(period);
            onGo("banco", "extracto");
          }}
          onToast={onToast}
        />
      );
    }

    if (moduleId === "banco" && (viewId === "extracto" || viewId === "extracto-pendiente")) {
      const pending = viewId === "extracto-pendiente";
      return (
        <BankExtractView
          accounts={bankAccounts}
          accountRef={bankAccountRef}
          period={bankPeriod}
          movements={bankMovements}
          reconciliations={bankReconciliations}
          payments={payments}
          miscPayments={miscPayments}
          filterMode={pending ? "pending" : "all"}
          onAccountChange={setBankAccountRef}
          onPeriodChange={setBankPeriod}
          onMovementsChange={setBankMovements}
          onReconciliationsChange={setBankReconciliations}
          onOpenMiscPayment={(ref) =>
            openMiscPaymentFromBank(ref, {
              moduleId: "banco",
              viewId: pending ? "extracto-pendiente" : "extracto",
            })
          }
          onOpenPaymentFicha={(ref) =>
            openPaymentFicha(ref, "pagos", {
              moduleId: "banco",
              viewId: pending ? "extracto-pendiente" : "extracto",
            })
          }
          onOpenExpense={(row) =>
            openExpenseFromMovement(row, {
              moduleId: "banco",
              viewId: pending ? "extracto-pendiente" : "extracto",
            })
          }
          onToast={onToast}
        />
      );
    }

    if (moduleId === "banco" && viewId === "registros") {
      return (
        <BankRecordsHistoryView
          accounts={bankAccounts}
          movements={bankMovements}
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
            setBankAccountRef(accountRef);
            setBankPeriod(period);
            onGo("banco", "extracto-pendiente");
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
          reconciliations={bankReconciliations}
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
      const reportCopy: Record<string, { purpose: string; later: string }> = {
        diarios: {
          purpose: "Informe formal de lo recaudado por día (totales, métodos de pago, cobradores).",
          later: "Distinto de Cobranza → Cobros del día: aquí será consulta SQL + exportación.",
        },
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
      const listUsers = collectorListZone
        ? users.filter((row) => Boolean(row.collectorRef))
        : users;

      return (
        <UserList
          title={collectorListZone ? `Cobradores · clientes en ${collectorListZone}` : "Listado"}
          viewId="listado"
          users={listUsers}
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
          selectedRef={mobilePreviewCollectorRef}
          onSelect={setMobilePreviewCollectorRef}
          assignments={dailyAssignments}
          routes={routes}
          loans={loans}
          clients={clients}
          onRegisterPayment={registerCollectorPayment}
          onSkipVisit={skipCollectorVisit}
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
