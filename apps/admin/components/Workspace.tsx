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
import { flushPaymentMirrorQueue, queuePaymentMirror } from "@/lib/supabase/payment-mirror";
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
  type CollectorPaymentRegisterInput,
} from "@/lib/route-sync";
import {
  dedupeClientsByRef,
  migrateLegacyRouteName,
  normalizeAllRouteOrders,
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
import { commitCollectorPayment, commitCollectorCombinedPayment } from "@/lib/commit-collector-payment";
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
  forgetDeletedRouteRef,
  loadDemoPaymentsBundle,
  loadDemoUsers,
  loadDemoClients,
  loadDemoDayCloses,
  loadDemoBankMovements,
  readDemoJson,
  rememberDeletedRouteRef,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  buildDayExpenseDraft,
  buildMonthCloseRecord,
  dayExpenseLineMovementRef,
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

import { useWorkspace } from "@/components/workspace/useWorkspace";
import type { FileTab, LoanTab, WorkspaceProps } from "@/components/workspace/types";

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
export function Workspace(props: WorkspaceProps) {
  const {
    moduleId,
    viewId,
    viewLabel,
    moduleLabel,
    onGo,
    onToast,
    adminName = "Administrador",
    session,
    onSessionChange,
  } = props;
  const {
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
    onPreviewKindChange,
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
  } = useWorkspace(props);

  if (!viewAllowed) {
    return (
      <AccessDenied
        detail="Tu rol no incluye permiso para esta pantalla."
        onBack={() => onGo("inicio", "resumen")}
      />
    );
  }

  if (!demoHydrated) {
    return <div className="login-screen login-loading" aria-hidden />;
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
            key={openClient.ref}
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
            {fileTab === "ficha" ? (
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
            ) : null}
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
            { t: "Ref", width: "9%", center: true },
            { t: "Cliente", width: "22%", left: true },
            { t: "Desembolso", width: "12%", center: true },
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
              {prestamoListColumns.isVisible("client") ? (
                <td className="is-nombre">{row.client}</td>
              ) : null}
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
          <CarteraGroupView
            mode="cobrador"
            loans={loans}
            payments={payments}
            clients={clients}
            collectors={collectors}
            routes={catalogRouteList}
          />
        );
      }
      if (viewId === "ruta") {
        return (
          <CarteraGroupView
            mode="ruta"
            loans={loans}
            payments={payments}
            clients={clients}
            collectors={collectors}
            routes={catalogRouteList}
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
          onAttachPaymentEvidence={attachPaymentEvidence}
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
          onVoidPayment={voidPayment}
        />
      );
    }

    if (moduleId === "cobranza" && viewId === "anulaciones") {
      return (
        <AnulacionesView
          payments={payments}
          loans={loans}
          onOpenPayment={(ref) => openPaymentFicha(ref, "pagos")}
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
          onAttachPaymentEvidence={attachPaymentEvidence}
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
          onNewAccount={() => {
            setEditBankAccountRef(null);
            onGo("banco", "nueva-cuenta");
          }}
          onEditAccount={(accountRef) => {
            setEditBankAccountRef(accountRef);
            onGo("banco", "nueva-cuenta");
          }}
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
      const editingAccount = editBankAccountRef
        ? bankAccounts.find((row) => row.ref === editBankAccountRef) ?? null
        : null;
      return (
        <BankNewAccountForm
          key={editingAccount?.ref ?? "new"}
          accounts={bankAccounts}
          initialAccount={editingAccount}
          onSave={(account) => {
            const stamped = {
              ...account,
              updatedAt: new Date().toISOString(),
            };
            setBankAccounts((rows) => {
              const idx = rows.findIndex((row) => row.ref === stamped.ref);
              if (idx >= 0) {
                const next = rows.slice();
                next[idx] = stamped;
                return next;
              }
              return [...rows, stamped];
            });
            writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, (() => {
              const current = readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []);
              const idx = current.findIndex((row) => row.ref === stamped.ref);
              if (idx >= 0) {
                const next = current.slice();
                next[idx] = stamped;
                return next;
              }
              return [...current, stamped];
            })());
            queueBankAccountMirror(stamped);
            void flushBankAccountMirrorQueues().catch(() => {
              /* offline: local + cola ya montados */
            });
            setBankAccountRef(stamped.ref);
            setEditBankAccountRef(null);
            onGo("banco", "listado");
            onToast("Cuenta guardada en este PC y en cola a la nube.");
          }}
          onCancel={() => {
            setEditBankAccountRef(null);
            onGo("banco", "listado");
          }}
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
            onAttachPaymentEvidence={attachPaymentEvidence}
          />
        );
      }
      if (viewId === "por-cobrador") {
        return (
          <CollectorRecaudoReportView
            payments={payments}
            loans={loans}
            clients={clients}
            routes={routes}
            assignments={dailyAssignments}
          />
        );
      }
      if (viewId === "cartera") {
        return (
          <CarteraView
            viewId="resumen"
            loans={loans}
            payments={payments}
            clients={clients}
            onOpenClient={openFicha}
            onOpenLoan={openLoanAccount}
            onGo={onGo}
          />
        );
      }
      if (viewId === "mora") {
        return (
          <CarteraView
            viewId="mora"
            loans={loans}
            payments={payments}
            clients={clients}
            onOpenClient={openFicha}
            onOpenLoan={openLoanAccount}
            onGo={onGo}
          />
        );
      }
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
          onUpdateClient={updateClientFromMobile}
          onAttachPaymentEvidence={attachPaymentEvidence}
          onPreviewKindChange={onPreviewKindChange}
        />
      );
    }

    if (moduleId === "inicio" && viewId === "auditoria") {
      return <AuditoriaView payments={payments} users={users} />;
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
            queueMiscPaymentMirror(payment);
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
            queueMiscPaymentMirror(updated);
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

