"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Pill } from "@/components/ui";
import { QuickLoanForm } from "@/components/QuickLoanForm";
import { CollectorClosedDayReview } from "@/components/CollectorClosedDayReview";
import { CollectorDayCloseExtras } from "@/components/CollectorDayCloseExtras";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { buildLoanReport } from "@/lib/loan-report";
import { shareLoanFichaCapture } from "@/lib/loan-ficha-share";
import { routeCoverageSummaries } from "@/lib/collector-preview";
import {
  assignmentRouteName,
  assignmentRoutePositionComparator,
  DAY_CLOSE_SKIP_REASON,
  isNoPayListRow,
  NO_PAY_TODAY_REASON,
} from "@/lib/collector-dispatch-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  buildCollectorHistoryPlanillaRows,
  dayLoanDisbursementRows,
  dayLoanDisbursementTotal,
  expensesWithDayLoans,
  isPrestamoRutaExpense,
  operativeExpenseLines,
  loanRegisteredTimeLabel,
  splitDayExpenses,
  type CollectorHistoryPlanillaRow,
  type DayLoanDisbursementRow,
} from "@/lib/collector-history-planilla";
import {
  collectorDayPayments,
  collectorRecaudoBreakdown,
  visitStatusKind,
  visitStatusLabel,
  visitStatusLabelShort,
} from "@/lib/collector-mobile";
import { todayIso } from "@/lib/daily-dispatch";
import { visiblePlanillaAssignments } from "@/lib/planilla-dedupe";
import { isValidPlanillaAssignment } from "@/lib/planilla-eligibility";
import {
  clientsOnRouteSorted,
  compareClientsByRoutePosition,
  compareRouteNames,
  compareRoutePosition,
  nextRouteOrder,
  routeBlockStarts,
  sameRoute,
} from "@/lib/client-route-order";
import { isOperationalClient } from "@/lib/client-review";
import {
  clientsEligibleForNewLoan,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";
import {
  buildCollectorDayHistory,
  expensesForCollectorDay,
  isLiveCashDay,
  normalizeHistoryDate,
  openingSaldoForPeriod,
  periodFromDateIso,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import { businessTodayIso } from "@/lib/business-timezone";
import {
  enrichSupervisorPlanillaRow,
  paidThousandsLabel,
} from "@/lib/planilla-display";
import { reloanStateForVisit, type ReloanState } from "@/lib/loan-reloan";
import { loanRenewalOf } from "@/lib/loan-renewal-marks";
import { computeLoanCuotasProgress } from "@/lib/loan-cuotas-progress";
import { CuotasProgressCell } from "@/components/CuotasProgressCell";
import { isoToDisplay, displayToIso, syncLoan } from "@/lib/loan-preview";
import { primaryLoanForClient } from "@/lib/route-sync";
import {
  loanDisbursementIsoDate,
  loanDisbursementSource,
  loanDisbursementSourceLabel,
} from "@/lib/nequi-pool";
import { dayDigitalLoanRows, digitalLoanPoolForRoute } from "@/lib/day-digital-loans";
import {
  BANCO_ROUTE_PINS,
  DIGITAL_POOL_LABEL,
  NEQUI_ROUTE_PIN,
  bancoAcumuladoRutas,
  digitalPoolGastos,
  digitalPoolGastosTotal,
  bancoRouteCuadre,
  bancoRouteCobradoHistoryDays,
  bancoRouteHistoryDays,
  bancoRouteHistoryTotals,
  bancoRoutePrestadoHistoryDays,
  nequiRouteHistoryDays,
  digitalPoolDayLedger,
  digitalPoolRegisterDays,
  type DigitalPool,
  type DigitalPoolGasto,
  type DigitalPoolRegisterLoan,
} from "@/lib/digital-pools";
import type { SheetReopenRequest } from "@/lib/save-sheet-reopen";
import { routesToReopen, sheetReopenWindow } from "@/lib/sheet-reopen";
import { readKnownSheetReopens } from "@/lib/supabase/ops-mirror";
import { suppressGhostClick } from "@/lib/suppress-ghost-click";
import { createNavIntent, navButtonProps } from "@/lib/nav-intent";
import {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  paymentCatalogClientName,
  paymentDisplayMethod,
  paymentMethodForRoute,
  paymentMethodInitial,
  paymentMethodLabel,
  paymentMethodToneClass,
  type PaymentMethod,
} from "@/lib/payment-method";
import {
  money,
  catalogRoutes,
  isLoanActive,
  isLoanVoided,
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type StatusKind,
  type UserRow,
} from "@/lib/mock-data";
import {
  ensureRouteDayBaseline,
  markRouteDaySeen,
  playSupervisorPaymentChime,
  unreadPaymentCountForRoute,
} from "@/lib/supervisor-route-alerts";
import {
  indexPaymentEvidenceFromPayments,
  withPaymentEvidence,
} from "@/lib/payment-evidence-store";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import type { BankAccount, BankMovement } from "@/lib/bank";
import { displayToday } from "@/lib/bank";
import { createMiscPayment, type MiscPayment } from "@/lib/misc-payments";
import {
  annotateMHistoryExtractRows,
  applyCollectorCashHandSaldos,
  openingCashForChainedPlanilla,
  PLANILLA_CASH_CHAIN_HISTORY_EPOCH,
  ROUTE_CASH_BOOK_FROM,
  PLANILLA_CASH_CHAIN_PRIMARY,
  PLANILLA_CASH_CHAIN_SECONDARY,
  isPlanillaCashChainPrimary,
  isPlanillaCashChainSecondary,
  stampHistoryWithPlanillaCashChain,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import {
  buildDayCashLedger,
  chainDayCuadre,
  primaryClosingForDay,
  routeDigitalCollected,
  withSealedDaySaldos,
  chainHistorySplit,
  withLedgerTodaySaldo,
  type DayCashLedger,
} from "@/lib/day-cash-ledger";
import {
  attachCashAdjustments,
  cashAdjustmentDelta,
  cashAdjustmentNote,
} from "@/lib/cash-adjustment";
import {
  cashAdjustmentWindow,
  type CashAdjustmentRequest,
} from "@/lib/commit-cash-adjustment";
import {
  attachRouteCashAdjustments,
  independentRouteCollected,
  independentRouteDay,
  independentRouteDayLines,
  isIndependentSaldoRoute,
  routeCashAdjustmentWindow,
  withIndependentRouteHistory,
} from "@/lib/independent-route-cash";
import { CashAdjustForm } from "@/components/CashAdjustForm";
import {
  SupervisorMonthlyReport,
  type InformeEfectivo,
} from "@/components/SupervisorMonthlyReport";
import {
  informeOwnRouteHistory,
  informeRouteHistory,
  type InformeHistory,
  type InformeRouteHistory,
} from "@/lib/informe-route-days";
import { SupervisorOwnRouteReport } from "@/components/SupervisorOwnRouteReport";
import { CollectorNewClientSheet } from "@/components/CollectorNewClientSheet";
import { CollectorConnectionSheet } from "@/components/CollectorConnectionSheet";
import {
  collectorConnection,
  devicesForCollector,
  type CollectorConnection,
  type ConnectionLevel,
} from "@/lib/collector-connection";
import { useDeviceStatuses } from "@/lib/use-device-statuses";
import type { RouteClientDraft } from "@/lib/commit-portfolio-catalog";
/** Fecha corta para listados: 05/09/2026 → 5/9 */
function formatLoanListDate(raw?: string | null) {
  const text = String(raw ?? "").trim();
  if (!text) return "—";
  const m = text.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (!m) return text;
  return `${Number(m[1])}/${Number(m[2])}`;
}

type Props = {
  supervisor: UserRow;
  collectors: CollectorRow[];
  routes: RouteRow[];
  clients: ClientRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  dayExpenseDrafts?: CollectorDayExpenseDraft[];
  dayCloses?: CollectorDayCloseRecord[];
  monthCloses?: CollectorMonthCloseRecord[];
  /** Saldos M↔T (PCE-). A no entra. */
  planillaCashCloses?: PlanillaCashCloseRecord[];
  /** Cuentas activas para Nuevo gasto → Banco registros. */
  bankAccounts?: BankAccount[];
  /** Haber DSB del registro Banco: monta préstamos huérfanos (Albornoz) en el historial. */
  bankMovements?: BankMovement[];
  /** Pagos varios ya montados (para el siguiente PV-). */
  miscPayments?: MiscPayment[];
  /** Nuevo cliente: mismo alta del cobrador (ruta + posición), local + cola + nube. */
  onCreateRouteClient?: (draft: RouteClientDraft) => Promise<boolean> | boolean;
  onCreateQuickLoan?: (draft: QuickLoanDraft) => void;
  /** Editar ficha de cliente desde CLIENTES (raíz + cola nube). */
  onUpdateClient?: (draft: {
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
  }) => void;
  /** Adjuntar constancia a un PG- que quedó sin foto en la nube. */
  onAttachPaymentEvidence?: (paymentRef: string, evidence: PaymentEvidenceRef[]) => void;
  /** Alta de gasto (pago varios) → local + registros banco. */
  onSaveMiscPayment?: (payment: MiscPayment) => void;
  /** Ajuste de saldo real en T o en A/N (tras cerrar, el mismo día). */
  onAdjustTCash?: (input: CashAdjustmentRequest) => Promise<boolean>;
  /** Reabrir la hoja de hoy de un cobrador (cerró por error). Nunca M. */
  onReopenSheet?: (input: SheetReopenRequest) => Promise<boolean>;
  onLogout?: () => void;
};

type SupervisorView =
  | "inicio"
  | "planilla"
  | "informe"
  | "nequi"
  | "banco"
  | "nuevo"
  | "clientes"
  | "prestamos";
type NuevoMode = "menu" | "cliente" | "prestamo" | "gasto";
type CierreListKind =
  | "prestamos"
  | "gastos"
  | "banco"
  | "bancoRuta"
  | "nequiRuta"
  | "efectivo"
  | "efectivoCadena"
  | "bancoCadena"
  | "prestamosCadena"
  | "prestamosBanco"
  | "np";
/** Renglón de la lista de Gastos del Cierre (los demás botones abren la planilla). */
type CierreListLine = { key: string; label: string; amount: number };
const CIERRE_LIST_TITLE: Record<CierreListKind, string> = {
  prestamos: "Préstamos del día",
  gastos: "Gastos del día",
  banco: "Banco T del día",
  bancoRuta: "Banco del día",
  nequiRuta: "Nequi del día",
  efectivo: "Efectivo del día",
  efectivoCadena: "Efectivo M+T del día",
  bancoCadena: "Banco M+T del día",
  prestamosCadena: "Préstamos M+T del día",
  prestamosBanco: "Préstamos B M+T del día",
  np: "N/P del día",
};
const CIERRE_LIST_EMPTY: Record<CierreListKind, string> = {
  prestamos: "Sin préstamos ese día.",
  gastos: "Sin gastos ese día.",
  banco: "Sin cobros Banco en T ese día.",
  bancoRuta: "Sin cobros Banco ese día.",
  nequiRuta: "Sin cobros Nequi ese día.",
  efectivo: "Sin cobros en efectivo ese día.",
  efectivoCadena: "Sin cobros en efectivo en M ni T ese día.",
  bancoCadena: "Sin cobros Banco en M ni T ese día.",
  prestamosCadena: "Sin préstamos en efectivo en M ni T ese día.",
  prestamosBanco: "Sin préstamos del Banco ese día.",
  np: "Sin N/P ese día.",
};
type RouteDetailMode =
  | "totales"
  | "planilla"
  | "prestamos"
  | "renovados"
  | "gastos"
  | "cobros"
  | "historial"
  | "historial-dia"
  | "np"
  | "np-dia"
  | "nequi-historial"
  | "nequi-dia";

const SUPERVISOR_NAV_KEY = "nexo-supervisor-mobile-nav";
const SUPERVISOR_VIEWS: SupervisorView[] = [
  "inicio",
  "planilla",
  "nequi",
  "banco",
  "nuevo",
  "clientes",
  "informe",
  "prestamos",
];

function readSupervisorNav(): { view: SupervisorView; openRouteRef: string | null } {
  if (typeof window === "undefined") return { view: "inicio", openRouteRef: null };
  try {
    const raw = sessionStorage.getItem(SUPERVISOR_NAV_KEY);
    if (!raw) return { view: "inicio", openRouteRef: null };
    const parsed = JSON.parse(raw) as { view?: string; openRouteRef?: string | null };
    const rawView = parsed.view === "caja" ? "informe" : parsed.view;
    const view = SUPERVISOR_VIEWS.includes(rawView as SupervisorView)
      ? (rawView as SupervisorView)
      : "inicio";
    return {
      view,
      openRouteRef: typeof parsed.openRouteRef === "string" ? parsed.openRouteRef : null,
    };
  } catch {
    return { view: "inicio", openRouteRef: null };
  }
}

function writeSupervisorNav(view: SupervisorView, openRouteRef: string | null) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      SUPERVISOR_NAV_KEY,
      JSON.stringify({ view, openRouteRef }),
    );
  } catch {
    /* ignore quota */
  }
}

/** Al entrar a un panel con pins: siempre ruta 1 (o la primera si no hay 1). */
function pickDefaultRoutePin(pins: string[]): string | null {
  if (!pins.length) return null;
  return pins.find((name) => sameRoute(name, "1")) ?? pins[0];
}

type RouteLiquidacion = {
  routeRef: string;
  routeName: string;
  collectorRef: string;
  collectorName: string;
  clients: number;
  planilla: number;
  pending: number;
  done: number;
  saldoInicial: number;
  cobradoHoy: number;
  cobradoEfectivo: number;
  cobradoNequi: number;
  cobradoBanco: number;
  /** Gastos operativos (sin préstamos de ruta). */
  gastosHoy: number;
  /** Capital prestado hoy en esta ruta (efectivo / caja). */
  prestamosHoy: number;
  /** Filas de desembolso en caja (misma fuente que prestamosHoy). */
  cashLoansToday: DayLoanDisbursementRow[];
  enCaja: number;
  closed: boolean;
  newLoans: LoanRow[];
  renewals: LoanRow[];
  statusLabel: string;
  statusKind: StatusKind;
};

function LiquidacionTable({
  rows,
  onOpen,
}: {
  rows: RouteLiquidacion[];
  onOpen: (routeRef: string) => void;
}) {
  return (
    <div className="supervisor-liq-wrap">
      <table className="supervisor-liq-table">
        <thead>
          <tr>
            <th className="is-ruta">Ruta</th>
            <th className="is-nombre">Nombre</th>
            <th className="is-num">Inicial</th>
            <th className="is-num">Cobrado</th>
            <th className="is-num">Gastos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.routeRef}>
              <td className="is-ruta">
                <button
                  type="button"
                  className="supervisor-liq-link"
                  onClick={() => onOpen(row.routeRef)}
                  title={`Ver ${row.routeName}`}
                >
                  {row.routeName}
                </button>
              </td>
              <td className="is-nombre">
                <button
                  type="button"
                  className="supervisor-liq-link"
                  onClick={() => onOpen(row.routeRef)}
                  title={row.collectorName}
                >
                  {row.collectorName}
                </button>
              </td>
              <td className="is-num">{money(row.saldoInicial, { symbol: false })}</td>
              <td className="is-num">{money(row.cobradoHoy, { symbol: false })}</td>
              <td className="is-num">{money(row.gastosHoy, { symbol: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RouteBoardCard({
  row,
  accent,
  onOpen,
  mode = "ruta",
  tone,
  unreadCount = 0,
  connectionLevel,
  onConnection,
}: {
  row: RouteLiquidacion;
  accent: number;
  onOpen: (routeRef: string) => void;
  /** Punto de conexión del cobrador (solo INICIO). */
  connectionLevel?: ConnectionLevel;
  onConnection?: () => void;
  /** En vista caja siempre destaca el dinero en mano. */
  mode?: "ruta" | "caja" | "nequi" | "banco";
  /** Color del panel (Nequi / Banco). Sin tono = el del `mode`. */
  tone?: "nequi" | "banco";
  /** Cobros nuevos del día aún no revisados por el supervisor. */
  unreadCount?: number;
}) {
  const colorMode = tone ?? mode;
  const total = row.planilla || 0;
  const pct = total > 0 ? Math.round((row.done / total) * 100) : 0;
  const showRouteShell = mode === "ruta";
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const moneyMode = mode === "caja" || mode === "nequi" || mode === "banco";
  const heroAmount =
    mode === "nequi"
      ? row.cobradoNequi
      : mode === "banco"
        ? row.cobradoBanco
        : row.enCaja;
  const withConnection = Boolean(connectionLevel && onConnection);

  const card = (
    <button
      type="button"
      className={`supervisor-route-board accent-${accent % 2}${row.closed || row.statusKind === "closed" ? " is-closed" : ""}${mode === "caja" ? " is-caja-mode" : ""}${colorMode === "nequi" ? " is-nequi-mode" : ""}${colorMode === "banco" ? " is-banco-mode" : ""}${unreadCount > 0 ? " has-unread" : ""}`}
      onClick={() => onOpen(row.routeRef)}
    >
      {moneyMode ? (
        <div className="supervisor-caja-row">
          <div className="supervisor-route-board-id">
            <span className="supervisor-route-board-ruta">Ruta {row.routeName}</span>
            <strong className="supervisor-route-board-name">
              {row.collectorName}
              {unreadCount > 0 ? (
                <span
                  className="supervisor-route-unread is-pulse"
                  title={`${unreadCount} cobro${unreadCount === 1 ? "" : "s"} nuevo${unreadCount === 1 ? "" : "s"}`}
                >
                  {unreadLabel}
                </span>
              ) : null}
            </strong>
          </div>
          <div
            className={`supervisor-caja-hero is-row${colorMode === "nequi" ? " is-nequi" : ""}${colorMode === "banco" ? " is-banco" : ""}`}
          >
            <b>{money(heroAmount, { symbol: false })}</b>
          </div>
        </div>
      ) : (
        <>
          <div className="supervisor-caja-row">
            <div className="supervisor-route-board-id">
              <div className="supervisor-route-board-ruta-row">
                <span className="supervisor-route-board-ruta">Ruta {row.routeName}</span>
                {row.statusLabel ? (
                  <Pill label={row.statusLabel} kind={row.statusKind} />
                ) : null}
              </div>
              <strong className="supervisor-route-board-name">
                {row.collectorName}
                {unreadCount > 0 ? (
                  <span
                    className="supervisor-route-unread is-pulse"
                    title={`${unreadCount} cobro${unreadCount === 1 ? "" : "s"} nuevo${unreadCount === 1 ? "" : "s"}`}
                  >
                    {unreadLabel}
                  </span>
                ) : null}
              </strong>
            </div>
            <div className="supervisor-caja-hero is-row is-money-lg">
              <b>{money(row.enCaja, { symbol: false })}</b>
            </div>
          </div>

          {showRouteShell ? (
            <div className="supervisor-route-board-progress" aria-hidden>
              <div className="supervisor-route-board-bar">
                <span style={{ width: `${total > 0 ? pct : 0}%` }} />
              </div>
              <em>
                {total > 0
                  ? `${row.done}/${total} · ${pct}%`
                  : row.closed
                    ? "Cerrado"
                    : "Sin planilla"}
              </em>
            </div>
          ) : null}

          <div
            className={`supervisor-route-board-metrics is-four${withConnection ? " has-conn-dot" : ""}`}
          >
            <div>
              <span>Inicial</span>
              <b>{money(row.saldoInicial, { symbol: false })}</b>
            </div>
            <div>
              <span>Cobrado</span>
              <b>{money(row.cobradoHoy, { symbol: false })}</b>
            </div>
            <div className="is-metric-prestamo">
              <span>Préstamo</span>
              <b>{money(row.prestamosHoy, { symbol: false })}</b>
            </div>
            <div>
              <span>Gasto</span>
              <b>{money(row.gastosHoy, { symbol: false })}</b>
            </div>
          </div>
        </>
      )}
    </button>
  );
  if (!connectionLevel || !onConnection) return card;
  return (
    <div className="supervisor-route-board-wrap">
      {card}
      <button
        type="button"
        className="conn-dot-btn"
        onClick={onConnection}
        aria-label={`Conexión de ${row.collectorName}`}
        title="Conexión del cobrador"
      >
        <span className={`conn-dot is-${connectionLevel}`} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Fila de planilla con su ruta (raya verde donde cambia: Ruta 1 → Ruta 1.1) y el
 * estado «Préstamo al terminar» (terminó hoy → botón; ya prestado → renglón azul).
 */
type PlanillaTableRow = ReturnType<typeof enrichSupervisorPlanillaRow> & {
  route: string;
  clientRef: string;
  loanRef: string;
  reloan: ReloanState;
};

function PlanillaTable({
  rows,
  onReloan,
  reloanClientRef,
}: {
  rows: PlanillaTableRow[];
  /** Presente solo donde el supervisor puede prestar (Caja → ruta → planilla). */
  onReloan?: (clientRef: string) => void;
  reloanClientRef?: string | null;
}) {
  const routeStarts = routeBlockStarts(rows, (row) => row.route);
  return (
    <div className="supervisor-liq-wrap">
      <table className="supervisor-liq-table supervisor-planilla-table">
        <thead>
          <tr>
            <th className="is-ruta">#</th>
            <th className="is-nombre">Nombre</th>
            <th className="is-num">Saldo</th>
            <th className="is-metodo">Método</th>
            <th className="is-cuotas">Mora</th>
            <th className="is-estado">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const method = row.method ?? null;
            const methodLabel = row.methodLabel ?? (method ? paymentMethodInitial(method) : null);
            const methodTone =
              row.methodToneClass ||
              (method ? paymentMethodToneClass(method) : "");
            const methodTitle =
              row.methodTitle ?? (method ? paymentMethodLabel(method) : undefined);
            const cuotas = row.cuotas ?? {
              label: "",
              intensity: 0,
              title: "",
              expected: 0,
              paid: 0,
              total: 0,
              covered: 0,
              paidTotal: 0,
              installment: 0,
              lagDays: 0,
            };
            const reloanOpen = Boolean(reloanClientRef) && reloanClientRef === row.clientRef;
            /** Renglón del préstamo nuevo; el del crédito pagado muestra solo lo cobrado. */
            const grantedHere =
              row.reloan.granted &&
              (row.loanRef === row.reloan.granted.ref || row.paidAmount <= 0)
                ? row.reloan.granted
                : null;
            const rowClass = [
              routeStarts[index] ? "is-route-start" : "",
              grantedHere ? "is-reloan" : "",
              row.reloan.renewed ? "is-renewed" : "",
              row.awaitingLoan ? "is-awaiting-loan" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr key={row.key} className={rowClass || undefined}>
                <td className="is-ruta">{row.index}</td>
                <td className="is-nombre" title={row.clientName}>
                  {row.clientName}
                </td>
                <td className="is-num">
                  {row.awaitingLoan ? (
                    "—"
                  ) : grantedHere ? (
                    <span className="supervisor-planilla-saldo-new">
                      {money(row.saldo, { symbol: false })}
                    </span>
                  ) : (
                    money(row.saldo, { symbol: false })
                  )}
                </td>
                <td className="is-metodo">
                  {grantedHere && !row.awaitingLoan && row.paidAmount <= 0 ? (
                    <em className="supervisor-planilla-method is-pay-prestamo" title="Préstamo nuevo">
                      P
                    </em>
                  ) : row.reloan.renewed ? (
                    <em className="supervisor-planilla-method is-pay-renovado" title="Renovado: sin plata">
                      R
                    </em>
                  ) : methodLabel &&
                  (row.visitStatus === "cobrado" || row.visitStatus === "parcial") ? (
                    <em
                      className={`supervisor-planilla-method ${methodTone}`}
                      title={methodTitle}
                    >
                      {methodLabel}
                    </em>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="is-cuotas">
                  {row.awaitingLoan ? "—" : <CuotasProgressCell progress={cuotas} />}
                </td>
                <td className="is-estado">
                  {row.awaitingLoan ? (
                    <span className="supervisor-prestar-tag" title="Sin préstamo · listo para prestar">
                      Prestar
                    </span>
                  ) : onReloan && row.reloan.canReloan ? (
                    <button
                      type="button"
                      className={reloanOpen ? "supervisor-reloan-btn on" : "supervisor-reloan-btn"}
                      title="Terminó su crédito: prestarle ahora (Nequi / Banco)"
                      aria-expanded={reloanOpen}
                      onClick={() => onReloan(row.clientRef)}
                    >
                      Préstamo
                    </button>
                  ) : grantedHere ? (
                    <em
                      className="supervisor-planilla-method is-pay-prestamo"
                      title={`Préstamo ${grantedHere.ref} · capital ${money(grantedHere.capital)}`}
                    >
                      {paidThousandsLabel(grantedHere.capital)}
                    </em>
                  ) : row.reloan.renewed ? (
                    <span
                      className="supervisor-reloan-tag is-renewal"
                      title={`Renovado ${row.reloan.renewed.ref} · debía ${money(row.reloan.renewed.capital)} + 20 % · sin plata · cuota desde mañana`}
                    >
                      Renovado {money(row.reloan.renewed.capital, { symbol: false })}
                    </span>
                  ) : (
                    <span
                      style={
                        row.paidParts.length >= 2 ? { display: "inline-flex", gap: 2 } : undefined
                      }
                      title={
                        row.paidAmount > 0
                          ? `${visitStatusLabel(row.visitStatus)} · ${money(row.paidAmount)}`
                          : visitStatusLabel(row.visitStatus)
                      }
                    >
                      {row.paidParts.length >= 2 ? (
                        row.paidParts.map((part, partIndex) => (
                          <em
                            key={`${part.method}-${partIndex}`}
                            className={`supervisor-planilla-method ${paymentMethodToneClass(part.method)}`}
                            title={`${paymentMethodLabel(part.method)} · ${money(part.amount)}`}
                          >
                            {paidThousandsLabel(part.amount)}
                          </em>
                        ))
                      ) : (
                        <Pill
                          label={
                            row.paidAmount > 0
                              ? paidThousandsLabel(row.paidAmount)
                              : visitStatusLabelShort(row.visitStatus)
                          }
                      kind={visitStatusKind(row.visitStatus)}
                    />
                      )}
                  </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Lista de clientes para app supervisor: # (ruta), nombre, mora, saldo vivo. */
function ClientesTable({
  rows,
  onOpen,
}: {
  rows: Array<{
    ref: string;
    route: string;
    routeOrder: number;
    name: string;
    phone: string;
    cuotas: ReturnType<typeof computeLoanCuotasProgress>;
    saldo: number | null;
    hasLoan: boolean;
  }>;
  onOpen?: (clientRef: string) => void;
}) {
  const routeStarts = routeBlockStarts(rows, (row) => row.route);
  return (
    <div className="supervisor-liq-wrap">
      <table className="supervisor-liq-table supervisor-clientes-table">
        <thead>
          <tr>
            <th className="is-ruta">#</th>
            <th className="is-nombre">Nombre</th>
            <th className="is-cuotas">Mora</th>
            <th className="is-num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const awaitingLoan = !row.hasLoan;
            return (
              <tr
                key={row.ref}
                className={
                  [
                    onOpen ? "is-clickable" : "",
                    routeStarts[index] ? "is-route-start" : "",
                    awaitingLoan ? "is-awaiting-loan" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                onClick={onOpen ? () => onOpen(row.ref) : undefined}
              >
                <td className="is-ruta">{row.routeOrder > 0 ? row.routeOrder : index + 1}</td>
                <td className="is-nombre" title={row.name}>
                  {row.name}
                </td>
                <td className="is-cuotas">
                  {awaitingLoan ? (
                    <span className="supervisor-prestar-text" title="Sin préstamo · listo para prestar">
                      Préstamo
                  </span>
                  ) : (
                    <CuotasProgressCell progress={row.cuotas} />
                  )}
                </td>
                <td className="is-num">
                  {awaitingLoan
                    ? "—"
                    : row.saldo != null
                    ? money(row.saldo, { symbol: false })
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Préstamo activo actual (con saldo), sincronizado con todos los pagos del sistema. */
function currentActiveLoan(
  clientRef: string,
  loans: LoanRow[],
  payments: PaymentRow[],
): LoanRow | null {
  const raw = primaryLoanForClient(clientRef, loans);
  if (!raw) return null;
  const synced = syncLoan(raw, payments) as LoanRow;
  if (!isLoanActive(synced) || synced.balance <= 0) return null;
  return synced;
}

/** Ficha del cliente/préstamo dentro del teléfono (luego se afina legibilidad). */
function fichaClientTitle(report: ReturnType<typeof buildLoanReport>) {
  const base = report.clientName.trim().replace(/\s+/g, " ");
  return base || report.loan.client.trim() || "Cliente";
}

function SupervisorClientFicha({
  report,
  onBack,
}: {
  report: ReturnType<typeof buildLoanReport>;
  onBack: () => void;
}) {
  const shareRootRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const f = report.financials;
  const clientTitle = fichaClientTitle(report);
  const cobro =
    f.installment > 0
      ? money(f.installment, { symbol: false })
      : "—";
  const cuotas =
    f.installmentsTotal > 0
      ? `${f.installmentsPaid} / ${f.installmentsTotal}`
      : String(f.installmentsPaid);
  const capital = money(report.loan.capital, { symbol: false });
  const interes = money(f.interestTerm, { symbol: false });
  const total = money(
    f.totalAgreement || report.loan.total || report.loan.capital + f.interestTerm,
    { symbol: false },
  );

  const factPairs: Array<[{ label: string; value: string }, { label: string; value: string }?]> = [
    [
      { label: "Cédula", value: report.client?.document?.trim() || "—" },
      { label: "Teléfono", value: report.client?.phone?.trim() || "—" },
    ],
    [
      { label: "Desembolso", value: report.loan.date || "—" },
      { label: "Vencimiento", value: report.loan.due || "—" },
    ],
    [
      { label: "Valor cobro", value: cobro },
      { label: "Cuotas", value: cuotas },
    ],
    [
      { label: "Capital", value: capital },
      { label: "Interés", value: interes },
    ],
    [{ label: "Total a cobrar", value: total }],
  ];

  async function handleShare() {
    const root = shareRootRef.current;
    if (!root || sharing) return;
    setSharing(true);
    try {
      await shareLoanFichaCapture(root, report);
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="supervisor-client-ficha" ref={shareRootRef}>
      <div className="supervisor-mobile-detail-head supervisor-ficha-share-head">
        <h3 className="supervisor-ficha-client-name" title={clientTitle}>
          {clientTitle}
        </h3>
        <div className="supervisor-ficha-head-actions">
          <button
            type="button"
            className="collector-mobile-pay-link is-share"
            disabled={sharing}
            onClick={() => {
              void handleShare();
            }}
          >
            {sharing ? "…" : "Compartir"}
          </button>
          <button type="button" className="collector-mobile-pay-link is-back" onClick={onBack}>
          volver
        </button>
        </div>
      </div>

      <div className="supervisor-client-ficha-block">
        <dl className="supervisor-client-ficha-facts">
          {factPairs.map((pair) => {
            const [left, right] = pair;
            if (!right) {
              return (
                <div key={left.label} className="supervisor-client-ficha-row is-single">
                  <div className="supervisor-client-ficha-cell">
                    <dt>{left.label}</dt>
                    <dd>{left.value}</dd>
                  </div>
                </div>
              );
            }
            return (
              <div key={left.label} className="supervisor-client-ficha-row">
                <div className="supervisor-client-ficha-cell">
                  <dt>{left.label}</dt>
                  <dd>{left.value}</dd>
                </div>
                <div className="supervisor-client-ficha-cell">
                  <dt>{right.label}</dt>
                  <dd>{right.value}</dd>
                </div>
              </div>
            );
          })}
        </dl>
      </div>

      <h4 className="supervisor-client-ficha-title">Movimientos</h4>
      <div className="supervisor-client-ficha-block">
        {report.movements.length === 0 ? (
          <p className="ficha-empty">Sin movimientos registrados.</p>
        ) : (
          <ul className="supervisor-client-ficha-moves">
            <li className="is-head" aria-hidden>
              <span className="is-amount">Monto</span>
              <span className="is-date">Fecha</span>
              <span className="is-time">Hora</span>
              <span className="is-method">M</span>
            </li>
            {report.movements.map((row) => {
              const method = paymentMethodForRoute(row.method, report.client?.route);
              return (
              <li key={row.ref}>
                <span className="is-amount">{money(row.amount, { symbol: false })}</span>
                <span className="is-date">{row.paidDate || "—"}</span>
                <span className="is-time">{row.paidTime || "—"}</span>
                  <span
                    className={`is-method ${paymentMethodToneClass(method)}`}
                    title={paymentMethodLabel(method)}
                  >
                    {paymentMethodInitial(method)}
                  </span>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="supervisor-client-ficha-sum">
        <div>
          <span>Total préstamo</span>
          <b>{total}</b>
        </div>
        <div>
          <span>Ya pagado</span>
          <b>{money(f.paidTotal, { symbol: false })}</b>
        </div>
        <div className="is-rest">
          <span>Resta por pagar</span>
          <b>{money(f.balancePending, { symbol: false })}</b>
        </div>
      </div>

      <p className="supervisor-client-ficha-foot">{report.generatedLabel}</p>
    </div>
  );
}

function isRenewalLoan(loan: LoanRow) {
  return Boolean(loanRenewalOf(loan));
}

function cajaDelDia(
  collector: CollectorRow,
  date: string,
  payments: PaymentRow[],
  dayCloses: CollectorDayCloseRecord[],
  dayExpenseDrafts: CollectorDayExpenseDraft[],
  monthCloses: CollectorMonthCloseRecord[],
) {
  const period = periodFromDateIso(date);
  const history = buildCollectorDayHistory(
    collector.ref,
    payments,
    dayCloses,
    [collector],
    [date],
    dayExpenseDrafts,
    monthCloses,
    period,
  );
  // history viene más reciente primero; el arrastre es el saldo del día previo.
  const prior = history
    .filter((row) => row.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const saldoInicial =
    prior.length > 0
      ? prior[prior.length - 1].saldo
      : openingSaldoForPeriod(collector.ref, period, monthCloses);
  const todayRow = history.find((row) => row.date === date);
  const breakdown = collectorRecaudoBreakdown(collector.ref, date, payments, [collector]);
  const cobradoHoy = todayRow?.cobro ?? breakdown.total;
  const cobradoEfectivo = todayRow?.cobroEfectivo ?? breakdown.efectivo;
  const cobradoNequi = todayRow?.cobroNequi ?? breakdown.nequi;
  const cobradoBanco = breakdown.banco;
  const gastosHoy = todayRow?.gasto ?? 0;
  // En caja = arrastre + solo efectivo − gastos (Nequi/Banco no entran a mano del cobrador).
  const enCaja = todayRow?.saldo ?? saldoInicial + cobradoEfectivo - gastosHoy;
  return {
    saldoInicial,
    cobradoHoy,
    cobradoEfectivo,
    cobradoNequi,
    cobradoBanco,
    gastosHoy,
    enCaja,
  };
}

function snSkipLabel(row: DailyCollectionAssignment) {
  if (row.skipReason === NO_PAY_TODAY_REASON) return "Hoy no tiene plata";
  if (row.skipReason === DAY_CLOSE_SKIP_REASON) return "Quedó al cierre";
  return "Sin pago";
}

function SnPeople({
  rows,
  empty,
  dateLabel,
}: {
  rows: DailyCollectionAssignment[];
  empty: string;
  dateLabel: string;
}) {
  if (rows.length === 0) return <p className="ficha-empty">{empty}</p>;
  return (
    <ul className="supervisor-sn-list" aria-label="No pagan">
      {rows.map((item) => (
        <li key={`${item.dispatchDate}-${item.itemId}`}>
          <b>{item.clientName || "Cliente"}</b>
          <small>{dateLabel}</small>
          <em>{snSkipLabel(item)}</em>
        </li>
      ))}
    </ul>
  );
}

/** Informe «Angélica»: la planilla A (caja propia, cobra por Nequi). */
const INFORME_A_ROUTE = "A";

/** Lista omitida = la misma referencia siempre (`= []` nuevo por render dispara los efectos sin fin). */
const NO_ROWS: never[] = [];

/** App móvil del supervisor: caja + planilla + préstamos/renovaciones en vivo. */
export function SupervisorMobileApp({
  supervisor,
  collectors,
  routes,
  clients,
  loans,
  payments,
  assignments,
  dayExpenseDrafts = NO_ROWS,
  dayCloses = NO_ROWS,
  monthCloses = NO_ROWS,
  planillaCashCloses = NO_ROWS,
  bankAccounts = NO_ROWS,
  bankMovements = NO_ROWS,
  miscPayments = NO_ROWS,
  onCreateRouteClient,
  onCreateQuickLoan,
  onUpdateClient,
  onAttachPaymentEvidence,
  onSaveMiscPayment,
  onAdjustTCash,
  onReopenSheet,
  onLogout,
}: Props) {
  const today = todayIso();
  const todayDisplay = isoToDisplay(today);
  const navIntent = useMemo(() => createNavIntent(), []);
  /** Regla: al ingresar siempre INICIO (no restaurar otra pestaña). */
  const [view, setView] = useState<SupervisorView>("inicio");
  const [openRouteRef, setOpenRouteRef] = useState<string | null>(null);
  /** Cliente que terminó hoy con el formulario «Préstamo» abierto (Caja → ruta → planilla). */
  const [reloanClientRef, setReloanClientRef] = useState<string | null>(null);
  /** Panel al que vuelve al salir del detalle de ruta (inicio / caja / nequi). */
  const [routeReturnView, setRouteReturnView] = useState<SupervisorView>("inicio");
  const [detailMode, setDetailMode] = useState<RouteDetailMode>("totales");
  const [cobrosMethodFilter, setCobrosMethodFilter] = useState<PaymentMethod | null>(null);
  /** Día ISO seleccionado en historial Nequi de una ruta. */
  const [nequiDayIso, setNequiDayIso] = useState<string | null>(null);
  const [nequiDayBackTo, setNequiDayBackTo] = useState<"totales" | "nequi-historial">(
    "nequi-historial",
  );
  /** Día ISO del historial de caja (últimos 5 días del cobrador). */
  const [cajaHistoryDayIso, setCajaHistoryDayIso] = useState<string | null>(null);
  /** Historial · T: formulario de ajuste de saldo real abierto (cobrador del CIE-). */
  const [cashAdjustCollectorRef, setCashAdjustCollectorRef] = useState<string | null>(null);
  /** BANCO / NEQUI: cuadre del total acumulado abierto. */
  /** «Reabrir hoja de hoy»: confirmación abierta (clave cobrador|ruta) y envío en curso. */
  const [reopenConfirmKey, setReopenConfirmKey] = useState<string | null>(null);
  const [reopeningSheet, setReopeningSheet] = useState(false);
  const [snDay, setSnDay] = useState<string | null>(null);
  /** Registro Nequi de hoy filtrado por ruta (1 / 1.1 / 2). */
  const [nequiRegistroRoute, setNequiRegistroRoute] = useState<string | null>(null);
  /** Registro Banco filtrado por ruta (M / T / N). null = cuatro botones de saldo. */
  const [bancoRegistroRoute, setBancoRegistroRoute] = useState<string | null>(null);
  /** Listado de gastos pagados desde la cuenta Banco. */
  const [bancoGastosOpen, setBancoGastosOpen] = useState(false);
  /** Historial desplegado: solo cobrado o solo prestado. */
  const [bancoRutaExpand, setBancoRutaExpand] = useState<"cobrado" | "prestado" | null>(null);
  /** Un solo día abierto en el historial (acordeón). */
  const [bancoRegistroDay, setBancoRegistroDay] = useState<string | null>(null);
  /** Historial Nequi (ruta A): cobrado o prestado. */
  const [nequiRutaExpand, setNequiRutaExpand] = useState<
    "cobrado" | "prestado" | "gastos" | null
  >(null);
  /** Un solo día abierto en el historial Nequi (acordeón). */
  const [nequiRegistroDay, setNequiRegistroDay] = useState<string | null>(null);
  const [nuevoMode, setNuevoMode] = useState<NuevoMode>("menu");
  const [nuevoRouteRef, setNuevoRouteRef] = useState<string | null>(null);
  const [gastoLabel, setGastoLabel] = useState("Gasto");
  const [gastoAmount, setGastoAmount] = useState("");
  const [gastoAccountRef, setGastoAccountRef] = useState("");
  const [gastoMethod, setGastoMethod] = useState<PaymentMethod>("efectivo");
  const [gastoDate, setGastoDate] = useState(() => displayToday());
  const [nuevoMsg, setNuevoMsg] = useState("");
  const [nuevoClientSearch, setNuevoClientSearch] = useState("");
  const [nuevoLoanClientRef, setNuevoLoanClientRef] = useState<string | null>(null);
  /** null = todas las rutas; string = nombre de ruta filtrada en planilla. */
  const [planillaRouteFilter, setPlanillaRouteFilter] = useState<string | null>(null);
  const [clientesRouteFilter, setClientesRouteFilter] = useState<string | null>(null);
  const [clientesLoanClientRef, setClientesLoanClientRef] = useState<string | null>(null);
  /** CLIENTES → modificar: elegir de la lista y editar ficha en la misma hoja. */
  const [clientesModifyMode, setClientesModifyMode] = useState(false);
  const [clientesEditRef, setClientesEditRef] = useState<string | null>(null);
  const [clientesEditSearch, setClientesEditSearch] = useState("");
  /** Lupa de Clientes: abre el buscador sin entrar a Modificar. */
  const [clientesSearchOpen, setClientesSearchOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editBarrio, setEditBarrio] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRoute, setEditRoute] = useState("");
  const [editPos, setEditPos] = useState("");
  const [editMsg, setEditMsg] = useState("");
  /** Ficha de un préstamo concreto desde historial «Ver préstamos». */
  const [prestamoFichaRef, setPrestamoFichaRef] = useState<string | null>(null);
  const [prestamosSearch, setPrestamosSearch] = useState("");
  const [prestamosSearchOpen, setPrestamosSearchOpen] = useState(false);
  /** Pin de ruta en Préstamos actuales (M / T / A / N). */
  const [prestamosRouteFilter, setPrestamosRouteFilter] = useState<string | null>(null);

  useEffect(() => {
    writeSupervisorNav(view, openRouteRef);
  }, [view, openRouteRef]);

  /** Entrada / remount: siempre INICIO limpio. */
  useEffect(() => {
    setView("inicio");
    setOpenRouteRef(null);
    setRouteReturnView("inicio");
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setCajaHistoryDayIso(null);
    setNequiRegistroRoute(null);
    setBancoRegistroRoute(null);
    setBancoGastosOpen(false);
    setBancoRutaExpand(null);
    setBancoRegistroDay(null);
    setNuevoMode("menu");
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setClientesModifyMode(false);
    setClientesEditRef(null);
    setClientesEditSearch("");
    setClientesSearchOpen(false);
    setClientesRouteFilter(null);
    setClientesLoanClientRef(null);
    setPlanillaRouteFilter(null);
    setPrestamoFichaRef(null);
    setPrestamosSearch("");
    setPrestamosRouteFilter(null);
    writeSupervisorNav("inicio", null);
  }, [supervisor.ref]);

  const coverage = useMemo(
    () => routeCoverageSummaries(collectors, routes, payments, clients, assignments, today),
    [collectors, routes, payments, clients, assignments, today],
  );

  const paymentsWithEvidence = useMemo(() => {
    indexPaymentEvidenceFromPayments(payments);
    return payments.map(withPaymentEvidence);
  }, [payments]);

  const todayAssignments = useMemo(
    () =>
      visiblePlanillaAssignments(
        assignments.filter(
          (row) =>
            row.dispatched &&
            row.dispatchDate === today &&
            isValidPlanillaAssignment(row, clients, loans),
        ),
      ),
    [assignments, today, clients, loans],
  );

  const assignedCoverage = useMemo(
    () =>
      coverage.filter(
        (row) => row.active && Boolean(row.collector?.ref || row.collectorRef),
      ),
    [coverage],
  );

  /** Libro de caja del día por cobrador: misma cifra que la app del cobrador, el cierre y el Historial. */
  const ledgerByCollector = useMemo(() => {
    const collectorRefsForLive = new Set(
      assignedCoverage
        .map((route) => route.collector?.ref || route.collectorRef || "")
        .filter(Boolean),
    );
    const byCollector = new Map<string, DayCashLedger>();
    for (const collectorRef of collectorRefsForLive) {
      const collector = collectors.find((row) => row.ref === collectorRef);
      if (!collector) continue;
      const ledger = buildDayCashLedger({
        collectorRef,
        collectorName: collector.name,
        date: today,
        payments,
        loans,
        clients,
        collectors: [collector],
        assignments: todayAssignments,
        dayCloses,
        dayExpenseDrafts,
        planillaCashCloses,
        monthCloses,
        fallbackOpening: cajaDelDia(
          collector,
          today,
          payments,
          dayCloses,
          dayExpenseDrafts,
          monthCloses,
        ).saldoInicial,
      });
      byCollector.set(collectorRef, ledger);
    }
    return byCollector;
  }, [
    assignedCoverage,
    collectors,
    today,
    payments,
    loans,
    clients,
    todayAssignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses,
    monthCloses,
  ]);

  const liquidaciones = useMemo((): RouteLiquidacion[] => {
    // Una tarjeta por ruta de catálogo (1, 1.1, 2…): no juntar hojas del mismo cobrador.
    const sorted = assignedCoverage
      .slice()
      .sort((a, b) => compareRouteNames(a.routeName, b.routeName));

    /** Caja viva de M por cobrador → Inicial momentáneo de T hasta que M cierre. */
    const primaryLiveByCollector = new Map<string, number>();
    for (const [collectorRef, ledger] of ledgerByCollector) {
      primaryLiveByCollector.set(collectorRef, ledger.mClosing);
    }

    const built = sorted.map((route) => {
      const collector = route.collector;
      const collectorRef = collector?.ref || route.collectorRef || "";
      const isPrimary = isPlanillaCashChainPrimary(route.routeName);

      const mine = todayAssignments.filter(
        (row) =>
          row.collectorRef === collectorRef &&
          sameRoute(assignmentRouteName(row, clients), route.routeName),
      );
      const pending = mine.filter(
        (row) => !row.visitStatus || row.visitStatus === "pendiente",
      ).length;
      const done = mine.filter((row) => row.visitStatus === "cobrado").length;

      const clientRefs = new Set(
        clients
          .filter((row) => sameRoute(row.route, route.routeName))
          .map((row) => row.ref),
      );
      for (const row of mine) {
        if (row.clientRef) clientRefs.add(row.clientRef);
      }

      const loansToday = loans.filter(
        (loan) =>
          clientRefs.has(loan.clientRef) &&
          !isLoanVoided(loan) &&
          loanDisbursementIsoDate(loan) === today,
      );
      const renewals = loansToday.filter(isRenewalLoan);
      const newLoans = loansToday.filter((loan) => !isRenewalLoan(loan));

      const fullCaja = collector
        ? cajaDelDia(collector, today, payments, dayCloses, dayExpenseDrafts, monthCloses)
        : {
            saldoInicial: 0,
            cobradoHoy: 0,
            cobradoEfectivo: 0,
            cobradoNequi: 0,
            cobradoBanco: 0,
            gastosHoy: 0,
            enCaja: 0,
          };

      let cobradoEfectivo = 0;
      if (collector) {
        for (const pay of collectorDayPayments(
          collector.ref,
          today,
          payments,
          [collector],
        )) {
          const loan = loans.find((row) => row.ref === pay.loanRef);
          if (!loan?.clientRef || !clientRefs.has(loan.clientRef)) continue;
          const amount = Number(pay.amount) || 0;
          if (!(amount > 0)) continue;
          if (paymentDisplayMethod(pay, loans, clients) === "efectivo") cobradoEfectivo += amount;
        }
      }
      const digitalCollected = collector
        ? routeDigitalCollected(
            {
              collectorRef: collector.ref,
              collectorName: collector.name,
              date: today,
              payments,
              loans,
              clients,
              collectors: [collector],
              assignments,
              dayCloses,
              dayExpenseDrafts,
              planillaCashCloses,
              monthCloses,
            },
            route.routeName,
          )
        : { nequi: 0, banco: 0, payments: [] };
      const cobradoNequi = digitalCollected.nequi;
      const cobradoBanco = digitalCollected.banco;
      const cobradoHoy = cobradoEfectivo + cobradoNequi + cobradoBanco;

      const rawExpenses = expensesForCollectorDay(
        collectorRef,
        today,
        dayCloses,
        dayExpenseDrafts,
      );
      // Cadena M↔T: cada planilla con sus propios préstamos y gastos (libro del día).
      const routeLedger = collectorRef ? ledgerByCollector.get(collectorRef) : undefined;
      const chainDay = !routeLedger?.chain
        ? null
        : isPlanillaCashChainSecondary(route.routeName)
          ? routeLedger.t
          : isPlanillaCashChainPrimary(route.routeName)
            ? routeLedger.m
            : null;
      // A / N: caja propia (Inicial = saldo real del último ajuste + arrastre).
      const independentDay =
        collector && isIndependentSaldoRoute(route.routeName)
          ? independentRouteDay(
              {
                collectorRef: collector.ref,
                collectorName: collector.name,
                date: today,
                payments,
                loans,
                clients,
                collectors: [collector],
                assignments,
                dayCloses,
                dayExpenseDrafts,
                planillaCashCloses,
                monthCloses,
              },
              route.routeName,
            )
          : null;
      let gastosHoy = independentDay ? independentDay.gastos : chainDay ? chainDay.gastos : 0;
      if (!chainDay && !independentDay && isPrimary) {
        for (const line of rawExpenses) {
          const amount = Number(line.amount) || 0;
          if (!(amount > 0) || isPrestamoRutaExpense(line)) continue;
          gastosHoy += amount;
        }
      }
      const cashLoansToday = independentDay
        ? independentDay.loanRows
        : chainDay
        ? chainDay.loanRows
        : isPrimary
          ? dayLoanDisbursementRows(today, rawExpenses, loans, clients, {
              collectorRef,
              assignments: todayAssignments,
              liveDay: isLiveCashDay(collectorRef, today, dayCloses, businessTodayIso()),
            })
          : [];
      const prestamosHoy = dayLoanDisbursementTotal(cashLoansToday);

      const closeRecord = dayCloses.find(
        (row) => row.collectorRef === collectorRef && row.date === today,
      );
      const planillaClosed =
        mine.length > 0 && mine.every((row) => Boolean(row.dayClosedAt));
      const closed = Boolean(closeRecord && isPrimary) || planillaClosed;

      const chainOpen =
        collectorRef
          ? openingCashForChainedPlanilla({
              collectorRef,
              routeName: route.routeName,
              date: today,
              records: planillaCashCloses,
              monthCloses,
              dayCloses,
              primaryLiveClosing: isPlanillaCashChainSecondary(route.routeName)
                ? primaryLiveByCollector.get(collectorRef)
                : undefined,
              fallbackOpening: fullCaja.saldoInicial,
            })
          : ({ kind: "independent" } as const);

      const saldoInicial =
        chainOpen.kind === "chain"
          ? chainOpen.opening
          : independentDay
            ? independentDay.opening
            : isPrimary
              ? fullCaja.saldoInicial
              : 0;
      // Cuadre de ruta: Inicial + efectivo − gasto − préstamo. M de la cadena = libro del día
      // (la misma cifra que recibe T como Inicial).
      const chainLedger =
        chainDay && chainOpen.kind === "chain" ? routeLedger : undefined;
      const enCaja = chainLedger
        ? chainDay === chainLedger.t
          ? chainLedger.dayFinal
          : chainLedger.mClosing
        : independentDay
          ? independentDay.closing
          : saldoInicial + cobradoEfectivo - gastosHoy - prestamosHoy;

      let statusLabel = "Sin planilla";
      let statusKind: StatusKind = "draft";
      if (closed) {
        statusLabel = "Cerrado";
        statusKind = "closed";
      } else if (mine.length) {
        if (pending === 0) {
          statusLabel = "Al día";
          statusKind = "ok";
        } else if (done > 0 || cobradoHoy > 0) {
          statusLabel = "En ruta";
          statusKind = "pending";
        } else {
          statusLabel = "";
          statusKind = "draft";
        }
      } else if (isPrimary) {
        const lastClose = dayCloses
          .filter((row) => row.collectorRef === collectorRef)
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (lastClose) {
          statusLabel = "Último cierre";
          statusKind = "closed";
        }
      }
      if (!closed && loansToday.length > 0 && statusKind !== "ok") {
        statusLabel =
          loansToday.length === 1
            ? "1 préstamo hoy"
            : `${loansToday.length} préstamos hoy`;
        statusKind = "partial";
      }

      return {
        routeRef: route.routeRef,
        routeName: route.routeName,
        collectorRef,
        collectorName: route.collectorName,
        clients: route.clients,
        planilla: mine.length,
        pending,
        done,
        saldoInicial,
        cobradoHoy,
        cobradoEfectivo,
        cobradoNequi,
        cobradoBanco,
        gastosHoy,
        prestamosHoy,
        cashLoansToday,
        enCaja,
        closed,
        newLoans,
        renewals,
        statusLabel,
        statusKind,
      };
    });

    // Reporte firme: Inicial T = saldo final de M (no un PCE hinchado).
    const mFinalByCollector = new Map<string, number>();
    for (const row of built) {
      if (!row.collectorRef || !isPlanillaCashChainPrimary(row.routeName)) continue;
      mFinalByCollector.set(row.collectorRef, row.enCaja);
    }
    return built.map((row) => {
      if (!isPlanillaCashChainSecondary(row.routeName) || !row.collectorRef) return row;
      const mFinal = mFinalByCollector.get(row.collectorRef);
      if (mFinal == null || !Number.isFinite(mFinal)) return row;
      const saldoInicial = mFinal;
      const ledger = ledgerByCollector.get(row.collectorRef);
      const enCaja =
        ledger?.chain && ledger.mClosing === mFinal
          ? ledger.dayFinal
          : saldoInicial + row.cobradoEfectivo - row.gastosHoy - row.prestamosHoy;
      return { ...row, saldoInicial, enCaja };
    });
  }, [
    assignedCoverage,
    assignments,
    todayAssignments,
    today,
    todayDisplay,
    payments,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
    planillaCashCloses,
    clients,
    loans,
    ledgerByCollector,
  ]);

  const deviceStatuses = useDeviceStatuses();
  const [connectionRouteRef, setConnectionRouteRef] = useState<string | null>(null);
  const connectionByRoute = useMemo(() => {
    const out: Record<string, CollectorConnection> = {};
    if (!deviceStatuses.loadedAt) return out;
    for (const row of liquidaciones) {
      const own = devicesForCollector(
        row.collectorRef,
        row.collectorName,
        collectors,
        deviceStatuses.devices,
      );
      out[row.routeRef] = collectorConnection(own, deviceStatuses.loadedAt);
    }
    return out;
  }, [liquidaciones, collectors, deviceStatuses]);
  const connectionRow = connectionRouteRef
    ? (liquidaciones.find((row) => row.routeRef === connectionRouteRef) ?? null)
    : null;

  const [unreadByRoute, setUnreadByRoute] = useState<Record<string, number>>({});
  const [unreadByRouteNequi, setUnreadByRouteNequi] = useState<Record<string, number>>({});
  const [unreadByRouteBanco, setUnreadByRouteBanco] = useState<Record<string, number>>({});
  const unreadTotalRef = useRef(0);

  useEffect(() => {
    const next: Record<string, number> = {};
    const nextNequi: Record<string, number> = {};
    const nextBanco: Record<string, number> = {};
    for (const row of liquidaciones) {
      ensureRouteDayBaseline(row.collectorRef, row.routeName, today);
      next[row.routeRef] = unreadPaymentCountForRoute(
        row.collectorRef,
        row.routeRef,
        row.routeName,
        today,
        collectors,
        paymentsWithEvidence,
        loans,
        clients,
      );
      nextNequi[row.routeRef] = unreadPaymentCountForRoute(
        row.collectorRef,
        row.routeRef,
        row.routeName,
        today,
        collectors,
        paymentsWithEvidence,
        loans,
        clients,
        "nequi",
      );
      nextBanco[row.routeRef] = unreadPaymentCountForRoute(
        row.collectorRef,
        row.routeRef,
        row.routeName,
        today,
        collectors,
        paymentsWithEvidence,
        loans,
        clients,
        "banco",
      );
    }
    const total = Object.values(next).reduce((sum, n) => sum + n, 0);
    if (total > unreadTotalRef.current) {
      playSupervisorPaymentChime();
    }
    unreadTotalRef.current = total;
    setUnreadByRoute(next);
    setUnreadByRouteNequi(nextNequi);
    setUnreadByRouteBanco(nextBanco);
  }, [liquidaciones, collectors, paymentsWithEvidence, loans, clients, today]);

  const totals = useMemo(() => {
    const prestamosHoy = liquidaciones.reduce(
      (sum, row) => sum + row.newLoans.length + row.renewals.length,
      0,
    );
    /** Caja e inicial: una sola vez por cobrador (ruta madre), sin sumar 1 + 1.1. */
    const cajaOwners = liquidaciones.filter((row) => {
      const siblings = liquidaciones.filter(
        (entry) => entry.collectorRef === row.collectorRef,
      );
      const primaryName = siblings
        .map((entry) => entry.routeName)
        .slice()
        .sort(compareRouteNames)[0];
      return sameRoute(row.routeName, primaryName);
    });
    return {
      routes: assignedCoverage.length,
      planilla: todayAssignments.length,
      cobradoHoy: liquidaciones.reduce((sum, row) => sum + row.cobradoHoy, 0),
      cobradoNequi: liquidaciones.reduce((sum, row) => sum + row.cobradoNequi, 0),
      cobradoBanco: liquidaciones.reduce((sum, row) => sum + row.cobradoBanco, 0),
      gastosHoy: liquidaciones.reduce((sum, row) => sum + row.gastosHoy, 0),
      enCaja: cajaOwners.reduce((sum, row) => sum + row.enCaja, 0),
      saldoInicial: cajaOwners.reduce((sum, row) => sum + row.saldoInicial, 0),
      prestamosHoy,
    };
  }, [assignedCoverage.length, liquidaciones, todayAssignments.length]);

  /**
   * Registro Nequi por día: hoy abierto; los días anteriores recogidos, uno por fila.
   * Al cambiar la fecha, el día de hoy pasa solo al historial y el nuevo arranca vacío.
   */
  /**
   * Registro Nequi de hoy (días anteriores van por Caja → Historial de cada ruta).
   */
  const nequiRegisterTodayAll = useMemo(() => {
    const items = paymentsWithEvidence
      .filter((row) => {
        if (paymentDisplayMethod(row, loans, clients) !== "nequi") return false;
        if (!((row.amount ?? 0) > 0)) return false;
        return normalizeHistoryDate(row.paidDate ?? "") === today;
      })
      .slice()
      .sort((a, b) => (b.paidTime || "").localeCompare(a.paidTime || ""));
    const total = items.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { date: today, items, total };
  }, [paymentsWithEvidence, today, loans, clients]);
  const nequiRegistroRoutePins = useMemo(
    () =>
      liquidaciones
        .map((row) => row.routeName)
        .filter(Boolean)
        .slice()
        .sort(compareRouteNames),
    [liquidaciones],
  );
  /** NEQUI = solo ruta A: un cuadro, sin botones de ruta abajo. */
  const nequiLiquidaciones = useMemo(
    () => liquidaciones.filter((row) => digitalLoanPoolForRoute(row.routeName) === "nequi"),
    [liquidaciones],
  );
  const nequiOnlyRoutePins = useMemo(
    () => nequiRegistroRoutePins.filter((name) => digitalLoanPoolForRoute(name) === "nequi"),
    [nequiRegistroRoutePins],
  );
  const bancoHistoryFrom = `${today.slice(0, 7)}-01`;
  /** Pins M → T → A → N: rutas activas con cobrador (Ruta / Clientes / Nequi / Banco). */
  const planillaRoutePins = useMemo(
    () =>
      catalogRoutes(routes)
        .filter((row) => routeIsActive(row) && Boolean(row.collectorRef))
        .slice()
        .sort((a, b) => compareRouteNames(a.name, b.name))
        .map((row) => row.name)
        .filter(Boolean),
    [routes],
  );
  const nequiRegisterToday = useMemo(() => {
    const base = nequiRegisterTodayAll;
    if (!nequiRegistroRoute) {
      return base;
    }
    const items = base.items.filter((pay) => {
      const loan = loans.find((row) => row.ref === pay.loanRef);
      const client = clients.find((row) => row.ref === (loan?.clientRef || ""));
      return sameRoute(client?.route, nequiRegistroRoute);
    });
    const total = items.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { date: base.date, items, total };
  }, [nequiRegisterTodayAll, nequiRegistroRoute, loans, clients]);

  /** Si los pins llegan después de entrar al panel, arrancar en ruta 1. */
  useEffect(() => {
    if (view !== "nequi") return;
    setNequiRegistroRoute((prev) => {
      if (nequiOnlyRoutePins.length === 0) return null;
      if (prev && nequiOnlyRoutePins.some((name) => sameRoute(name, prev))) {
        return prev;
      }
      return pickDefaultRoutePin(nequiOnlyRoutePins);
    });
  }, [view, nequiOnlyRoutePins]);
  useEffect(() => {
    if (view !== "banco") return;
    setBancoRegistroRoute((prev) => {
      if (!prev) return null;
      if (BANCO_ROUTE_PINS.some((pin) => sameRoute(pin, prev))) return prev;
      return null;
    });
  }, [view]);
  useEffect(() => {
    const openDay =
      view === "banco" ? bancoRegistroDay : view === "nequi" ? nequiRegistroDay : null;
    if (!openDay) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-pool-day]")) return;
      if (view === "banco") setBancoRegistroDay(null);
      if (view === "nequi") setNequiRegistroDay(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [view, bancoRegistroDay, nequiRegistroDay]);
  useEffect(() => {
    if (view !== "planilla") return;
    setPlanillaRouteFilter((prev) => {
      if (planillaRoutePins.length === 0) return null;
      if (prev && planillaRoutePins.some((name) => sameRoute(name, prev))) {
        return prev;
      }
      return pickDefaultRoutePin(planillaRoutePins);
    });
  }, [view, planillaRoutePins]);
  useEffect(() => {
    if (view !== "clientes") return;
    setClientesRouteFilter((prev) => {
      if (planillaRoutePins.length === 0) return null;
      if (prev && planillaRoutePins.some((name) => sameRoute(name, prev))) {
        return prev;
      }
      return pickDefaultRoutePin(planillaRoutePins);
    });
  }, [view, planillaRoutePins]);
  useEffect(() => {
    if (view !== "prestamos") return;
    setPrestamosRouteFilter((prev) => {
      if (planillaRoutePins.length === 0) return null;
      if (prev && planillaRoutePins.some((name) => sameRoute(name, prev))) {
        return prev;
      }
      return pickDefaultRoutePin(planillaRoutePins);
    });
  }, [view, planillaRoutePins]);

  const poolDayCountLabel = (cobros: number, prestamos: number) => {
    const cobro = `${cobros} cobro${cobros === 1 ? "" : "s"}`;
    if (prestamos <= 0) return cobro;
    return `${cobro} · ${prestamos} préstamo${prestamos === 1 ? "" : "s"}`;
  };

  /** Gastos pagados desde la cuenta Banco o Nequi: los mismos que resta su Saldo. */
  const renderPoolGastos = (
    pool: DigitalPool,
    gastos: readonly DigitalPoolGasto[],
    total: number,
  ) => {
    const label = DIGITAL_POOL_LABEL[pool];
    if (gastos.length === 0) {
      return <p className="ficha-empty">Sin gastos pagados desde {label} este mes.</p>;
    }
    return (
      <div className="supervisor-banco-hist">
        <div className="supervisor-banco-gastos-head" aria-hidden>
          <span>Fecha</span>
          <span>Concepto</span>
          <span>Valor</span>
        </div>
        <ul className="supervisor-banco-gastos-list" aria-label={`Gastos pagados desde ${label}`}>
          {gastos.map((row) => (
            <li key={row.ref}>
              <span className="is-date">{isoToDisplay(row.date)}</span>
              <span className="is-label">{row.label}</span>
              <span className="is-amount">{money(row.amount, { symbol: false })}</span>
            </li>
          ))}
        </ul>
        <div className="supervisor-banco-gastos-total">
          <span>Total gastado</span>
          <b>{money(total, { symbol: false })}</b>
        </div>
      </div>
    );
  };

  /** Ficha de un día del Registro Banco / Nequi: cobros (entran) y préstamos en azul (salen). */
  const renderNequiDayList = (
    items: typeof paymentsWithEvidence,
    loansOut: DigitalPoolRegisterLoan[] = [],
    net?: number,
  ) => (
    <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-register is-nequi-day-ficha">
      {items.map((pay) => {
        const method = paymentDisplayMethod(pay, loans, clients);
        return (
        <li key={pay.ref}>
          <strong className="is-name">{paymentCatalogClientName(pay, loans, clients)}</strong>
          <span className="is-when">{pay.paidTime || "—"}</span>
          <em
            className={`is-method ${paymentMethodToneClass(method)}`}
            title={paymentMethodLabel(method)}
          >
            {paymentMethodInitial(method)}
          </em>
          <span className="is-evidence">
            <PaymentEvidenceThumb
              evidence={pay.evidence}
              size={28}
              onAttach={
                onAttachPaymentEvidence
                  ? (piece) => onAttachPaymentEvidence(pay.ref, [piece])
                  : undefined
              }
            />
          </span>
          <b className="is-cobro">{money(pay.amount, { symbol: false })}</b>
        </li>
        );
      })}
      {loansOut.map((row) => (
        <li key={row.loanRef} className="is-outflow">
          <strong className="is-name">{row.clientName}</strong>
          <span className="is-when">{row.time || "—"}</span>
          <em className="is-method is-pay-prestamo" title="Sale del Banco · solo capital">
            −
          </em>
          <span className="is-evidence" aria-hidden />
          <b className="is-out">{money(-row.capital, { symbol: false })}</b>
        </li>
      ))}
      {net != null ? (
        <li className={net < 0 ? "is-total is-net-negative" : "is-total"}>
          <span>Saldo del día</span>
          <b>{money(net, { symbol: false })}</b>
        </li>
      ) : null}
    </ul>
  );

  /** Cobradores de las rutas (con su planilla de hoy). */
  const poolCollectors = useMemo(
    () =>
      liquidaciones
        .filter((row) => Boolean(row.collectorRef))
        .map((row) => ({ ref: row.collectorRef, name: row.collectorName })),
    [liquidaciones],
  );

  /** Suma Nequi solo de hoy (los cobradores de la lista). */
  const nequiHoyTotal = totals.cobradoNequi;

  /** Informe: caja de cada planilla según el libro del día (T ya incluye M). */
  const informeEfectivo = useMemo((): InformeEfectivo => {
    const cajaOf = (route: string) =>
      liquidaciones
        .filter((row) => sameRoute(row.routeName, route))
        .reduce((sum, row) => sum + (row.enCaja ?? 0), 0);
    return { t: cajaOf("T"), n: cajaOf("N") };
  }, [liquidaciones]);

  /**
   * Informe: Cobrado / Préstamo / Gasto por ruta, día a día desde el 1 del mes (libro de cada día).
   * Se calcula después de pintar: a fin de mes son ~31 días × cobradores y no debe trabar la pestaña.
   */
  const [informeHistory, setInformeHistory] = useState<InformeHistory | null>(null);
  useEffect(() => {
    if (view !== "informe") return;
    const timer = window.setTimeout(() => {
      setInformeHistory(
        informeRouteHistory(
          {
            payments,
            loans,
            clients,
            collectors,
            assignments,
            dayCloses,
            dayExpenseDrafts,
            planillaCashCloses,
            monthCloses,
          },
          poolCollectors.map((row) => row.ref),
          bancoHistoryFrom,
          today,
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    view,
    payments,
    loans,
    clients,
    collectors,
    assignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses,
    monthCloses,
    poolCollectors,
    bancoHistoryFrom,
    today,
  ]);

  /** Informe → General (M · T · N, tal cual) o Angélica (solo A: caja propia + Nequi). */
  const [informeTab, setInformeTab] = useState<"general" | "angelica">("general");
  const informeARows = useMemo(
    () => liquidaciones.filter((row) => sameRoute(row.routeName, INFORME_A_ROUTE)),
    [liquidaciones],
  );
  const informeAEfectivo = useMemo(
    () => informeARows.reduce((sum, row) => sum + (row.enCaja ?? 0), 0),
    [informeARows],
  );
  /** Solo el cobrador dueño de la planilla A: un cobrador sin hoja M/T (N) carga sus gastos a su propia ruta. */
  const informeACollectorRefs = useMemo(
    () => [...new Set(informeARows.map((row) => row.collectorRef).filter(Boolean))],
    [informeARows],
  );
  const [informeAHistory, setInformeAHistory] = useState<InformeRouteHistory | null>(null);
  useEffect(() => {
    if (view !== "informe" || informeTab !== "angelica") return;
    const timer = window.setTimeout(() => {
      setInformeAHistory(
        informeOwnRouteHistory(
          {
            payments,
            loans,
            clients,
            collectors,
            assignments,
            dayCloses,
            dayExpenseDrafts,
            planillaCashCloses,
            monthCloses,
          },
          informeACollectorRefs,
          INFORME_A_ROUTE,
          bancoHistoryFrom,
          today,
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    view,
    informeTab,
    payments,
    loans,
    clients,
    collectors,
    assignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses,
    monthCloses,
    informeACollectorRefs,
    bancoHistoryFrom,
    today,
  ]);

  /**
   * Registro Banco por día: hoy abierto; los días anteriores en historial.
   * Cada cobro (incluido Caja / oficina) queda en su paidDate, no en “Hoy” del día siguiente.
   */
  const bancoRouteCuadres = useMemo(
    () =>
      BANCO_ROUTE_PINS.map((pin) =>
        bancoRouteCuadre({
          payments: paymentsWithEvidence,
          loans,
          clients,
          dayCloses,
          dateIso: today,
          routeName: pin,
          fromIso: bancoHistoryFrom,
          movements: bankMovements,
        }),
      ),
    [paymentsWithEvidence, loans, clients, dayCloses, today, bancoHistoryFrom, bankMovements],
  );
  const bancoRutaCuadreHoy = useMemo(
    () =>
      bancoRouteCuadres.find(
        (row) => bancoRegistroRoute && sameRoute(row.route, bancoRegistroRoute),
      ) ?? null,
    [bancoRouteCuadres, bancoRegistroRoute],
  );
  /** Gastos pagados desde Banco en la misma ventana que las rutas M / T / N (el mes arranca en 0). */
  const bancoGastos = useMemo(
    () =>
      digitalPoolGastos({
        pool: "banco",
        miscPayments,
        accounts: bankAccounts,
        dayCloses,
        fromIso: bancoHistoryFrom,
        toIso: today,
      }),
    [miscPayments, bankAccounts, dayCloses, bancoHistoryFrom, today],
  );
  const bancoGastado = useMemo(() => digitalPoolGastosTotal(bancoGastos), [bancoGastos]);
  /** Saldo de Banco = Ruta M + Ruta T + Ruta N − Gastos. */
  const bancoSaldo = bancoAcumuladoRutas(bancoRouteCuadres) - bancoGastado;

  /** INICIO pie: caja viva de T (ya trae M) + caja propia de N + Saldo de Banco. */
  const inicioTotalConT = useMemo(() => {
    const routeT = liquidaciones.find((row) =>
      isPlanillaCashChainSecondary(row.routeName),
    );
    const routeN = liquidaciones.find((row) => sameRoute(row.routeName, "N"));
    return (routeT?.enCaja ?? 0) + (routeN?.enCaja ?? 0) + bancoSaldo;
  }, [liquidaciones, bancoSaldo]);
  const bancoRutaHistoryDays = useMemo(
    () =>
      bancoRegistroRoute
        ? bancoRouteHistoryDays({
            payments: paymentsWithEvidence,
            loans,
            clients,
            dayCloses,
            fromIso: bancoHistoryFrom,
            toIso: today,
            routeName: bancoRegistroRoute,
            movements: bankMovements,
          })
        : [],
    [
      paymentsWithEvidence,
      loans,
      clients,
      dayCloses,
      bancoHistoryFrom,
      today,
      bancoRegistroRoute,
      bankMovements,
    ],
  );
  const bancoCobradoDays = useMemo(
    () => bancoRouteCobradoHistoryDays(bancoRutaHistoryDays, today),
    [bancoRutaHistoryDays, today],
  );
  const bancoPrestadoDays = useMemo(
    () => bancoRoutePrestadoHistoryDays(bancoRutaHistoryDays, today),
    [bancoRutaHistoryDays, today],
  );
  const bancoRutaTotales = useMemo(
    () => bancoRouteHistoryTotals(bancoRutaHistoryDays),
    [bancoRutaHistoryDays],
  );
  const nequiRutaHistoryDays = useMemo(
    () =>
      nequiRouteHistoryDays({
        payments: paymentsWithEvidence,
        loans,
        clients,
        dayCloses,
        fromIso: bancoHistoryFrom,
        toIso: today,
        movements: bankMovements,
      }),
    [
      paymentsWithEvidence,
      loans,
      clients,
      dayCloses,
      bancoHistoryFrom,
      today,
      bankMovements,
    ],
  );
  const nequiCobradoDays = useMemo(
    () => bancoRouteCobradoHistoryDays(nequiRutaHistoryDays, today),
    [nequiRutaHistoryDays, today],
  );
  const nequiPrestadoDays = useMemo(
    () => bancoRoutePrestadoHistoryDays(nequiRutaHistoryDays, today),
    [nequiRutaHistoryDays, today],
  );
  const nequiRutaTotales = useMemo(
    () => bancoRouteHistoryTotals(nequiRutaHistoryDays),
    [nequiRutaHistoryDays],
  );
  const nequiGastos = useMemo(
    () =>
      digitalPoolGastos({
        pool: "nequi",
        miscPayments,
        accounts: bankAccounts,
        dayCloses,
        fromIso: bancoHistoryFrom,
        toIso: today,
      }),
    [miscPayments, bankAccounts, dayCloses, bancoHistoryFrom, today],
  );
  const nequiGastado = useMemo(() => digitalPoolGastosTotal(nequiGastos), [nequiGastos]);
  /** Saldo Nequi = cobrado − prestado (historial de A) − gastos pagados desde Nequi. */
  const nequiRutaSaldo = (nequiRutaHistoryDays[0]?.saldo ?? 0) - nequiGastado;
  /** Filas de planilla: `#` = posición del cliente en su ruta; `route` para la raya verde. */
  const planillaTableRows = (rows: DailyCollectionAssignment[]): PlanillaTableRow[] =>
    rows.map((row, index) => {
      const client = clients.find((entry) => entry.ref === row.clientRef);
      const position =
        client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : index + 1;
      return {
        ...enrichSupervisorPlanillaRow(row, position, loans, payments, today),
        route: assignmentRouteName(row, clients),
        clientRef: row.clientRef,
        loanRef: row.loanRef ?? "",
        reloan: reloanStateForVisit({
          clientRef: row.clientRef,
          loanRef: row.loanRef,
          loans,
          payments,
          date: today,
        }),
      };
    });

  const openRoute = liquidaciones.find((row) => row.routeRef === openRouteRef) ?? null;
  /** «Cobrado hoy»: A cobra por Nequi (valor `banco`); M, T y N por Banco (valor `nequi`). Con plata del otro, se muestra igual. */
  const openRouteIsA = openRoute ? sameRoute(openRoute.routeName, "A") : false;
  /** A cobra solo Efectivo y Nequi: lo que no es efectivo se muestra en un solo recuadro Nequi. */
  /** Digital por ruta: A = cajita Nequi; M / T / N = cajita Banco (nunca las dos). */
  const openRouteDigitalPool: "banco" | "nequi" = openRouteIsA ? "nequi" : "banco";
  const openRouteDigitalLabel = openRouteIsA ? "Nequi" : "Banco";
  const routeMeansShowNequiValue = !openRouteIsA;
  const routeMeansShowBancoValue = openRouteIsA;
  const routeDigitalAmount = (openRoute?.cobradoBanco ?? 0) + (openRoute?.cobradoNequi ?? 0);
  const routeNequiBoxAmount = routeDigitalAmount;
  /** Botón digital de «Cobrado hoy»: solo los cobros de ese medio (A → Nequi). Nunca el recaudo entero. */
  const routeNequiBoxMethod: PaymentMethod = openRouteDigitalPool;

  /** N/P solo de la ruta abierta (nunca mezclar M con T/A/N). */
  const openRouteNpByDay = useMemo(() => {
    if (!openRoute) {
      return {
        todayRows: [] as DailyCollectionAssignment[],
        past: [] as Array<{ date: string; rows: DailyCollectionAssignment[] }>,
      };
    }
    const groups = new Map<string, DailyCollectionAssignment[]>();
    for (const row of assignments) {
      if (!isNoPayListRow(row)) continue;
      if (row.collectorRef !== openRoute.collectorRef) continue;
      if (!sameRoute(assignmentRouteName(row, clients), openRoute.routeName)) continue;
      const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
      if (!date || date > today) continue;
      const list = groups.get(date) ?? [];
      list.push(row);
      groups.set(date, list);
    }
    const byName = (rows: DailyCollectionAssignment[]) =>
      rows
        .slice()
        .sort((a, b) =>
          `${a.clientRoute}|${a.clientName}`.localeCompare(
            `${b.clientRoute}|${b.clientName}`,
            "es",
          ),
        );
    const past = [...groups.keys()]
      .filter((date) => date < today)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date, rows: byName(groups.get(date) ?? []) }));
    return { todayRows: byName(groups.get(today) ?? []), past };
  }, [assignments, clients, openRoute, today]);

  const openRouteNpDayRows = useMemo(() => {
    if (!snDay) return [] as DailyCollectionAssignment[];
    if (snDay === today) return openRouteNpByDay.todayRows;
    return openRouteNpByDay.past.find((day) => day.date === snDay)?.rows ?? [];
  }, [openRouteNpByDay, snDay, today]);

  /** Cliente de la planilla abierta al que el supervisor le va a prestar (terminó hoy). */
  const reloanClient =
    openRoute && reloanClientRef
      ? clients.find((row) => row.ref === reloanClientRef) ?? null
      : null;
  const openRouteScope = useMemo(() => {
    if (!openRoute) return null;
    const clientRefs = new Set(
      clients
        .filter((row) => sameRoute(row.route, openRoute.routeName))
        .map((row) => row.ref),
    );
    for (const row of todayAssignments) {
      if (
        row.collectorRef === openRoute.collectorRef &&
        row.clientRef &&
        sameRoute(assignmentRouteName(row, clients), openRoute.routeName)
      ) {
        clientRefs.add(row.clientRef);
      }
    }
    const siblings = liquidaciones.filter(
      (row) => row.collectorRef === openRoute.collectorRef,
    );
    const primaryName = siblings
      .map((row) => row.routeName)
      .slice()
      .sort(compareRouteNames)[0];
    return {
      clientRefs,
      isPrimary: sameRoute(openRoute.routeName, primaryName),
    };
  }, [openRoute, clients, todayAssignments, liquidaciones]);
  const openAssignments = useMemo(
    () =>
      openRoute
        ? todayAssignments
            .filter(
              (row) =>
                row.collectorRef === openRoute.collectorRef &&
                sameRoute(assignmentRouteName(row, clients), openRoute.routeName),
            )
            .sort(assignmentRoutePositionComparator(clients))
        : [],
    [clients, todayAssignments, openRoute],
  );
  const openRouteExpenses = useMemo(() => {
    if (!openRoute || !openRouteScope) return [];
    // Solo gastos operativos. Los préstamos van al botón Préstamo, no a Gastos.
    const ledger = ledgerByCollector.get(openRoute.collectorRef);
    if (ledger?.chain && isPlanillaCashChainSecondary(openRoute.routeName)) {
      return ledger.t.gastoLines;
    }
    if (ledger?.chain && isPlanillaCashChainPrimary(openRoute.routeName)) {
      return ledger.m.gastoLines;
    }
    if (!openRouteScope.isPrimary) return [];
    const raw = expensesForCollectorDay(
      openRoute.collectorRef,
      today,
      dayCloses,
      dayExpenseDrafts,
    );
    return operativeExpenseLines(raw);
  }, [
    ledgerByCollector,
    openRoute,
    openRouteScope,
    today,
    dayCloses,
    dayExpenseDrafts,
  ]);
  const openRouteNequiDays = useMemo(() => {
    if (!openRoute) return [];
    return digitalPoolRegisterDays({
      payments: paymentsWithEvidence,
      loans,
      clients,
      pool: openRouteDigitalPool,
      fromIso: bancoHistoryFrom,
      toIso: today,
      routeName: openRoute.routeName,
      movements: bankMovements,
    }).map((day) => ({
      date: day.date,
      dateLabel: isoToDisplay(day.date),
      count: day.items.length,
      loanCount: day.loans.length,
      amount: day.total,
    }));
  }, [
    openRoute,
    openRouteDigitalPool,
    paymentsWithEvidence,
    loans,
    clients,
    bancoHistoryFrom,
    today,
    bankMovements,
  ]);
  /** Banco / Nequi: historial desde el día 1 del mes en curso (lo anterior no se lista). */
  const openRouteDigitalDays = openRouteNequiDays;
  const openRouteDigitalDayLedger = useMemo(() => {
    if (!openRoute || !nequiDayIso) return null;
    return digitalPoolDayLedger({
      payments: paymentsWithEvidence,
      loans,
      clients,
      pool: openRouteDigitalPool,
      dateIso: nequiDayIso,
      routeName: openRoute.routeName,
      movements: bankMovements,
    });
  }, [
    openRoute,
    openRouteDigitalPool,
    nequiDayIso,
    paymentsWithEvidence,
    loans,
    clients,
    bankMovements,
  ]);
  const openRouteNequiDayPays = openRouteDigitalDayLedger?.items ?? [];
  const openRouteNequiDayLoans = openRouteDigitalDayLedger?.loans ?? [];

  const openRouteCajaHistory = useMemo(() => {
    if (!openRoute || !openRouteScope) return [];
    const collector = collectors.find((row) => row.ref === openRoute.collectorRef);
    if (!collector) return [];
    const period = periodFromDateIso(today);
    const isM = isPlanillaCashChainPrimary(openRoute.routeName);
    const isT = isPlanillaCashChainSecondary(openRoute.routeName);
    const epoch = PLANILLA_CASH_CHAIN_HISTORY_EPOCH;

    // Actividad solo de ESTA ruta (T/A/N no heredan préstamos de M).
    const rows = buildCollectorDayHistory(
      openRoute.collectorRef,
      payments,
      dayCloses,
      [collector],
      [today],
      dayExpenseDrafts,
      monthCloses,
      period,
      {
        assignments,
        rolling: true,
        clientRefs: openRouteScope.clientRefs,
        loans,
        clients,
        includeOperatingExpenses: isM,
        chainSplit:
          isM || isT
            ? chainHistorySplit(
                isT ? "secondary" : "primary",
                openRoute.collectorRef,
                clients,
                assignments,
              )
            : undefined,
      },
    ).filter((row) => row.date >= ROUTE_CASH_BOOK_FROM);

    const primaryClosingFor = (dateIso: string) =>
      primaryClosingForDay(
        {
          collectorRef: collector.ref,
          collectorName: collector.name,
          payments,
          loans,
          clients,
          collectors: [collector],
          assignments,
          dayCloses,
          dayExpenseDrafts,
          planillaCashCloses,
          monthCloses,
        },
        dateIso,
      );

    if (isT) {
      // Saldo de T = cierre real de M ese día (+ movimiento propio de T, si hubo).
      // Nunca el rolling global del cobrador (mezcla rutas → saldos falsos).
      const mRows = buildCollectorDayHistory(
        openRoute.collectorRef,
        payments,
        dayCloses,
        [collector],
        [today],
        dayExpenseDrafts,
        monthCloses,
        period,
        {
          assignments,
          rolling: true,
          loans,
          clients,
          includeOperatingExpenses: true,
          chainSplit: chainHistorySplit("primary", openRoute.collectorRef, clients, assignments),
        },
      );
      const mAnnotated = annotateMHistoryExtractRows({
        rows: mRows,
        collectorRef: openRoute.collectorRef,
        records: planillaCashCloses,
        epochBootstrapOpening: openingSaldoForPeriod(
          openRoute.collectorRef,
          period,
          monthCloses,
        ),
        todayIso: today,
        epoch,
        dayCloses,
        monthCloses,
        primaryClosingFor,
      });
      const mStamped = stampHistoryWithPlanillaCashChain({
        collectorRef: openRoute.collectorRef,
        routeName: PLANILLA_CASH_CHAIN_PRIMARY,
        rows: mRows,
        records: planillaCashCloses,
        monthCloses,
        fallbackOpening: openingSaldoForPeriod(
          openRoute.collectorRef,
          period,
          monthCloses,
        ),
      });
      const primaryClosingByDate = new Map<string, number>();
      for (const row of mAnnotated) {
        if (row.saldoShown != null && Number.isFinite(row.saldoShown)) {
          primaryClosingByDate.set(row.date, row.saldoShown);
        }
      }
      for (const row of mStamped) {
        if (!primaryClosingByDate.has(row.date) && Number.isFinite(row.saldo)) {
          primaryClosingByDate.set(row.date, row.saldo);
        }
      }
      const tRows = rows
        .filter((row) => row.date >= epoch && row.date <= today)
        .map((row) => ({
          ...row,
          // Columnas de T: solo lo suyo (cobro/gasto/préstamo ya vienen filtrados).
          saldo: primaryClosingByDate.get(row.date) ?? 0,
        }));
      const stamped = stampHistoryWithPlanillaCashChain({
        collectorRef: openRoute.collectorRef,
        routeName: openRoute.routeName,
        rows: tRows,
        records: planillaCashCloses,
        monthCloses,
        primaryClosingByDate,
      });
      const sealed = withSealedDaySaldos(stamped, openRoute.collectorRef, dayCloses, today);
      const ledger = ledgerByCollector.get(openRoute.collectorRef);
      const withToday = ledger ? withLedgerTodaySaldo(sealed, ledger) : sealed;
      return withToday.slice(0, 6);
    }

    if (isIndependentSaldoRoute(openRoute.routeName)) {
      // A / N: saldo del día = caja propia de la planilla (misma cifra que la tarjeta).
      return withIndependentRouteHistory(
        rows.filter((row) => row.date <= today).slice(0, 6),
        {
          collectorRef: openRoute.collectorRef,
          collectorName: collector.name,
          payments,
          loans,
          clients,
          collectors: [collector],
          assignments,
          dayCloses,
          dayExpenseDrafts,
          planillaCashCloses,
          monthCloses,
        },
        openRoute.routeName,
      );
    }

    if (!isM) {
      return rows.filter((row) => row.date < today).slice(0, 5);
    }

    // Saldo = caja real de M (efectivo − gasto − préstamo), misma base que la ruta.
    const cashHand = buildCollectorDayHistory(
      openRoute.collectorRef,
      payments,
      dayCloses,
      [collector],
      [today],
      dayExpenseDrafts,
      monthCloses,
      period,
      {
        assignments,
        rolling: true,
        loans,
        clients,
        includeOperatingExpenses: true,
        chainSplit: chainHistorySplit("primary", openRoute.collectorRef, clients, assignments),
      },
    );
    const cashByDate = new Map(cashHand.map((row) => [row.date, row.saldo]));
    const withCashHand = applyCollectorCashHandSaldos(rows, cashByDate);

    // M: extracto con hoy incluido (Inicial lleno, Saldo — si aún no cerró).
    const visible = withCashHand
      .filter((row) => row.date <= today)
      .slice(0, 6);
    return annotateMHistoryExtractRows({
      rows: visible,
      collectorRef: openRoute.collectorRef,
      records: planillaCashCloses,
      epochBootstrapOpening: openingSaldoForPeriod(
        openRoute.collectorRef,
        period,
        monthCloses,
      ),
      todayIso: today,
      epoch,
      dayCloses,
      monthCloses,
      primaryClosingFor,
    });
  }, [
    openRoute,
    openRouteScope,
    collectors,
    payments,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
    assignments,
    loans,
    clients,
    today,
    planillaCashCloses,
    ledgerByCollector,
  ]);

  const openRouteCajaHistoryIsM = Boolean(
    openRoute && isPlanillaCashChainPrimary(openRoute.routeName),
  );
  const openRouteCajaHistoryIsT = Boolean(
    openRoute && isPlanillaCashChainSecondary(openRoute.routeName),
  );
  const openRouteCajaHistoryIsIndependent = Boolean(
    openRoute && isIndependentSaldoRoute(openRoute.routeName),
  );

  /** Historial · T / A / N: renglón del día + renglón de ajuste (si lo hubo). */
  const openRouteAdjustHistory = useMemo(() => {
    if (!openRoute) return null;
    const rows = openRouteCajaHistory as Array<{
      date: string;
      dateLabel: string;
      cobro: number;
      gasto: number;
      prestamo: number;
      saldo: number;
    }>;
    if (openRouteCajaHistoryIsT) {
      return attachCashAdjustments(rows, openRoute.collectorRef, dayCloses);
    }
    if (!openRouteCajaHistoryIsIndependent) return null;
    return attachRouteCashAdjustments(rows, openRoute.collectorRef, openRoute.routeName, dayCloses);
  }, [
    openRoute,
    openRouteCajaHistoryIsT,
    openRouteCajaHistoryIsIndependent,
    openRouteCajaHistory,
    dayCloses,
  ]);

  /** Ajuste de saldo: solo supervisor/admin, la planilla ya cerró hoy y antes de medianoche. */
  const tCashAdjustDate = useMemo(() => {
    if (!onAdjustTCash || !openRoute) return null;
    if (openRouteCajaHistoryIsT) {
      const adjustWindow = cashAdjustmentWindow(openRoute.collectorRef, dayCloses);
      return adjustWindow.open ? adjustWindow.date : null;
    }
    if (openRouteCajaHistoryIsIndependent) {
      const adjustWindow = routeCashAdjustmentWindow(
        openRoute.collectorRef,
        openRoute.routeName,
        dayCloses,
      );
      return adjustWindow.open ? adjustWindow.date : null;
    }
    return null;
  }, [
    onAdjustTCash,
    openRoute,
    openRouteCajaHistoryIsT,
    openRouteCajaHistoryIsIndependent,
    dayCloses,
  ]);

  const tCashAdjustTarget = useMemo(() => {
    if (!tCashAdjustDate || !openRouteAdjustHistory) return null;
    return openRouteAdjustHistory.find((entry) => entry.row.date === tCashAdjustDate) ?? null;
  }, [tCashAdjustDate, openRouteAdjustHistory]);

  async function submitTCashAdjust(real: number, reason: string) {
    if (!onAdjustTCash || !openRoute) return false;
    const ok = await onAdjustTCash({
      collectorRef: openRoute.collectorRef,
      real,
      reason,
      ...(openRouteCajaHistoryIsIndependent ? { route: openRoute.routeName } : {}),
    });
    if (ok) setCashAdjustCollectorRef(null);
    return ok;
  }

  /** Reabrir la hoja de hoy: solo supervisor/admin, hoy antes de 23:30, día sellado, nunca M. */
  const sheetReopenKey = openRoute ? `${openRoute.collectorRef}|${openRoute.routeName}` : null;
  const canReopenSheet = useMemo(() => {
    if (!onReopenSheet || !openRoute) return false;
    return sheetReopenWindow(
      openRoute.collectorRef,
      openRoute.routeName,
      dayCloses,
      readKnownSheetReopens(),
    ).open;
    // `assignments` cambia con cada pull que trae una reapertura nueva.
  }, [onReopenSheet, openRoute, dayCloses, assignments]);
  const reopenRoutesLabel = openRoute ? routesToReopen(openRoute.routeName).join(" y ") : "";

  async function confirmReopenSheet() {
    if (!onReopenSheet || !openRoute || reopeningSheet) return;
    setReopeningSheet(true);
    try {
      const ok = await onReopenSheet({
        collectorRef: openRoute.collectorRef,
        route: openRoute.routeName,
      });
      if (ok) setReopenConfirmKey(null);
    } finally {
      setReopeningSheet(false);
    }
  }

  /** Día del historial de A / N: solo la planilla (nada de las otras rutas del cobrador). */
  const openRouteHistoryIndependentDay = useMemo(() => {
    if (!openRoute || !cajaHistoryDayIso || !isIndependentSaldoRoute(openRoute.routeName)) {
      return null;
    }
    const collector = collectors.find((row) => row.ref === openRoute.collectorRef);
    if (!collector) return null;
    const src = {
      collectorRef: collector.ref,
      collectorName: collector.name,
      date: cajaHistoryDayIso,
      payments,
      loans,
      clients,
      collectors: [collector],
      assignments,
      dayCloses,
      dayExpenseDrafts,
      planillaCashCloses,
      monthCloses,
    };
    const day = independentRouteDay(src, openRoute.routeName);
    return {
      day,
      collected: independentRouteCollected(src, openRoute.routeName),
      lines: independentRouteDayLines(day),
    };
  }, [
    openRoute,
    cajaHistoryDayIso,
    collectors,
    payments,
    loans,
    clients,
    assignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses,
    monthCloses,
  ]);

  /**
   * Día del historial de M / T (libro del día): M = la mañana; T = el día entero (M + T).
   * La Caja es la misma cifra del renglón: T = saldo final (Inicial de M mañana);
   * M = saldo de la mañana (Inicial de T).
   */
  const openRouteHistoryChainDay = useMemo(() => {
    if (!openRoute || !cajaHistoryDayIso) return null;
    const isT = isPlanillaCashChainSecondary(openRoute.routeName);
    if (!isT && !isPlanillaCashChainPrimary(openRoute.routeName)) return null;
    const collector = collectors.find((row) => row.ref === openRoute.collectorRef);
    if (!collector) return null;
    const cuadre = chainDayCuadre(
      {
        collectorRef: collector.ref,
        collectorName: collector.name,
        date: cajaHistoryDayIso,
        payments,
        loans,
        clients,
        collectors: [collector],
        assignments,
        dayCloses,
        dayExpenseDrafts,
        planillaCashCloses,
        monthCloses,
        fallbackOpening:
          cajaHistoryDayIso === PLANILLA_CASH_CHAIN_HISTORY_EPOCH
            ? openingSaldoForPeriod(
                collector.ref,
                periodFromDateIso(cajaHistoryDayIso),
                monthCloses,
              )
            : undefined,
      },
      isT ? "secondary" : "primary",
    );
    const listed = isT
      ? openRouteAdjustHistory?.find((entry) => entry.row.date === cajaHistoryDayIso)?.row.saldo
      : (openRouteCajaHistory as Array<{ date: string; saldoShown?: number | null }>).find(
          (row) => row.date === cajaHistoryDayIso,
        )?.saldoShown;
    return listed != null && Number.isFinite(listed) ? { ...cuadre, closing: listed } : cuadre;
  }, [
    openRoute,
    openRouteAdjustHistory,
    openRouteCajaHistory,
    cajaHistoryDayIso,
    collectors,
    payments,
    loans,
    clients,
    assignments,
    dayCloses,
    dayExpenseDrafts,
    planillaCashCloses,
    monthCloses,
  ]);

  const openRouteHistoryDayCuadre = useMemo(() => {
    if (!openRoute || !cajaHistoryDayIso) return null;
    if (openRouteHistoryChainDay) {
      return {
        saldoInicial: openRouteHistoryChainDay.opening,
        cobradoEfectivo: openRouteHistoryChainDay.efectivo,
        cobradoNequi: openRouteHistoryChainDay.nequi,
        cobradoBanco: openRouteHistoryChainDay.banco,
        enCaja: openRouteHistoryChainDay.closing,
      };
    }
    if (openRouteHistoryIndependentDay) {
      const { day, collected } = openRouteHistoryIndependentDay;
      return {
        saldoInicial: day.opening,
        cobradoEfectivo: collected.efectivo,
        cobradoNequi: collected.nequi,
        cobradoBanco: collected.banco,
        enCaja: day.closing,
      };
    }
    const collector = collectors.find((row) => row.ref === openRoute.collectorRef);
    if (!collector) return null;
    return cajaDelDia(
      collector,
      cajaHistoryDayIso,
      payments,
      dayCloses,
      dayExpenseDrafts,
      monthCloses,
    );
  }, [
    openRoute,
    openRouteHistoryChainDay,
    openRouteHistoryIndependentDay,
    cajaHistoryDayIso,
    collectors,
    payments,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
  ]);

  const historyDayShowNequiValue = !openRouteIsA;
  const historyDayShowBancoValue = openRouteIsA;
  /** A = solo Nequi; M / T / N = solo Banco (T muestra M+T en el recuadro conjunto). */
  const historyDayDigitalAmount = openRouteIsA
    ? (openRouteHistoryDayCuadre?.cobradoNequi ?? 0)
    : (openRouteHistoryDayCuadre?.cobradoBanco ?? 0) +
      (openRouteHistoryDayCuadre?.cobradoNequi ?? 0);
  const historyDayNequiBoxAmount = historyDayDigitalAmount;
  /** Cierre del día de T: lo propio de T arriba; totales M+T en «Lo que cobró». */
  const historyDayChainT = openRouteCajaHistoryIsT ? openRouteHistoryChainDay : null;
  const historyDayMeansCount =
    1 +
    Number(historyDayShowNequiValue) +
    Number(historyDayShowBancoValue) +
    4 * Number(Boolean(historyDayChainT));
  const historyDayMeansCols =
    historyDayMeansCount === 2 ? " is-two" : historyDayMeansCount >= 4 ? " is-four" : "";

  const openRouteHistoryDayExpenses = useMemo(() => {
    if (!openRoute || !cajaHistoryDayIso) return [];
    if (openRouteHistoryChainDay) return openRouteHistoryChainDay.lines;
    if (openRouteHistoryIndependentDay) return openRouteHistoryIndependentDay.lines;
    const raw = expensesForCollectorDay(
      openRoute.collectorRef,
      cajaHistoryDayIso,
      dayCloses,
      dayExpenseDrafts,
    );
    return expensesWithDayLoans(cajaHistoryDayIso, raw, loans, clients, {
      collectorRef: openRoute.collectorRef,
      assignments,
    });
  }, [
    openRoute,
    openRouteHistoryChainDay,
    openRouteHistoryIndependentDay,
    cajaHistoryDayIso,
    dayCloses,
    dayExpenseDrafts,
    loans,
    clients,
    assignments,
  ]);

  const openRouteHistoryDayExpenseSplit = useMemo(
    () => splitDayExpenses(openRouteHistoryDayExpenses),
    [openRouteHistoryDayExpenses],
  );
  /** Cierre del día: T lista solo lo suyo; M / A / N lo de su planilla. */
  const cierrePrestamos = historyDayChainT
    ? historyDayChainT.ownLoanLines
    : openRouteHistoryDayExpenseSplit.prestamos;
  const cierrePrestamosTotal = historyDayChainT
    ? historyDayChainT.ownPrestamos
    : openRouteHistoryDayExpenseSplit.prestamosTotal;
  const cierreGastos = historyDayChainT
    ? historyDayChainT.ownGastoLines
    : openRouteHistoryDayExpenseSplit.otros;
  const cierreGastosTotal = historyDayChainT
    ? historyDayChainT.ownGastos
    : openRouteHistoryDayExpenseSplit.otrosTotal;

  /** Banco de M / N: los mismos cobros que suma el botón (historial Banco de esa ruta). */
  const cierreBancoRutaPayments = historyDayChainT
    ? null
    : openRouteHistoryChainDay
      ? openRouteHistoryChainDay.ownDigitalPayments
      : openRouteHistoryIndependentDay && !openRouteIsA
        ? openRouteHistoryIndependentDay.collected.digitalPayments
        : null;
  /** Nequi de A: los mismos cobros que suma el botón (historial Nequi de A). */
  const cierreNequiRutaPayments =
    openRouteIsA && openRouteHistoryIndependentDay
      ? openRouteHistoryIndependentDay.collected.digitalPayments
      : null;

  /** Efectivo de la planilla abierta (T: solo T) y, en T, el de M+T: los cobros que suma cada botón. */
  const cierreEfectivoPayments = openRouteHistoryChainDay
    ? openRouteHistoryChainDay.ownCashPayments
    : openRouteHistoryIndependentDay
      ? openRouteHistoryIndependentDay.collected.cashPayments
      : null;
  const cierreEfectivoCadenaPayments = historyDayChainT ? historyDayChainT.cashPayments : null;

  /** Solo vista: préstamos del día que salieron del Banco a clientes de M y T (no tocan la caja). */
  const cierreBancoLoans = useMemo(() => {
    if (!historyDayChainT || !cajaHistoryDayIso) return [];
    return [PLANILLA_CASH_CHAIN_PRIMARY, PLANILLA_CASH_CHAIN_SECONDARY].flatMap((route) =>
      dayDigitalLoanRows(cajaHistoryDayIso, route, loans, clients),
    );
  }, [historyDayChainT, cajaHistoryDayIso, loans, clients]);
  const cierreBancoLoansTotal = dayLoanDisbursementTotal(cierreBancoLoans);

  /** Lista desplegada bajo «Caja» al tocar Prestó / Gastó / Banco T (solo ese día). */
  const [cierreList, setCierreList] = useState<{
    day: string;
    kind: CierreListKind;
  } | null>(null);
  const cierreListKind =
    cierreList && cierreList.day === cajaHistoryDayIso ? cierreList.kind : null;
  const cierreListLines: CierreListLine[] =
    cierreListKind === "gastos"
      ? cierreGastos.map((line, index) => ({
          key: `${line.id}:${line.lineKey || line.label}:${index}`,
          label: line.label,
          amount: Number(line.amount) || 0,
        }))
      : [];
  /** Préstamo del día como renglón de la planilla («Prestado», capital). */
  const cierreLoanPlanillaRow = (
    loanRef: string,
    capital: number,
    fallbackName: string,
    index: number,
  ): CollectorHistoryPlanillaRow => {
    const loan = loanRef ? loans.find((row) => row.ref === loanRef) : undefined;
    const client = clients.find((row) => row.ref === loan?.clientRef);
    return {
      key: `prestamo:${loanRef || fallbackName}:${index}`,
      clientRef: client?.ref || loan?.clientRef || "",
      route: String(client?.route || "").trim(),
      order: client?.routeOrder && client.routeOrder > 0 ? client.routeOrder : null,
      name: client
        ? `${client.name} ${client.lastName}`.trim()
        : (loan?.client || "").trim() || fallbackName,
      amount: Number(capital) || 0,
      time: cajaHistoryDayIso ? loanRegisteredTimeLabel(loan, cajaHistoryDayIso) : "—",
      evidence: [],
      method: "prestamo",
      lentToday: true,
    };
  };
  const cierreLoanPlanillaRows = (rows: CollectorHistoryPlanillaRow[]) =>
    rows.sort(
      (a, b) =>
        compareRoutePosition(a.route, a.order, b.route, b.order) ||
        a.name.localeCompare(b.name, "es"),
    );
  const toggleCierreList = (kind: CierreListKind) => {
    if (!cajaHistoryDayIso) return;
    const day = cajaHistoryDayIso;
    setCierreList((prev) => (prev?.day === day && prev.kind === kind ? null : { day, kind }));
  };
  useEffect(() => {
    if (!cierreListKind) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-cierre-keep]")) return;
      setCierreList(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [cierreListKind]);

  const openRouteHistoryDayPlanilla = useMemo(() => {
    if (!openRoute || !cajaHistoryDayIso || !openRouteScope) return [];
    const dayVisits = assignments.filter(
      (row) =>
        row.collectorRef === openRoute.collectorRef &&
        normalizeHistoryDate(row.dispatchDate) === cajaHistoryDayIso &&
        sameRoute(assignmentRouteName(row, clients), openRoute.routeName),
    );
    const dayPays = collectorDayPayments(
      openRoute.collectorRef,
      cajaHistoryDayIso,
      payments,
      collectors,
    ).filter((pay) => {
      const loan = loans.find((row) => row.ref === pay.loanRef);
      return Boolean(loan?.clientRef && openRouteScope.clientRefs.has(loan.clientRef));
    });
    return buildCollectorHistoryPlanillaRows({
      dateIso: cajaHistoryDayIso,
      dispatched: dayVisits,
      payments: dayPays,
      loans,
      clients,
      expenses: openRouteHistoryDayExpenses,
    });
  }, [
    openRoute,
    openRouteScope,
    cajaHistoryDayIso,
    assignments,
    payments,
    collectors,
    loans,
    clients,
    openRouteHistoryDayExpenses,
  ]);
  /** N/P del día de esta ruta: los mismos renglones «N/P» de su planilla. */
  const cierreNpRows = openRouteHistoryDayPlanilla.filter((row) => row.method === "np");
  /** Cobros, préstamos y N/P: la lista sale con las columnas de la planilla del día. */
  const cierrePlanillaPayments: PaymentRow[] | null =
    cierreListKind === "efectivo"
      ? cierreEfectivoPayments
      : cierreListKind === "efectivoCadena"
        ? cierreEfectivoCadenaPayments
        : cierreListKind === "banco"
          ? (historyDayChainT?.ownDigitalPayments ?? null)
          : cierreListKind === "bancoCadena"
            ? (historyDayChainT?.digitalPayments ?? null)
          : cierreListKind === "bancoRuta"
            ? cierreBancoRutaPayments
            : cierreListKind === "nequiRuta"
              ? cierreNequiRutaPayments
              : null;
  /** Renglones «Préstamo · P-…» del cierre como filas de planilla (M y T separadas por ruta). */
  const cierreLoanLineRows = (lines: RouteExpenseLine[]) =>
    cierreLoanPlanillaRows(
      lines.map((line, index) => {
        const loanRef = String(line.loanRef || "").trim();
        const fromLabel = line.label.split(" · ").slice(loanRef ? 2 : 1).join(" · ");
        return cierreLoanPlanillaRow(loanRef, Number(line.amount) || 0, fromLabel || line.label, index);
      }),
    );
  const cierrePlanillaRows: CollectorHistoryPlanillaRow[] | null =
    cierreListKind === "np"
      ? cierreNpRows
      : cierreListKind === "prestamos"
        ? cierreLoanLineRows(cierrePrestamos)
        : cierreListKind === "prestamosCadena"
          ? cierreLoanLineRows(openRouteHistoryDayExpenseSplit.prestamos)
        : cierreListKind === "prestamosBanco"
          ? cierreLoanPlanillaRows(
              cierreBancoLoans.map((row, index) =>
                cierreLoanPlanillaRow(row.loanRef, row.capital, row.clientName, index),
              ),
            )
          : cierrePlanillaPayments && cajaHistoryDayIso
        ? buildCollectorHistoryPlanillaRows({
            dateIso: cajaHistoryDayIso,
            dispatched: [],
            payments: cierrePlanillaPayments,
            loans,
            clients,
          })
        : null;

  const openRouteNequiDayTotal = openRouteDigitalDayLedger?.total ?? 0;

  function openCobrosReport(method: PaymentMethod | null = null) {
    suppressGhostClick();
    setCobrosMethodFilter(method);
    setDetailMode("cobros");
  }

  /** Ficha digital del día de la ruta: bolsillo de la ruta (A → Nequi; M / T / N → Banco). */
  function openNequiDayFicha(
    dayIso: string,
    backTo: "totales" | "nequi-historial" = "nequi-historial",
  ) {
    const day = normalizeHistoryDate(dayIso) || dayIso;
    suppressGhostClick();
    setCobrosMethodFilter(openRouteDigitalPool);
    setNequiDayIso(day);
    setNequiDayBackTo(backTo);
    setDetailMode("nequi-dia");
  }

  function foldSnHistory() {
    setSnDay(null);
  }

  function openRouteNpSheet() {
    suppressGhostClick();
    setSnDay(null);
    setDetailMode("np");
  }

  function openRouteNpDay(dateIso: string) {
    suppressGhostClick();
    setSnDay(dateIso);
    setDetailMode("np-dia");
  }

  function foldClientesSearch() {
    setClientesSearchOpen(false);
    if (!clientesModifyMode) setClientesEditSearch("");
  }

  function goToView(next: SupervisorView) {
    // Misma pestaña sin detalle de ruta: no resetear (evita click fantasma).
    if (next === view && !openRouteRef && !connectionRouteRef) return;
    suppressGhostClick(420);
    setOpenRouteRef(null);
    setConnectionRouteRef(null);
    setRouteReturnView("inicio");
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setCajaHistoryDayIso(null);
    setInformeTab("general");
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoMode("menu");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setGastoLabel("Gasto");
    setGastoAmount("");
    setGastoAccountRef("");
    setGastoMethod("efectivo");
    setGastoDate(displayToday());
    if (next === "planilla") {
      setPlanillaRouteFilter(pickDefaultRoutePin(planillaRoutePins));
    } else {
      setPlanillaRouteFilter(null);
    }
    if (next === "clientes") {
      setClientesRouteFilter(pickDefaultRoutePin(planillaRoutePins));
    } else {
      setClientesRouteFilter(null);
      setClientesLoanClientRef(null);
      resetClientesModify();
      setClientesSearchOpen(false);
    }
    if (next === "nequi") {
      setNequiRutaExpand(null);
      setNequiRegistroDay(null);
    }
    if (next === "banco") {
      setBancoRegistroRoute(null);
      setBancoGastosOpen(false);
      setBancoRutaExpand(null);
      setBancoRegistroDay(null);
    }
    if (next === "prestamos") {
      setPrestamosRouteFilter(pickDefaultRoutePin(planillaRoutePins));
    } else {
      setPrestamoFichaRef(null);
      setPrestamosSearch("");
      setPrestamosSearchOpen(false);
      setPrestamosRouteFilter(null);
    }
    foldSnHistory();
    setView(next);
  }

  /** INICIO solo por gesto intencional: cierra todo y queda en home. */
  function goHome() {
    if (view === "inicio" && !openRouteRef && !prestamoFichaRef && !clientesLoanClientRef) {
      return;
    }
    suppressGhostClick(420);
    setOpenRouteRef(null);
    setRouteReturnView("inicio");
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setCajaHistoryDayIso(null);
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoMode("menu");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setPlanillaRouteFilter(null);
    setClientesRouteFilter(null);
    setClientesLoanClientRef(null);
    setNequiRegistroRoute(null);
    setBancoRegistroRoute(null);
    setBancoGastosOpen(false);
    setBancoRutaExpand(null);
    setBancoRegistroDay(null);
    resetClientesModify();
    setClientesSearchOpen(false);
    setPrestamoFichaRef(null);
    setPrestamosSearch("");
    setPrestamosRouteFilter(null);
    foldSnHistory();
    setView("inicio");
  }

  function resetClientesModify() {
    setClientesModifyMode(false);
    setClientesEditRef(null);
    setClientesEditSearch("");
    setEditName("");
    setEditLastName("");
    setEditPhone("");
    setEditDocument("");
    setEditAddress("");
    setEditCity("");
    setEditBarrio("");
    setEditNotes("");
    setEditRoute("");
    setEditPos("");
    setEditMsg("");
  }

  function openClientesEdit(clientRef: string) {
    const row = clients.find((entry) => entry.ref === clientRef);
    if (!row) return;
    setClientesLoanClientRef(null);
    setClientesEditRef(row.ref);
    setEditName(row.name ?? "");
    setEditLastName(row.lastName ?? "");
    setEditPhone(row.phone ?? "");
    setEditDocument(row.document ?? "");
    setEditAddress(row.address ?? "");
    setEditCity(row.city ?? "");
    setEditBarrio(row.barrio ?? "");
    setEditNotes(row.notes ?? "");
    setEditRoute(row.route ?? "");
    setEditPos(String(row.routeOrder > 0 ? row.routeOrder : nextRouteOrder(clients, row.route)));
    setEditMsg("");
  }

  function submitClientesEdit() {
    if (!onUpdateClient || !clientesEditRef) return;
    const name = editName.trim();
    if (!name) {
      setEditMsg("Escriba el nombre del cliente.");
      return;
    }
    const route = editRoute.trim();
    if (!route) {
      setEditMsg("Elija la ruta del cliente.");
      return;
    }
    const nextPos = nextRouteOrder(clients, route);
    const pos = Math.min(
      Math.max(1, Math.trunc(Number(String(editPos).replace(/\D/g, ""))) || nextPos),
      Math.max(nextPos, clients.filter((row) => row.route === route && row.ref !== clientesEditRef).length + 1),
    );
    onUpdateClient({
      ref: clientesEditRef,
      name,
      lastName: editLastName.trim(),
      phone: editPhone.trim(),
      document: editDocument.trim(),
      address: editAddress.trim(),
      city: editCity.trim(),
      barrio: editBarrio.trim(),
      notes: editNotes.trim(),
      route,
      routeOrder: pos,
    });
    resetClientesModify();
  }

  function resetNuevoFlow() {
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setGastoLabel("Gasto");
    setGastoAmount("");
    setGastoAccountRef("");
    setGastoMethod("efectivo");
    setGastoDate(displayToday());
  }

  const activeBankAccounts = useMemo(
    () => bankAccounts.filter((row) => row.active),
    [bankAccounts],
  );

  function submitNuevoGasto() {
    if (!onSaveMiscPayment) {
      setNuevoMsg("No hay permiso para registrar gastos.");
      return;
    }
    const amount = Number(String(gastoAmount).replace(/\D/g, ""));
    if (!(amount > 0)) {
      setNuevoMsg("Indique el importe del gasto.");
      return;
    }
    const accountRef = activeBankAccounts.some((row) => row.ref === gastoAccountRef)
      ? gastoAccountRef
      : "";
    if (!accountRef) {
      setNuevoMsg("Elija la cuenta de donde sale el gasto.");
      return;
    }
    const payment = createMiscPayment({
      paidDate: gastoDate || displayToday(),
      label: gastoLabel.trim() || "Gasto",
      amount,
      bankAccountRef: accountRef,
      method: normalizePaymentMethod(gastoMethod),
      existing: miscPayments,
    });
    onSaveMiscPayment(payment);
    resetNuevoFlow();
    setNuevoMode("menu");
    setNuevoMsg(`Gasto ${payment.ref} registrado en Banco.`);
  }

  const planillaAssignments = useMemo(() => {
    const compare = assignmentRoutePositionComparator(clients);
    if (!planillaRouteFilter) return todayAssignments.slice().sort(compare);
    // Filtro por ruta = solo esa ruta (Ruta 1 no arrastra a Ruta 1.1 del mismo cobrador).
    const onRoute = todayAssignments.filter((row) =>
      sameRoute(assignmentRouteName(row, clients), planillaRouteFilter),
    );
    if (onRoute.length > 0) return onRoute.sort(compare);
    const fromCatalog = catalogRoutes(routes).find((row) =>
      sameRoute(row.name, planillaRouteFilter),
    );
    const collectorRef = fromCatalog?.collectorRef || "";
    return collectorRef
      ? todayAssignments.filter((row) => row.collectorRef === collectorRef).sort(compare)
      : [];
  }, [clients, todayAssignments, planillaRouteFilter, routes]);

  const supervisorClientRows = useMemo(() => {
    // Lista = todos los clientes operativos del sistema (filtro de ruta opcional).
    const base = clientesRouteFilter
      ? clientsOnRouteSorted(clients, clientesRouteFilter).filter(isOperationalClient)
      : clients.filter(isOperationalClient).slice().sort(compareClientsByRoutePosition);

    return base.map((row) => {
      const loan = currentActiveLoan(row.ref, loans, payments);
      const cuotas = computeLoanCuotasProgress(loan, payments, today);
      return {
        ref: row.ref,
        route: String(row.route || "").trim(),
        routeOrder: row.routeOrder || 0,
        name: `${row.name} ${row.lastName}`.trim(),
        phone: row.phone?.trim() || "—",
        cuotas,
        saldo: loan ? loan.balance : null,
        hasLoan: Boolean(loan),
      };
    });
  }, [clients, clientesRouteFilter, loans, payments, today]);

  const clientesSearchActive = clientesModifyMode || clientesSearchOpen;
  const clientesModifyRows = useMemo(() => {
    const q = clientesEditSearch.trim().toLowerCase();
    if (!q) return supervisorClientRows;
    return supervisorClientRows.filter((row) => {
      const client = clients.find((entry) => entry.ref === row.ref);
      const hay = `${row.name} ${row.phone} ${client?.document ?? ""} ${row.ref}`.toLowerCase();
      return hay.includes(q);
    });
  }, [supervisorClientRows, clientesEditSearch, clients]);
  const clientesListRows = clientesSearchActive ? clientesModifyRows : supervisorClientRows;

  const clientesEditClient =
    clients.find((row) => row.ref === clientesEditRef) ?? null;

  const editRouteOptions = useMemo(
    () =>
      catalogRoutes(routes)
        .filter((row) => routeIsActive(row))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [routes],
  );

  const clientesLoanClient =
    clients.find((row) => row.ref === clientesLoanClientRef) ?? null;
  const clientesLoanSynced = clientesLoanClient
    ? currentActiveLoan(clientesLoanClient.ref, loans, payments)
    : null;
  const clientesPdfReport = useMemo(() => {
    if (!clientesLoanSynced || !clientesLoanClient) return null;
    // Misma ficha del sistema: préstamo sincronizado + todos los pagos (con método/evidencia).
    return buildLoanReport(clientesLoanSynced, clientesLoanClient, paymentsWithEvidence, assignments);
  }, [assignments, clientesLoanClient, clientesLoanSynced, paymentsWithEvidence]);
  const clientesDetailOpen = Boolean(clientesLoanClientRef);

  /** Préstamos actuales (saldo vivo): uno por cliente, el activo a la fecha. */
  const prestamosEnRuta = useMemo(() => {
    const byClient = new Map<string, LoanRow>();
    for (const loan of loans) {
      if (!loan.clientRef) continue;
      const synced = syncLoan(loan, payments) as LoanRow;
      if (!isLoanActive(synced)) continue;
      if (!(Number(synced.balance) > 0)) continue;
      const prev = byClient.get(loan.clientRef);
      if (!prev) {
        byClient.set(loan.clientRef, synced);
        continue;
      }
      const da = displayToIso(synced.date) || synced.date || "";
      const db = displayToIso(prev.date) || prev.date || "";
      if (da.localeCompare(db) > 0 || (da === db && synced.ref.localeCompare(prev.ref) > 0)) {
        byClient.set(loan.clientRef, synced);
      }
    }
    let rows = [...byClient.values()];
    if (prestamosRouteFilter) {
      rows = rows.filter((loan) => {
        const client = clients.find((row) => row.ref === loan.clientRef);
        return sameRoute(client?.route, prestamosRouteFilter);
      });
    }
    return rows.sort((a, b) => {
      const clientA = clients.find((row) => row.ref === a.clientRef);
      const clientB = clients.find((row) => row.ref === b.clientRef);
      const byRoute = compareRouteNames(clientA?.route || "", clientB?.route || "");
      if (byRoute) return byRoute;
      if (clientA && clientB) return compareClientsByRoutePosition(clientA, clientB);
      return (a.client || "").localeCompare(b.client || "", "es");
    });
  }, [clients, loans, payments, prestamosRouteFilter]);

  /** Suma de saldos de la ruta del pin activo (1 / 1.1 / 2). */
  const prestamosSaldoRuta = useMemo(
    () =>
      prestamosEnRuta.reduce((sum, loan) => sum + Math.max(0, Number(loan.balance) || 0), 0),
    [prestamosEnRuta],
  );

  const prestamosActuales = useMemo(() => {
    const q = prestamosSearch.trim().toLowerCase();
    if (!q) return prestamosEnRuta;
    return prestamosEnRuta.filter((loan) => {
      const hay = `${loan.client} ${loan.ref} ${loan.date} ${loan.clientRef || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [prestamosEnRuta, prestamosSearch]);

  const prestamoFichaLoan = prestamoFichaRef
    ? loans.find((row) => row.ref === prestamoFichaRef) ?? null
    : null;
  const prestamoFichaClient = prestamoFichaLoan
    ? clients.find((row) => row.ref === prestamoFichaLoan.clientRef) ?? null
    : null;
  const prestamoPdfReport = useMemo(() => {
    if (!prestamoFichaLoan || !prestamoFichaClient) return null;
    const synced = syncLoan(prestamoFichaLoan, paymentsWithEvidence) as LoanRow;
    return buildLoanReport(synced, prestamoFichaClient, paymentsWithEvidence, assignments);
  }, [assignments, paymentsWithEvidence, prestamoFichaClient, prestamoFichaLoan]);

  const nuevoRoute = liquidaciones.find((row) => row.routeRef === nuevoRouteRef) ?? null;

  const eligibleLoanClients = useMemo(() => {
    if (!nuevoRoute) return [];
    const q = nuevoClientSearch.trim().toLowerCase();
    return clientsEligibleForNewLoan(clients, loans, nuevoRoute.routeName).filter((row) => {
      if (!q) return true;
      const hay = `${row.name} ${row.lastName} ${row.document} ${row.phone} ${row.ref}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clients, loans, nuevoRoute, nuevoClientSearch]);

  /** Misma grilla/posición que la pestaña CLIENTES. */
  const eligibleLoanClientRows = useMemo(
    () =>
      eligibleLoanClients.map((row) => {
        const loan = currentActiveLoan(row.ref, loans, payments);
        const cuotas = computeLoanCuotasProgress(loan, payments, today);
        return {
          ref: row.ref,
          route: String(row.route || "").trim(),
          routeOrder: row.routeOrder || 0,
          name: `${row.name} ${row.lastName}`.trim(),
          phone: row.phone?.trim() || "—",
          cuotas,
          saldo: loan ? loan.balance : null,
          hasLoan: Boolean(loan),
        };
      }),
    [eligibleLoanClients, loans, payments, today],
  );

  const nuevoLoanClient =
    eligibleLoanClients.find((row) => row.ref === nuevoLoanClientRef) ??
    clients.find((row) => row.ref === nuevoLoanClientRef) ??
    null;

  async function saveNuevoRouteClient(draft: RouteClientDraft) {
    if (!onCreateRouteClient) return false;
    const ok = await onCreateRouteClient(draft);
    if (!ok) return false;
    setNuevoMsg(`Listo: ${draft.name} quedó en la ruta ${draft.route}, posición ${draft.routeOrder}.`);
    setNuevoMode("menu");
    return true;
  }

  function closeRouteDetail() {
    const backTo = routeReturnView;
    suppressGhostClick();
    setOpenRouteRef(null);
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setCajaHistoryDayIso(null);
    foldSnHistory();
    setRouteReturnView("inicio");
    setView(backTo);
  }

  function openCajaHistorial() {
    suppressGhostClick();
    setCajaHistoryDayIso(null);
    setDetailMode("historial");
  }

  function openCajaHistorialDay(dateIso: string) {
    suppressGhostClick();
    setCajaHistoryDayIso(dateIso);
    setDetailMode("historial-dia");
  }

  function openRouteSummary(
    ref: string,
    opts?: { method?: PaymentMethod | null; returnView?: SupervisorView },
  ) {
    const route = liquidaciones.find((row) => row.routeRef === ref);
    if (route?.collectorRef) {
      const methodFilter =
        opts?.method === "nequi" || opts?.method === "banco" ? opts.method : undefined;
      markRouteDaySeen(
        route.collectorRef,
        route.routeRef,
        route.routeName,
        today,
        collectors,
        paymentsWithEvidence,
        loans,
        clients,
        methodFilter,
      );
      if (methodFilter === "nequi") {
        setUnreadByRouteNequi((current) => ({ ...current, [route.routeRef]: 0 }));
        setUnreadByRoute((current) => ({
          ...current,
          [route.routeRef]: unreadPaymentCountForRoute(
            route.collectorRef,
            route.routeRef,
            route.routeName,
            today,
            collectors,
            paymentsWithEvidence,
            loans,
            clients,
          ),
        }));
      } else if (methodFilter === "banco") {
        setUnreadByRouteBanco((current) => ({ ...current, [route.routeRef]: 0 }));
        setUnreadByRoute((current) => ({
          ...current,
          [route.routeRef]: unreadPaymentCountForRoute(
            route.collectorRef,
            route.routeRef,
            route.routeName,
            today,
            collectors,
            paymentsWithEvidence,
            loans,
            clients,
          ),
        }));
      } else {
        setUnreadByRoute((current) => ({ ...current, [route.routeRef]: 0 }));
        setUnreadByRouteNequi((current) => ({ ...current, [route.routeRef]: 0 }));
        setUnreadByRouteBanco((current) => ({ ...current, [route.routeRef]: 0 }));
        unreadTotalRef.current = Math.max(
          0,
          unreadTotalRef.current - (unreadByRoute[route.routeRef] || 0),
        );
      }
    }
    // Ficha de ruta (totales / planilla / historial / N/P) vive bajo INICIO.
    // Nequi/Banco siguen volviendo a su panel. INFORME no captura esa ficha.
    const backTo =
      opts?.returnView === "nequi" || opts?.returnView === "banco"
        ? opts.returnView
        : "inicio";
    suppressGhostClick();
    setOpenRouteRef(ref);
    setReloanClientRef(null);
    setRouteReturnView(backTo);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setCajaHistoryDayIso(null);
    foldSnHistory();
    if (
      (opts?.method === "nequi" && opts.returnView === "nequi") ||
      (opts?.method === "banco" && opts.returnView === "banco")
    ) {
      setCobrosMethodFilter(opts.method);
      setDetailMode("nequi-historial");
    } else if (opts && "method" in opts) {
      setCobrosMethodFilter(opts.method ?? null);
      setDetailMode("cobros");
    } else {
      setCobrosMethodFilter(null);
    setDetailMode("totales");
    }
    setView(backTo);
  }

  const dateLabel = today.split("-").reverse().join("/");

  return (
    <div className="supervisor-mobile">
      <header className="collector-mobile-header supervisor-mobile-header">
        <div className="collector-mobile-brand">
          <div>
            <strong>{supervisor.name}</strong>
          </div>
        </div>
        <span className="supervisor-mobile-date">{dateLabel}</span>
      </header>

      <div className="supervisor-mobile-nav-block">
      <div
          className="supervisor-mobile-kpis is-home has-nuevo has-clientes has-nequi has-banco"
        role="group"
        aria-label="Menú supervisor"
      >
        <button
          type="button"
          className={
            view === "inicio" &&
            (!openRoute ||
              (cobrosMethodFilter !== "nequi" && cobrosMethodFilter !== "banco"))
              ? "supervisor-mobile-kpi is-inicio on"
              : "supervisor-mobile-kpi is-inicio"
          }
          aria-current={
            view === "inicio" &&
            (!openRoute ||
              (cobrosMethodFilter !== "nequi" && cobrosMethodFilter !== "banco"))
              ? "page"
              : undefined
          }
          {...navButtonProps(navIntent, goHome)}
        >
          <b>INICIO</b>
        </button>
        <button
          type="button"
          className={
            view === "planilla"
              ? "supervisor-mobile-kpi is-ruta on"
              : "supervisor-mobile-kpi is-ruta"
          }
          aria-current={view === "planilla" ? "page" : undefined}
          {...navButtonProps(navIntent, () => {
            if (view === "planilla" && !openRouteRef) return;
            goToView("planilla");
          })}
        >
          <b>RUTA</b>
        </button>
        <button
          type="button"
          className={
            view === "banco" || cobrosMethodFilter === "banco"
              ? "supervisor-mobile-kpi is-banco on"
              : "supervisor-mobile-kpi is-banco"
          }
          aria-current={view === "banco" || cobrosMethodFilter === "banco" ? "page" : undefined}
          {...navButtonProps(navIntent, () => {
            if (view === "banco" && !openRouteRef) return;
            goToView("banco");
          })}
          title="Panel Banco"
        >
          <b>BANCO</b>
        </button>
        <button
          type="button"
          className={
            view === "nequi" || cobrosMethodFilter === "nequi"
              ? "supervisor-mobile-kpi is-nequi on"
              : "supervisor-mobile-kpi is-nequi"
          }
          aria-current={view === "nequi" || cobrosMethodFilter === "nequi" ? "page" : undefined}
          {...navButtonProps(navIntent, () => {
            if (view === "nequi" && !openRouteRef) return;
            goToView("nequi");
          })}
          title="Panel Nequi"
        >
          <b>NEQUI</b>
        </button>
        <button
          type="button"
          className={
            view === "nuevo" || view === "prestamos"
              ? "supervisor-mobile-kpi is-nuevo on"
              : "supervisor-mobile-kpi is-nuevo"
          }
          aria-current={view === "nuevo" || view === "prestamos" ? "page" : undefined}
          {...navButtonProps(navIntent, () => {
            if (view === "nuevo" && !openRouteRef) return;
            goToView("nuevo");
          })}
        >
          <b>NUEVO</b>
        </button>
        <button
          type="button"
          className={
            view === "clientes"
              ? "supervisor-mobile-kpi is-clientes on"
              : "supervisor-mobile-kpi is-clientes"
          }
          aria-current={view === "clientes" ? "page" : undefined}
          {...navButtonProps(navIntent, () => {
            if (view === "clientes" && !openRouteRef) return;
            setClientesLoanClientRef(null);
            goToView("clientes");
          })}
        >
          <b>CLIENTES</b>
        </button>
        <button
          type="button"
          className={
            view === "informe" && !openRoute
              ? "supervisor-mobile-kpi is-caja on"
              : "supervisor-mobile-kpi is-caja"
          }
          aria-current={view === "informe" && !openRoute ? "page" : undefined}
          {...navButtonProps(navIntent, () => {
            if (openRoute) {
              setOpenRouteRef(null);
              setDetailMode("totales");
              setCobrosMethodFilter(null);
              setCajaHistoryDayIso(null);
              setRouteReturnView("inicio");
              goToView("informe");
              return;
            }
            if (view === "informe") return;
            goToView("informe");
          })}
          title="Informe"
        >
          <b>INFORME</b>
        </button>
      </div>
      </div>

      {openRoute ? (
        <section className="supervisor-mobile-section">
          {detailMode !== "gastos" && detailMode !== "cobros" ? (
          <div className="supervisor-mobile-detail-head">
            <h3>
              Ruta {openRoute.routeName} · {openRoute.collectorName}
            </h3>
            <button
              type="button"
                className="collector-mobile-pay-link is-back"
              onClick={() => {
                  if (detailMode === "nequi-dia") {
                    setNequiDayIso(null);
                    setDetailMode(nequiDayBackTo);
                    return;
                  }
                  if (detailMode === "nequi-historial") {
                    closeRouteDetail();
                    return;
                  }
                  if (detailMode === "historial-dia") {
                    setCajaHistoryDayIso(null);
                    setDetailMode("historial");
                    return;
                  }
                  if (detailMode === "historial") {
                  setDetailMode("totales");
                    return;
                  }
                  if (detailMode === "np-dia") {
                    setSnDay(null);
                    setDetailMode("np");
                    return;
                  }
                  if (detailMode === "np") {
                    setDetailMode("totales");
                    return;
                  }
                  if (detailMode !== "totales") setDetailMode("totales");
                  else closeRouteDetail();
              }}
            >
              volver
            </button>
          </div>
          ) : null}

          {detailMode === "nequi-historial" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                Historial {openRouteDigitalLabel} por día
              </p>
              {openRouteDigitalDays.length === 0 ? (
                <p className="ficha-empty">Sin movimientos {openRouteDigitalLabel} en esta ruta.</p>
              ) : (
                <ul
                  className={`supervisor-nequi-day-list${openRouteDigitalPool === "banco" ? " is-banco" : ""}`}
                  aria-label={`Días con ${openRouteDigitalLabel}`}
                >
                  {openRouteDigitalDays.map((day) => (
                    <li key={day.date}>
                      <button
                        type="button"
                        className="supervisor-nequi-day-row"
                        onClick={() => openNequiDayFicha(day.date, "nequi-historial")}
                      >
                        <span className="is-date">{day.dateLabel}</span>
                        <span className="is-count">
                          {poolDayCountLabel(day.count, day.loanCount)}
                        </span>
                        <b className={day.amount < 0 ? "is-amount is-negative" : "is-amount"}>
                          {money(day.amount, { symbol: false })}
                        </b>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : detailMode === "historial" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                Historial · Ruta {openRoute.routeName} · {openRoute.collectorName}
              </p>
              <div
                className={
                  openRouteCajaHistoryIsM
                    ? "collector-mobile-day-history is-supervisor-caja is-chain-m"
                    : "collector-mobile-day-history is-supervisor-caja"
                }
              >
                <div className="collector-mobile-day-history-head">
                  <span>Día</span>
                  {openRouteCajaHistoryIsM ? <span>Inicial</span> : null}
                  <span>Cobros</span>
                  <span>Préstamo</span>
                  <span>Gasto</span>
                  <span>Saldo</span>
                </div>
                <ul className="collector-mobile-day-history-list">
                  {openRouteCajaHistory.length === 0 ? (
                    <li className="collector-mobile-day-history-empty">
                      Sin cierres en los últimos 5 días.
                    </li>
                  ) : openRouteCajaHistoryIsM ? (
                    openRouteCajaHistory.map((row) => {
                      const extract = row as {
                        date: string;
                        dateLabel: string;
                        cobro: number;
                        gasto: number;
                        prestamo: number;
                        inicial: number | null;
                        saldoShown: number | null;
                      };
                      return (
                        <li key={extract.date}>
                          <button
                            type="button"
                            className={
                              extract.date === cajaHistoryDayIso
                                ? "collector-mobile-day-history-row on"
                                : "collector-mobile-day-history-row"
                            }
                            onClick={() => openCajaHistorialDay(extract.date)}
                          >
                            <span className="is-date">{extract.dateLabel}</span>
                            <span className="is-money is-inicial-col">
                              {extract.inicial == null
                                ? "—"
                                : money(extract.inicial, { symbol: false })}
                            </span>
                            <span className="is-money">
                              {money(extract.cobro, { symbol: false })}
                            </span>
                            <span className="is-money">
                              {money(extract.prestamo, { symbol: false })}
                            </span>
                            <span className="is-money">
                              {money(extract.gasto, { symbol: false })}
                            </span>
                            <span
                              className={
                                extract.saldoShown != null && extract.saldoShown < 0
                                  ? "is-saldo is-negative is-saldo-strong"
                                  : "is-saldo is-saldo-strong"
                              }
                            >
                              {extract.saldoShown == null
                                ? "—"
                                : money(extract.saldoShown, { symbol: false })}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  ) : (
                    (
                      openRouteAdjustHistory ??
                      openRouteCajaHistory.map((row) => ({
                        row: row as {
                          date: string;
                          dateLabel: string;
                          cobro: number;
                          gasto: number;
                          prestamo: number;
                          saldo: number;
                        },
                        adjustment: null,
                      }))
                    ).map(({ row: plain, adjustment }) => {
                      const adjustable = tCashAdjustDate != null && plain.date === tCashAdjustDate;
                      const openAdjust = () => setCashAdjustCollectorRef(openRoute.collectorRef);
                      const delta = adjustment ? cashAdjustmentDelta(adjustment) : 0;
                      return (
                        <Fragment key={plain.date}>
                          <li>
                            <button
                              type="button"
                              className={
                                plain.date === cajaHistoryDayIso
                                  ? "collector-mobile-day-history-row on"
                                  : "collector-mobile-day-history-row"
                              }
                              onClick={() => openCajaHistorialDay(plain.date)}
                            >
                              <span className="is-date">{plain.dateLabel}</span>
                              <span className="is-money">
                                {money(plain.cobro, { symbol: false })}
                              </span>
                              <span className="is-money">
                                {money(plain.prestamo, { symbol: false })}
                              </span>
                              <span className="is-money">
                                {money(plain.gasto, { symbol: false })}
                              </span>
                              <span
                                className={[
                                  "is-saldo is-saldo-strong",
                                  plain.saldo < 0 ? "is-negative" : "",
                                  adjustable ? "is-adjustable" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                {...(adjustable
                                  ? {
                                      role: "button",
                                      tabIndex: 0,
                                      title: "Ajustar saldo real",
                                      onClick: (event: ReactMouseEvent) => {
                                        event.stopPropagation();
                                        openAdjust();
                                      },
                                      onKeyDown: (event: ReactKeyboardEvent) => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openAdjust();
                                      },
                                    }
                                  : {})}
                              >
                                {money(plain.saldo, { symbol: false })}
                              </span>
                            </button>
                          </li>
                          {adjustment ? (
                            <li>
                              <button
                                type="button"
                                className={
                                  adjustable
                                    ? "collector-mobile-day-history-row is-adjustment is-editable"
                                    : "collector-mobile-day-history-row is-adjustment"
                                }
                                disabled={!adjustable}
                                onClick={openAdjust}
                                title={cashAdjustmentNote(adjustment)}
                              >
                                <span className="is-date">{plain.dateLabel}</span>
                                <span className="is-money">Ajuste</span>
                                <span className="is-money" />
                                <span className="is-money">
                                  {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                                  {money(Math.abs(delta), { symbol: false })}
                                </span>
                                <span className="is-saldo is-saldo-strong">
                                  {money(adjustment.real, { symbol: false })}
                                </span>
                              </button>
                              <p className="collector-mobile-day-history-note">
                                {cashAdjustmentNote(adjustment)}
                              </p>
                            </li>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </ul>
              </div>
              {tCashAdjustTarget && cashAdjustCollectorRef === openRoute.collectorRef ? (
                <CashAdjustForm
                  dateLabel={tCashAdjustTarget.row.dateLabel}
                  calculated={tCashAdjustTarget.row.saldo}
                  currentReal={tCashAdjustTarget.adjustment?.real}
                  currentReason={tCashAdjustTarget.adjustment?.reason}
                  onSubmit={submitTCashAdjust}
                  onCancel={() => setCashAdjustCollectorRef(null)}
                />
              ) : tCashAdjustTarget ? (
                <p className="supervisor-mobile-subhead">
                  {openRoute.routeName} ya cerró hoy: toque el saldo del{" "}
                  {tCashAdjustTarget.row.dateLabel} para ajustarlo al saldo real (hasta
                  medianoche).
                </p>
              ) : null}
              {canReopenSheet && reopenConfirmKey === sheetReopenKey ? (
                <div className="supervisor-mobile-subhead">
                  <p>
                    ¿Reabrir la hoja {reopenRoutesLabel} de hoy? Las visitas sin cobrar vuelven a
                    pendiente; los cobros hechos se quedan. El cobrador cobra y vuelve a cerrar
                    (el saldo final se recalcula).
                  </p>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={reopeningSheet}
                    onClick={() => void confirmReopenSheet()}
                  >
                    {reopeningSheet ? "Reabriendo…" : `Sí, reabrir ${reopenRoutesLabel}`}
                  </button>{" "}
                  <button
                    type="button"
                    className="btn"
                    disabled={reopeningSheet}
                    onClick={() => setReopenConfirmKey(null)}
                  >
                    Cancelar
                  </button>
                </div>
              ) : canReopenSheet ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setReopenConfirmKey(sheetReopenKey)}
                >
                  Reabrir hoja de hoy
                </button>
              ) : null}
            </>
          ) : detailMode === "historial-dia" && openRouteHistoryDayCuadre ? (
            <section
              className="collector-mobile-home-cuadre is-supervisor-caja-day"
              aria-label={`Cierre ${cajaHistoryDayIso ? isoToDisplay(cajaHistoryDayIso) : ""}`}
            >
              <div className="collector-mobile-home-cuadre-head">
                <div className="collector-mobile-home-cuadre-title-row">
                  <Pill label="Cierre" kind="paid" />
                  <h2>del día</h2>
                  <p className="collector-mobile-home-cuadre-progress">
                    {cajaHistoryDayIso ? isoToDisplay(cajaHistoryDayIso) : ""}
                  </p>
                </div>
              </div>
              <div className="collector-mobile-home-cuadre-grid is-inicio-triple">
                <div className="is-inicial">
                  <span>Lo que inició</span>
                  <b>{money(openRouteHistoryDayCuadre.saldoInicial)}</b>
                </div>
                <button
                  type="button"
                  className={`is-prestamos is-tap${cierreListKind === "prestamos" ? " on" : ""}`}
                  data-cierre-keep
                  aria-expanded={cierreListKind === "prestamos"}
                  onClick={() => toggleCierreList("prestamos")}
                >
                  <span>Lo que prestó</span>
                  <b>{money(cierrePrestamosTotal)}</b>
                </button>
                <button
                  type="button"
                  className={`is-gastos is-tap${cierreListKind === "gastos" ? " on" : ""}`}
                  data-cierre-keep
                  aria-expanded={cierreListKind === "gastos"}
                  onClick={() => toggleCierreList("gastos")}
                >
                  <span>Lo que gastó</span>
                  <b>{money(cierreGastosTotal)}</b>
                </button>
                <div className="is-cobrado">
                  <div className="is-cobrado-head">
                    <span>Lo que cobró</span>
                  </div>
                  <div
                    className={`is-cobrado-means${historyDayMeansCols}`}
                    aria-label="Desglose de lo cobrado"
                  >
                    {historyDayChainT ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-efectivo is-tap-mean${cierreListKind === "efectivo" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "efectivo"}
                        onClick={() => toggleCierreList("efectivo")}
                      >
                        <span>Efectivo T</span>
                        <b>{money(historyDayChainT.ownEfectivo)}</b>
                      </button>
                    ) : null}
                    {historyDayChainT ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-efectivo is-tap-mean${cierreListKind === "efectivoCadena" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "efectivoCadena"}
                        onClick={() => toggleCierreList("efectivoCadena")}
                      >
                        <span>Efectivo M+T</span>
                        <b>{money(openRouteHistoryDayCuadre.cobradoEfectivo)}</b>
                      </button>
                    ) : cierreEfectivoPayments ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-efectivo is-tap-mean${cierreListKind === "efectivo" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "efectivo"}
                        onClick={() => toggleCierreList("efectivo")}
                      >
                        <span>Efectivo</span>
                        <b>{money(openRouteHistoryDayCuadre.cobradoEfectivo)}</b>
                      </button>
                    ) : (
                      <div className="is-mean is-pay-efectivo">
                        <span>Efectivo</span>
                        <b>{money(openRouteHistoryDayCuadre.cobradoEfectivo)}</b>
                      </div>
                    )}
                    {historyDayChainT ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-banco is-tap-mean${cierreListKind === "banco" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "banco"}
                        onClick={() => toggleCierreList("banco")}
                      >
                        <span>Banco T</span>
                        {/* Regla: Banco T = historial Banco de T (cobros). Incluye oficina. No toca caja. */}
                        <b>{money(historyDayChainT.ownDigital)}</b>
                      </button>
                    ) : null}
                    {historyDayShowNequiValue && cierreBancoRutaPayments ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-banco is-tap-mean${cierreListKind === "bancoRuta" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "bancoRuta"}
                        onClick={() => toggleCierreList("bancoRuta")}
                      >
                        <span>Banco</span>
                        <b>{money(historyDayDigitalAmount)}</b>
                      </button>
                    ) : historyDayShowNequiValue && historyDayChainT ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-banco is-tap-mean${cierreListKind === "bancoCadena" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "bancoCadena"}
                        onClick={() => toggleCierreList("bancoCadena")}
                      >
                        <span>Banco M+T</span>
                        <b>{money(historyDayDigitalAmount)}</b>
                      </button>
                    ) : historyDayShowNequiValue ? (
                      <div className="is-mean is-pay-banco">
                        <span>{openRouteCajaHistoryIsT ? "Banco M+T" : "Banco"}</span>
                        <b>{money(historyDayDigitalAmount)}</b>
                      </div>
                    ) : null}
                    {historyDayShowBancoValue && cierreNequiRutaPayments ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-nequi is-tap-mean${cierreListKind === "nequiRuta" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "nequiRuta"}
                        onClick={() => toggleCierreList("nequiRuta")}
                      >
                        <span>Nequi</span>
                        <b>{money(historyDayNequiBoxAmount)}</b>
                      </button>
                    ) : historyDayShowBancoValue ? (
                      <div className="is-mean is-pay-nequi">
                        <span>Nequi</span>
                        {/* Regla: Nequi A = historial Nequi de A. Exclusivo de A. No toca caja. */}
                        <b>{money(historyDayNequiBoxAmount)}</b>
                      </div>
                    ) : null}
                    {historyDayChainT ? (
                      <button
                        type="button"
                        className={`is-mean is-prestamos is-tap-mean${cierreListKind === "prestamosCadena" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "prestamosCadena"}
                        onClick={() => toggleCierreList("prestamosCadena")}
                      >
                        <span>Préstamo M+T</span>
                        <b>{money(openRouteHistoryDayExpenseSplit.prestamosTotal)}</b>
                      </button>
                    ) : null}
                    {historyDayChainT ? (
                      <button
                        type="button"
                        className={`is-mean is-pay-banco is-tap-mean${cierreListKind === "prestamosBanco" ? " on" : ""}`}
                        data-cierre-keep
                        aria-expanded={cierreListKind === "prestamosBanco"}
                        onClick={() => toggleCierreList("prestamosBanco")}
                      >
                        <span>Préstamos B M+T</span>
                        <b>{money(cierreBancoLoansTotal)}</b>
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="collector-cierre-saldo-row">
                  <button
                    type="button"
                    className={`collector-cierre-np-btn${cierreListKind === "np" ? " on" : ""}`}
                    data-cierre-keep
                    aria-label="N/P del día"
                    aria-expanded={cierreListKind === "np"}
                    onClick={() => toggleCierreList("np")}
                  >
                    <span>N</span>
                    <span>/</span>
                    <span>P</span>
                    <em className="collector-cierre-np-count">{cierreNpRows.length}</em>
                  </button>
                  <div className="is-saldo">
                    <span>Caja (efectivo − gastos − préstamos)</span>
                    <b>{money(openRouteHistoryDayCuadre.enCaja)}</b>
                  </div>
                </div>
                {cierreListKind && !cierrePlanillaRows ? (
                  <div
                    className={`collector-cierre-drop is-${cierreListKind}`}
                    data-cierre-keep
                    aria-label={CIERRE_LIST_TITLE[cierreListKind]}
                  >
                    <p className="collector-cierre-drop-title">{CIERRE_LIST_TITLE[cierreListKind]}</p>
                    {cierreListLines.length === 0 ? (
                      <p className="collector-cierre-drop-empty">{CIERRE_LIST_EMPTY[cierreListKind]}</p>
                    ) : (
                      <ul>
                        {cierreListLines.map((line) => (
                          <li key={line.key}>
                            <span className="is-label">{line.label}</span>
                            <b>{money(line.amount, { symbol: false })}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
              {cierreListKind && cierrePlanillaRows ? (
                <div data-cierre-keep aria-label={CIERRE_LIST_TITLE[cierreListKind]}>
                  {cierrePlanillaRows.length === 0 ? (
                    <p className="collector-cierre-drop-empty">{CIERRE_LIST_EMPTY[cierreListKind]}</p>
                  ) : (
                    <CollectorDayCloseExtras
                      dateLabel={cajaHistoryDayIso ? isoToDisplay(cajaHistoryDayIso) : ""}
                      planillaRows={cierrePlanillaRows}
                      planillaTitle={CIERRE_LIST_TITLE[cierreListKind]}
                      loansSheet={
                        cierreListKind === "prestamos" ||
                        cierreListKind === "prestamosCadena" ||
                        cierreListKind === "prestamosBanco"
                      }
                      cierreSheet
                      prestamos={[]}
                      prestamosTotal={0}
                    />
                  )}
                </div>
              ) : null}
            </section>
          ) : detailMode === "historial-dia" ? (
            <p className="ficha-empty">Sin datos de cierre para ese día.</p>
          ) : detailMode === "nequi-dia" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                <span>{nequiDayIso ? isoToDisplay(nequiDayIso) : ""}</span>
                <span className="supervisor-mobile-detail-sep" aria-hidden>
                  ·
                </span>
                <span>
                  {poolDayCountLabel(openRouteNequiDayPays.length, openRouteNequiDayLoans.length)}
                </span>
              </p>
              {openRouteNequiDayPays.length === 0 && openRouteNequiDayLoans.length === 0 ? (
                <p className="ficha-empty">Sin movimientos {openRouteDigitalLabel} ese día.</p>
              ) : (
                <>
                  {openRouteNequiDayPays.some((pay) => !pay.evidence?.some((e) => e.previewUrl)) ? (
                    <p className="supervisor-nequi-evidence-hint">
                      Si ves un +, la foto está solo en el celular que cobró. Abrí ese celular
                      (misma app) o subila acá con +.
                    </p>
                  ) : null}
                  {renderNequiDayList(
                    openRouteNequiDayPays,
                    openRouteNequiDayLoans,
                    openRouteNequiDayTotal,
                  )}
                </>
              )}
            </>
          ) : detailMode === "gastos" ? (
            <CollectorClosedDayReview
              detail="gastos"
              dateLabel={todayDisplay}
              visits={openAssignments}
              expenses={openRouteExpenses}
              payments={paymentsWithEvidence}
              cobradoCount={openRoute.done}
              visitTotal={openRoute.planilla}
              onBack={() => setDetailMode("totales")}
            />
          ) : detailMode === "cobros" ? (
            <CollectorClosedDayReview
              detail="cobros"
              dateLabel={todayDisplay}
              visits={openAssignments}
              expenses={openRouteExpenses}
              payments={paymentsWithEvidence}
              cobradoCount={openRoute.done}
              visitTotal={openRoute.planilla}
              methodFilter={cobrosMethodFilter ?? undefined}
              onAttachPaymentEvidence={onAttachPaymentEvidence}
              onBack={() => {
                if (routeReturnView === "nequi") {
                  setNequiDayIso(null);
                  setDetailMode("nequi-historial");
                  return;
                }
                if (routeReturnView === "banco") {
                  setCobrosMethodFilter(null);
                  setOpenRouteRef(null);
                  setView("banco");
                  return;
                }
                setCobrosMethodFilter(null);
                setDetailMode("totales");
              }}
            />
          ) : detailMode === "totales" ? (
            <>
              <div className="supervisor-mobile-sheet" aria-label="Liquidación de caja">
                <div className="supervisor-mobile-sheet-row is-primary-row">
                  <span className="is-primary-title">Saldo inicial</span>
                  <b>{money(openRoute.saldoInicial, { symbol: false })}</b>
                </div>
                <div
                  className="supervisor-mobile-sheet-means"
                  aria-label="Desglose por medio de pago"
                >
                  <div className="is-title-means">
                    <span className="is-primary-title">Cobrado hoy</span>
                </div>
                  <button
                    type="button"
                    className="is-pay-efectivo is-tap-means"
                    onClick={() => openCobrosReport("efectivo")}
                    aria-label="Ver cobros en efectivo"
                  >
                    <span>Efectivo</span>
                    <b>{money(openRoute.cobradoEfectivo, { symbol: false })}</b>
                  </button>
                  {routeMeansShowNequiValue ? (
                    <button
                      type="button"
                      className="is-pay-banco is-tap-means"
                      onClick={() => openNequiDayFicha(today, "totales")}
                      aria-label="Ver cobros Banco del día"
                    >
                      <span>Banco</span>
                      <b>{money(routeDigitalAmount, { symbol: false })}</b>
                    </button>
                  ) : null}
                  {routeMeansShowBancoValue ? (
                    <button
                      type="button"
                      className="is-pay-nequi is-tap-means"
                      onClick={() => openCobrosReport(routeNequiBoxMethod)}
                      aria-label="Ver cobros Nequi del día"
                    >
                      <span>Nequi</span>
                      <b>{money(routeNequiBoxAmount, { symbol: false })}</b>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="is-renewal-means is-tap-means"
                    onClick={() => setDetailMode("renovados")}
                    aria-label="Ver renovados del día"
                    title="Renovados hoy: lo que debía + 20 % · sin plata"
                  >
                    <span>Renovado</span>
                    <b>{openRoute.renewals.length}</b>
                  </button>
                  <button
                    type="button"
                    className="is-total-means is-tap-means is-final-box"
                    onClick={() => openCobrosReport(null)}
                    aria-label="Ver todos los cobros"
                  >
                    <span>Total</span>
                    <b>{money(openRoute.cobradoHoy, { symbol: false })}</b>
                  </button>
                </div>
                <div className="supervisor-mobile-sheet-pair">
                  <button
                    type="button"
                    className="supervisor-mobile-sheet-row is-tap is-gastos is-primary-row"
                    onClick={() => setDetailMode("gastos")}
                    aria-label="Ver reporte de gastos del día"
                  >
                    <span className="is-primary-title">Gasto</span>
                    <b>{money(openRoute.gastosHoy, { symbol: false })}</b>
                  </button>
                  <button
                    type="button"
                    className="supervisor-mobile-sheet-row is-tap is-prestamo-ruta is-primary-row"
                    onClick={() => setDetailMode("prestamos")}
                    aria-label="Ver préstamos del día en esta ruta"
                  >
                    <span className="is-primary-title">Préstamo</span>
                    <b>{money(openRoute.prestamosHoy, { symbol: false })}</b>
                  </button>
                </div>
                <div className="supervisor-mobile-cuadre is-four" aria-label="Cuadre de caja">
                  <div className="supervisor-mobile-cuadre-title is-primary-title">Cuadre</div>
                  <div>
                    <span>Inicial</span>
                    <b>{money(openRoute.saldoInicial, { symbol: false })}</b>
                  </div>
                  <div>
                    <span>Efectivo</span>
                    <b>{money(openRoute.cobradoEfectivo, { symbol: false })}</b>
                  </div>
                  <div>
                    <span>Gasto</span>
                    <b>{money(openRoute.gastosHoy, { symbol: false })}</b>
                  </div>
                  <div className="is-cuadre-prestamo">
                    <span>Préstamo</span>
                    <b>{money(openRoute.prestamosHoy, { symbol: false })}</b>
                  </div>
                  <div className="is-final">
                    <span>Final</span>
                  <b>{money(openRoute.enCaja, { symbol: false })}</b>
                  </div>
                </div>
                <div className="supervisor-mobile-sheet-row is-muted">
                  <span>Avance planilla</span>
                  <b>
                    {openRoute.done}/{openRoute.planilla || 0}
                  </b>
                </div>
              </div>

              <div className="supervisor-mobile-actions has-historial has-np">
                <button
                  type="button"
                  className="supervisor-route-act is-planilla"
                  disabled={openAssignments.length === 0}
                  onClick={() => {
                    foldSnHistory();
                    setDetailMode("planilla");
                  }}
                >
                  <b>PLANILLA</b>
                </button>
                <button
                  type="button"
                  className="supervisor-route-act is-gastos"
                  onClick={() => {
                    foldSnHistory();
                    setDetailMode("gastos");
                  }}
                >
                  <b>GASTOS</b>
                </button>
                <button
                  type="button"
                  className="supervisor-route-act is-cobros"
                  disabled={openRoute.cobradoHoy <= 0}
                  onClick={() => {
                    foldSnHistory();
                    openCobrosReport(null);
                  }}
                >
                  <b>COBROS</b>
                </button>
                <button
                  type="button"
                  className="supervisor-route-act is-prestamos"
                  disabled={openRoute.newLoans.length + openRoute.renewals.length === 0}
                  onClick={() => {
                    foldSnHistory();
                    setDetailMode("prestamos");
                  }}
                >
                  <b>PRÉSTAMOS</b>
                </button>
                <button
                  type="button"
                  className="supervisor-route-act is-historial"
                  onClick={() => {
                    foldSnHistory();
                    openCajaHistorial();
                  }}
                >
                  <b>HISTORIAL</b>
                </button>
                <button
                  type="button"
                  className="supervisor-route-act is-np"
                  onClick={openRouteNpSheet}
                  title={`No pagan · Ruta ${openRoute.routeName}`}
                >
                  <b>N/P</b>
                </button>
              </div>
            </>
          ) : detailMode === "np" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                N/P · Ruta {openRoute.routeName} · {openRoute.collectorName}
              </p>
              {openRouteNpByDay.todayRows.length === 0 &&
              openRouteNpByDay.past.length === 0 ? (
                <p className="ficha-empty">Sin registro N/P en esta ruta.</p>
              ) : (
                <ul className="supervisor-nequi-day-list" aria-label={`N/P por día · Ruta ${openRoute.routeName}`}>
                  {(openRouteNpByDay.todayRows.length > 0
                    ? [{ date: today, rows: openRouteNpByDay.todayRows }]
                    : []
                  )
                    .concat(openRouteNpByDay.past)
                    .map((day) => {
                      const label =
                        day.date === today ? "Hoy" : isoToDisplay(day.date);
                      return (
                        <li key={day.date}>
                          <button
                            type="button"
                            className="supervisor-nequi-day-row"
                            onClick={() => openRouteNpDay(day.date)}
                          >
                            <span className="is-date">{label}</span>
                            <span className="is-count">
                              {day.rows.length} cliente
                              {day.rows.length === 1 ? "" : "s"}
                            </span>
                            <b className="is-amount">{day.rows.length}</b>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </>
          ) : detailMode === "np-dia" && snDay ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                N/P ·{" "}
                {snDay === today ? "Hoy" : isoToDisplay(snDay)} · Ruta{" "}
                {openRoute.routeName}
              </p>
              <SnPeople
                rows={openRouteNpDayRows}
                empty="Nadie ese día en esta ruta"
                dateLabel={
                  snDay === today ? todayDisplay : isoToDisplay(snDay)
                }
              />
            </>
          ) : detailMode === "renovados" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                Renovados hoy · {openRoute.renewals.length} · Ruta {openRoute.routeName}
              </p>
              {openRoute.renewals.length === 0 ? (
                <p className="ficha-empty">Sin renovados hoy en esta ruta.</p>
              ) : (
                <ul className="supervisor-mobile-list is-loans-today is-renewals-today">
                  {openRoute.renewals.map((loan, index) => {
                    const client = clients.find((row) => row.ref === loan.clientRef);
                    const name = client
                      ? `${client.name} ${client.lastName}`.trim()
                      : (loan.client || "").trim() || loan.ref;
                    return (
                      <li
                        key={loan.ref}
                        title={`${loan.ref} · renovación de ${loanRenewalOf(loan) ?? "—"} · debía ${money(loan.capital)} + 20 % = ${money(loan.total ?? loan.capital)} · sin plata`}
                      >
                        <strong className="is-name">{name}</strong>
                        <b className="is-amount">{money(loan.capital, { symbol: false })}</b>
                        <span className="is-kind is-count">{index + 1}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          ) : detailMode === "planilla" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                <span>Planilla</span>
                <span className="supervisor-mobile-detail-sep" aria-hidden>
                  ·
                </span>
                <span>
                  {openRoute.done}/{openRoute.planilla}
                </span>
                <span className="supervisor-mobile-detail-sep" aria-hidden>
                  ·
                </span>
                <span>En caja {money(openRoute.enCaja, { symbol: false })}</span>
              </p>
              {reloanClient && onCreateQuickLoan ? (
                <div className="supervisor-reloan-panel" aria-label="Préstamo al terminar">
                  <div className="supervisor-mobile-detail-head">
                    <h3>{`${reloanClient.name} ${reloanClient.lastName}`.trim()}</h3>
                    <button
                      type="button"
                      className="collector-mobile-pay-link"
                      onClick={() => setReloanClientRef(null)}
                    >
                      cerrar
                    </button>
                  </div>
                  <p className="supervisor-mobile-subhead">
                    Terminó su crédito hoy · Ruta {reloanClient.route || openRoute.routeName} ·{" "}
                    {openRoute.collectorName}
                  </p>
                  <QuickLoanForm
                    key={reloanClient.ref}
                    clientName={`${reloanClient.name} ${reloanClient.lastName}`.trim()}
                    clientRef={reloanClient.ref}
                    fundedByOptions={["nequi", "banco", "efectivo"]}
                    defaultFundedBy="nequi"
                    onCancel={() => setReloanClientRef(null)}
                    onSave={(draft) => {
                      onCreateQuickLoan({ ...draft, routeName: reloanClient.route });
                      setReloanClientRef(null);
                    }}
                  />
                </div>
              ) : null}
              {openAssignments.length === 0 ? (
                <p className="ficha-empty">Sin planilla enviada hoy.</p>
              ) : (
                <PlanillaTable
                  rows={planillaTableRows(openAssignments)}
                  onReloan={
                    onCreateQuickLoan
                      ? (clientRef) =>
                          setReloanClientRef((prev) => (prev === clientRef ? null : clientRef))
                      : undefined
                  }
                  reloanClientRef={reloanClientRef}
                />
              )}
            </>
          ) : (
            <>
              <p className="supervisor-mobile-detail-meta">
                Préstamos en caja hoy · {openRoute.cashLoansToday.length}
                {openRoute.cashLoansToday.length > 0
                  ? ` · ${money(openRoute.prestamosHoy, { symbol: false })}`
                  : ""}
              </p>
              {openRoute.cashLoansToday.length === 0 ? (
                <p className="ficha-empty">Sin desembolsos en efectivo hoy en esta ruta.</p>
              ) : (
                <ul className="supervisor-mobile-list is-loans-today">
                  {openRoute.cashLoansToday.map((loan, index) => (
                    <li key={loan.loanRef}>
                      <strong className="is-name">{loan.clientName}</strong>
                      <b className="is-amount">
                        {money(loan.capital, { symbol: false })}
                      </b>
                      <span className="is-kind is-count" title="Desembolso en caja">
                        {index + 1}
                        </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      ) : view === "planilla" ? (
        <section className="supervisor-mobile-section">
          <div className="supervisor-planilla-head">
            <h3>Planilla de hoy</h3>
            {planillaRoutePins.length > 0 ? (
              <div
                className="supervisor-planilla-route-btns"
                role="group"
                aria-label="Filtrar por ruta"
              >
                {planillaRoutePins.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={
                      planillaRouteFilter && sameRoute(planillaRouteFilter, name)
                        ? "collector-mobile-route-pin on"
                        : "collector-mobile-route-pin"
                    }
                    onClick={() =>
                      setPlanillaRouteFilter((prev) =>
                        prev && sameRoute(prev, name) ? null : name,
                      )
                    }
                    title={`Ruta ${name}`}
                    aria-label={`Ruta ${name}`}
                  >
                    <b>{name}</b>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {planillaAssignments.length === 0 ? (
            <p className="ficha-empty">No hay cobros en planilla hoy.</p>
          ) : (
            <PlanillaTable rows={planillaTableRows(planillaAssignments)} />
          )}
        </section>
      ) : view === "informe" ? (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          <div className="supervisor-informe-switch" role="tablist" aria-label="Informe">
            <button
              type="button"
              role="tab"
              aria-selected={informeTab === "general"}
              className={informeTab === "general" ? "on" : undefined}
              onClick={() => setInformeTab("general")}
            >
              General
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={informeTab === "angelica"}
              className={informeTab === "angelica" ? "on" : undefined}
              onClick={() => setInformeTab("angelica")}
            >
              Angélica
            </button>
          </div>
          {informeTab === "general" ? (
            <SupervisorMonthlyReport
              loans={loans}
              clients={clients}
              payments={payments}
              efectivo={informeEfectivo}
              banco={bancoSaldo}
              corteLabel={todayDisplay}
              history={informeHistory}
            />
          ) : (
            <SupervisorOwnRouteReport
              route={INFORME_A_ROUTE}
              loans={loans}
              clients={clients}
              payments={payments}
              efectivo={informeAEfectivo}
              nequi={nequiRutaSaldo}
              corteLabel={todayDisplay}
              history={informeAHistory}
            />
          )}
        </section>
      ) : view === "nequi" ? (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          <div className="supervisor-nequi-registro-head">
            <h3>Nequi · Ruta {NEQUI_ROUTE_PIN}</h3>
          </div>
          <section
            className="collector-mobile-home-cuadre is-supervisor-caja-day is-banco-ruta"
            aria-label={`Nequi ruta ${NEQUI_ROUTE_PIN}`}
          >
            <div className="collector-mobile-home-cuadre-grid is-banco-dos is-nequi-tres">
              <button
                type="button"
                className={`is-banco-cobrado is-tap${nequiRutaExpand === "cobrado" ? " on" : ""}`}
                aria-expanded={nequiRutaExpand === "cobrado"}
                onClick={() => {
                  suppressGhostClick();
                  setNequiRegistroDay(null);
                  setNequiRutaExpand((prev) => (prev === "cobrado" ? null : "cobrado"));
                }}
              >
                <span>Cobrado</span>
                <b>{money(nequiRutaTotales.cobrado, { symbol: false })}</b>
              </button>
              <button
                type="button"
                className={`is-prestamos is-tap${nequiRutaExpand === "prestado" ? " on" : ""}`}
                aria-expanded={nequiRutaExpand === "prestado"}
                onClick={() => {
                  suppressGhostClick();
                  setNequiRegistroDay(null);
                  setNequiRutaExpand((prev) => (prev === "prestado" ? null : "prestado"));
                }}
              >
                <span>Prestado</span>
                <b>{money(nequiRutaTotales.prestado, { symbol: false })}</b>
              </button>
              <button
                type="button"
                className={`is-nequi-gastos is-tap${nequiRutaExpand === "gastos" ? " on" : ""}`}
                aria-expanded={nequiRutaExpand === "gastos"}
                title="Gastos pagados desde Nequi"
                onClick={() => {
                  suppressGhostClick();
                  setNequiRegistroDay(null);
                  setNequiRutaExpand((prev) => (prev === "gastos" ? null : "gastos"));
                }}
              >
                <span>Gastos</span>
                <b>{money(nequiGastado, { symbol: false })}</b>
              </button>
              <button
                type="button"
                className="is-nequi-saldo"
                title="Saldo Nequi ruta A (cobrado − prestado − gastos)"
                aria-label={`Saldo Nequi ruta A ${money(nequiRutaSaldo, { symbol: false })}`}
              >
                <span>Saldo</span>
                <b>{money(nequiRutaSaldo, { symbol: false })}</b>
              </button>
            </div>
          </section>
          {nequiRutaExpand === "cobrado" ? (
            nequiCobradoDays.length > 0 ? (
              <div className="supervisor-banco-hist">
                <div className="supervisor-banco-hist-head" aria-hidden>
                  <span>Fecha</span>
                  <span>Inicial</span>
                  <span>Cobrado</span>
                  <span>Final</span>
                </div>
                <ul
                  className="supervisor-nequi-day-list is-banco is-cobrado-hist"
                  aria-label="Fecha inicial cobrado final"
                >
                {nequiCobradoDays.map((day) => {
                  const open = nequiRegistroDay === day.date;
                  return (
                    <li key={day.date} data-pool-day={day.date}>
                      <button
                        type="button"
                        className={
                          open
                            ? "supervisor-nequi-day-row on"
                            : "supervisor-nequi-day-row"
                        }
                        aria-expanded={open}
                        onClick={() => {
                          suppressGhostClick();
                          setNequiRegistroDay((prev) =>
                            prev === day.date ? null : day.date,
                          );
                        }}
                      >
                        <span className="is-date">{isoToDisplay(day.date)}</span>
                        <span className="is-ini">
                          {money(day.inicio, { symbol: false })}
                        </span>
                        <span className="is-cob">
                          {money(day.cobrado, { symbol: false })}
                        </span>
                        <span className="is-fin">
                          {money(day.final, { symbol: false })}
                        </span>
                      </button>
                      {open ? (
                        <div className="supervisor-banco-day-drop">
                          {renderNequiDayList(day.items, [], undefined)}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                </ul>
              </div>
            ) : (
              <p className="ficha-empty">Sin cobros Nequi en ruta A.</p>
            )
          ) : null}
          {nequiRutaExpand === "prestado" ? (
            nequiPrestadoDays.length > 0 ? (
              <div className="supervisor-banco-hist">
                <div className="supervisor-banco-hist-head" aria-hidden>
                  <span>Fecha</span>
                  <span>Inicial</span>
                  <span>Prestado</span>
                  <span>Final</span>
                </div>
                <ul
                  className="supervisor-nequi-day-list is-banco is-prestado-hist"
                  aria-label="Fecha inicial prestado final"
                >
                {nequiPrestadoDays.map((day) => {
                  const open = nequiRegistroDay === day.date;
                  return (
                    <li key={day.date} data-pool-day={day.date}>
                      <button
                        type="button"
                        className={
                          open
                            ? "supervisor-nequi-day-row on"
                            : "supervisor-nequi-day-row"
                        }
                        aria-expanded={open}
                        onClick={() => {
                          suppressGhostClick();
                          setNequiRegistroDay((prev) =>
                            prev === day.date ? null : day.date,
                          );
                        }}
                      >
                        <span className="is-date">{isoToDisplay(day.date)}</span>
                        <span className="is-ini">
                          {money(day.inicio, { symbol: false })}
                        </span>
                        <span className="is-pre">
                          {money(day.prestado, { symbol: false })}
                        </span>
                        <span className="is-fin">
                          {money(day.final, { symbol: false })}
                        </span>
                      </button>
                      {open ? (
                        <div className="supervisor-banco-day-drop">
                          {renderNequiDayList([], day.loans, undefined)}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                </ul>
              </div>
            ) : (
              <p className="ficha-empty">Sin préstamos Nequi en ruta A.</p>
            )
          ) : null}
          {nequiRutaExpand === "gastos"
            ? renderPoolGastos("nequi", nequiGastos, nequiGastado)
            : null}
        </section>
      ) : view === "banco" ? (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          <div className="supervisor-nequi-registro-head">
            <h3>
              {bancoRegistroRoute
                ? `Banco · Ruta ${bancoRegistroRoute}`
                : bancoGastosOpen
                  ? "Banco · Gastos"
                  : "Banco"}
            </h3>
            {bancoRegistroRoute || bancoGastosOpen ? (
              <button
                type="button"
                className="collector-mobile-pay-link is-back"
                onClick={() => {
                  setBancoRegistroRoute(null);
                  setBancoGastosOpen(false);
                  setBancoRutaExpand(null);
                  setBancoRegistroDay(null);
                }}
              >
                volver
              </button>
            ) : null}
          </div>
          {bancoGastosOpen ? (
            renderPoolGastos("banco", bancoGastos, bancoGastado)
          ) : !bancoRegistroRoute ? (
            <div
              className="supervisor-banco-home-grid"
              role="group"
              aria-label="Ruta M, Ruta T, Ruta N, Gastos y Saldo de Banco"
            >
              {bancoRouteCuadres.map((row, index) => (
                <button
                  key={row.route}
                  type="button"
                  className={`supervisor-banco-home-btn is-route-${row.route} accent-${index % 2}`}
                  title={`Ruta ${row.route}`}
                  aria-label={`Ruta ${row.route} saldo ${money(row.saldo, { symbol: false })}`}
                  onClick={() => {
                    suppressGhostClick();
                    setBancoRegistroRoute(row.route);
                    setBancoRutaExpand(null);
                    setBancoRegistroDay(null);
                  }}
                >
                  <span>Ruta {row.route}</span>
                  <span className="is-amount">{money(row.saldo, { symbol: false })}</span>
                </button>
              ))}
              <button
                type="button"
                className="supervisor-banco-home-btn is-gastos"
                title="Gastos pagados desde Banco"
                aria-label={`Gastos ${money(bancoGastado, { symbol: false })}`}
                onClick={() => {
                  suppressGhostClick();
                  setBancoGastosOpen(true);
                  setBancoRutaExpand(null);
                  setBancoRegistroDay(null);
                }}
              >
                <span>Gastos</span>
                <span className="is-amount">{money(bancoGastado, { symbol: false })}</span>
              </button>
              <button
                type="button"
                className="supervisor-banco-home-btn is-acumulado"
                title="Saldo de Banco (M + T + N − Gastos)"
                aria-label={`Saldo de Banco ${money(bancoSaldo, { symbol: false })}`}
              >
                <span>Saldo</span>
                <span className="is-amount">{money(bancoSaldo, { symbol: false })}</span>
              </button>
            </div>
          ) : bancoRutaCuadreHoy ? (
            <>
              <section
                className="collector-mobile-home-cuadre is-supervisor-caja-day is-banco-ruta"
                aria-label={`Banco ruta ${bancoRutaCuadreHoy.route}`}
              >
                <div className="collector-mobile-home-cuadre-grid is-banco-dos">
                  <button
                    type="button"
                    className={`is-banco-cobrado is-tap${bancoRutaExpand === "cobrado" ? " on" : ""}`}
                    aria-expanded={bancoRutaExpand === "cobrado"}
                    onClick={() => {
                      suppressGhostClick();
                      setBancoRegistroDay(null);
                      setBancoRutaExpand((prev) => (prev === "cobrado" ? null : "cobrado"));
                    }}
                  >
                    <span>Cobrado</span>
                    <b>{money(bancoRutaTotales.cobrado, { symbol: false })}</b>
                  </button>
                  <button
                    type="button"
                    className={`is-prestamos is-tap${bancoRutaExpand === "prestado" ? " on" : ""}`}
                    aria-expanded={bancoRutaExpand === "prestado"}
                    onClick={() => {
                      suppressGhostClick();
                      setBancoRegistroDay(null);
                      setBancoRutaExpand((prev) => (prev === "prestado" ? null : "prestado"));
                    }}
                  >
                    <span>Prestado</span>
                    <b>{money(bancoRutaTotales.prestado, { symbol: false })}</b>
                  </button>
                </div>
              </section>
              {bancoRutaExpand === "cobrado" ? (
                bancoCobradoDays.length > 0 ? (
                  <div className="supervisor-banco-hist">
                    <div className="supervisor-banco-hist-head" aria-hidden>
                      <span>Fecha</span>
                      <span>Inicial</span>
                      <span>Cobrado</span>
                      <span>Final</span>
                    </div>
                    <ul
                      className="supervisor-nequi-day-list is-banco is-cobrado-hist"
                      aria-label="Fecha inicial cobrado final"
                    >
                    {bancoCobradoDays.map((day) => {
                      const open = bancoRegistroDay === day.date;
                      return (
                        <li key={day.date} data-pool-day={day.date}>
                          <button
                            type="button"
                            className={
                              open
                                ? "supervisor-nequi-day-row on"
                                : "supervisor-nequi-day-row"
                            }
                            aria-expanded={open}
                            onClick={() => {
                              suppressGhostClick();
                              setBancoRegistroDay((prev) =>
                                prev === day.date ? null : day.date,
                              );
                            }}
                          >
                            <span className="is-date">{isoToDisplay(day.date)}</span>
                            <span className="is-ini">
                              {money(day.inicio, { symbol: false })}
                            </span>
                            <span className="is-cob">
                              {money(day.cobrado, { symbol: false })}
                            </span>
                            <span className="is-fin">
                              {money(day.final, { symbol: false })}
                            </span>
                          </button>
                          {open ? (
                            <div className="supervisor-banco-day-drop">
                              {renderNequiDayList(day.items, [], undefined)}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    </ul>
                  </div>
                ) : (
                  <p className="ficha-empty">
                    Sin cobros Banco en ruta {bancoRutaCuadreHoy.route}.
                  </p>
                )
              ) : null}
              {bancoRutaExpand === "prestado" ? (
                bancoPrestadoDays.length > 0 ? (
                  <div className="supervisor-banco-hist">
                    <div className="supervisor-banco-hist-head" aria-hidden>
                      <span>Fecha</span>
                      <span>Inicial</span>
                      <span>Prestado</span>
                      <span>Final</span>
                    </div>
                    <ul
                      className="supervisor-nequi-day-list is-banco is-prestado-hist"
                      aria-label="Fecha inicial prestado final"
                    >
                    {bancoPrestadoDays.map((day) => {
                      const open = bancoRegistroDay === day.date;
                      return (
                        <li key={day.date} data-pool-day={day.date}>
                          <button
                            type="button"
                            className={
                              open
                                ? "supervisor-nequi-day-row on"
                                : "supervisor-nequi-day-row"
                            }
                            aria-expanded={open}
                            onClick={() => {
                              suppressGhostClick();
                              setBancoRegistroDay((prev) =>
                                prev === day.date ? null : day.date,
                              );
                            }}
                          >
                            <span className="is-date">{isoToDisplay(day.date)}</span>
                            <span className="is-ini">
                              {money(day.inicio, { symbol: false })}
                            </span>
                            <span className="is-pre">
                              {money(day.prestado, { symbol: false })}
                            </span>
                            <span className="is-fin">
                              {money(day.final, { symbol: false })}
                            </span>
                          </button>
                          {open ? (
                            <div className="supervisor-banco-day-drop">
                              {renderNequiDayList([], day.loans, undefined)}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                    </ul>
                  </div>
                ) : (
                  <p className="ficha-empty">
                    Sin préstamos Banco en ruta {bancoRutaCuadreHoy.route}.
                  </p>
                )
              ) : null}
            </>
          ) : (
            <p className="ficha-empty">No hay rutas Banco (M, T, N).</p>
          )}
        </section>
      ) : view === "nuevo" ? (
        <section className="supervisor-mobile-section">
          {nuevoMode === "menu" ? (
            <>
              <div className="supervisor-mobile-detail-head">
              <h3>Nuevo</h3>
                <button
                  type="button"
                  className="collector-mobile-pay-link"
                  onClick={() => goToView("prestamos")}
                >
                  Ver préstamos
                </button>
              </div>
              {nuevoMsg ? <p className="supervisor-nuevo-msg">{nuevoMsg}</p> : null}
              <div className="supervisor-nuevo-menu">
                <button
                  type="button"
                  className="supervisor-nuevo-menu-btn is-cliente"
                  disabled={!onCreateRouteClient || planillaRoutePins.length === 0}
                  onClick={() => {
                    resetNuevoFlow();
                    setNuevoMode("cliente");
                  }}
                >
                  <b>Nuevo cliente</b>
                </button>
                <button
                  type="button"
                  className="supervisor-nuevo-menu-btn is-prestamo"
                  disabled={!onCreateQuickLoan}
                  onClick={() => {
                    resetNuevoFlow();
                    setNuevoMode("prestamo");
                  }}
                >
                  <b>Nuevo préstamo</b>
                </button>
                <button
                  type="button"
                  className="supervisor-nuevo-menu-btn is-gasto"
                  disabled={!onSaveMiscPayment || activeBankAccounts.length === 0}
                  onClick={() => {
                    resetNuevoFlow();
                    setNuevoMode("gasto");
                  }}
                >
                  <b>Nuevo gasto</b>
                </button>
              </div>
              {!onCreateRouteClient && !onCreateQuickLoan && !onSaveMiscPayment ? (
                <p className="ficha-empty">No hay permiso para crear desde esta vista.</p>
              ) : null}
            </>
          ) : nuevoMode === "gasto" ? (
            <>
              <div className="supervisor-mobile-detail-head">
                <h3>Nuevo gasto</h3>
                <button
                  type="button"
                  className="collector-mobile-pay-link is-back"
                  onClick={() => {
                    resetNuevoFlow();
                    setNuevoMode("menu");
                  }}
                >
                  atrás
                </button>
              </div>
              {!onSaveMiscPayment ? (
                <p className="ficha-empty">No hay permiso para registrar gastos.</p>
              ) : activeBankAccounts.length === 0 ? (
                <p className="ficha-empty">No hay cuentas bancarias activas.</p>
              ) : (
                  <form
                    className="supervisor-nuevo-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                    submitNuevoGasto();
                    }}
                  >
                  <p className="supervisor-mobile-subhead">
                    Queda en Banco → Registros (mismo flujo de pagos varios).
                  </p>
                  {nuevoMsg ? <p className="supervisor-nuevo-msg">{nuevoMsg}</p> : null}
                    <label className="quick-loan-field">
                    <span>Concepto</span>
                      <input
                      value={gastoLabel}
                      onChange={(event) => setGastoLabel(event.target.value)}
                      placeholder="Gasto"
                        autoFocus
                      />
                    </label>
                    <label className="quick-loan-field">
                    <span>Importe</span>
                      <input
                      inputMode="numeric"
                      value={gastoAmount}
                      onChange={(event) => setGastoAmount(event.target.value)}
                      placeholder="0"
                      required
                      />
                    </label>
                    <label className="quick-loan-field">
                    <span>Fecha</span>
                      <input
                      type="date"
                      value={gastoDate}
                      onChange={(event) => setGastoDate(event.target.value)}
                      required
                      />
                    </label>
                  <label className="quick-loan-field">
                    <span>Cuenta</span>
                    <select
                      value={gastoAccountRef}
                      onChange={(event) => setGastoAccountRef(event.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Elegir cuenta…
                      </option>
                      {activeBankAccounts.map((account) => (
                        <option key={account.ref} value={account.ref}>
                          {account.name} · {account.bankName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="quick-loan-field">
                    <span>Forma de pago</span>
                    <select
                      value={gastoMethod}
                      onChange={(event) =>
                        setGastoMethod(normalizePaymentMethod(event.target.value))
                      }
                    >
                      {PAYMENT_METHODS.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </label>
                    <div className="quick-loan-actions">
                      <button type="submit" className="btn" disabled={!gastoAccountRef}>
                      Guardar gasto
                      </button>
                    </div>
                  </form>
              )}
            </>
          ) : nuevoMode === "cliente" ? (
            !onCreateRouteClient || planillaRoutePins.length === 0 ? (
              <p className="ficha-empty">No hay permiso para crear clientes desde esta vista.</p>
            ) : (
              <CollectorNewClientSheet
                routeName={pickDefaultRoutePin(planillaRoutePins) ?? planillaRoutePins[0]}
                routeOptions={planillaRoutePins}
                clients={clients}
                onCancel={() => {
                  resetNuevoFlow();
                  setNuevoMode("menu");
                }}
                onSave={saveNuevoRouteClient}
              />
            )
          ) : (
            <>
              <div className="supervisor-mobile-detail-head">
                <h3>Nuevo préstamo</h3>
                <div className="supervisor-prestamos-head-actions">
                <button
                  type="button"
                  className="collector-mobile-pay-link"
                    onClick={() => goToView("prestamos")}
                  >
                    Ver préstamos
                  </button>
                  <button
                    type="button"
                    className="collector-mobile-pay-link is-back"
                  onClick={() => {
                    if (nuevoLoanClientRef) {
                      setNuevoLoanClientRef(null);
                      return;
                    }
                    if (nuevoRouteRef) {
                      setNuevoRouteRef(null);
                      setNuevoClientSearch("");
                      return;
                    }
                    resetNuevoFlow();
                    setNuevoMode("menu");
                  }}
                >
                  atrás
                </button>
                </div>
              </div>
              {!onCreateQuickLoan ? (
                <p className="ficha-empty">No hay permiso para crear préstamos desde esta vista.</p>
              ) : !nuevoRouteRef ? (
                <>
                  <p className="supervisor-mobile-subhead">
                    Elija la ruta del cobrador que entregará el dinero.
                  </p>
                  {liquidaciones.length === 0 ? (
                    <p className="ficha-empty">No hay rutas con cobrador.</p>
                  ) : (
                    <div className="supervisor-route-boards">
                      {liquidaciones.map((row, index) => (
                        <button
                          key={row.routeRef}
                          type="button"
                          className={`supervisor-route-board accent-${index % 2}${row.closed ? " is-closed" : ""}`}
                          onClick={() => {
                            setNuevoRouteRef(row.routeRef);
                            setNuevoLoanClientRef(null);
                            setNuevoClientSearch("");
                          }}
                        >
                          <div className="supervisor-caja-row">
                            <div className="supervisor-route-board-id">
                              <span className="supervisor-route-board-ruta">Ruta {row.routeName}</span>
                              <strong>{row.collectorName}</strong>
                            </div>
                            <span className="supervisor-nuevo-go">Elegir</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : nuevoLoanClient && nuevoRoute ? (
                <>
                  <div className="supervisor-mobile-detail-head">
                    <h3>
                      {`${nuevoLoanClient.name} ${nuevoLoanClient.lastName}`.trim()}
                    </h3>
                    <button
                      type="button"
                      className="collector-mobile-pay-link"
                      onClick={() => setNuevoLoanClientRef(null)}
                    >
                      cambiar
                    </button>
                  </div>
                  <p className="supervisor-mobile-subhead">
                    Ruta {nuevoRoute.routeName} · {nuevoRoute.collectorName}
                  </p>
                  <QuickLoanForm
                    clientName={`${nuevoLoanClient.name} ${nuevoLoanClient.lastName}`.trim()}
                    clientRef={nuevoLoanClient.ref}
                    fundedByOptions={["nequi", "banco", "efectivo"]}
                    defaultFundedBy="nequi"
                    onCancel={() => setNuevoLoanClientRef(null)}
                    onSave={(draft) => {
                      onCreateQuickLoan({
                        ...draft,
                        routeName: nuevoRoute.routeName,
                      });
                      resetNuevoFlow();
                      setNuevoMode("menu");
                      setNuevoMsg("Préstamo creado y cargado a la ruta.");
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="supervisor-mobile-detail-head">
                    <h3>
                      Ruta {nuevoRoute?.routeName} · {nuevoRoute?.collectorName}
                    </h3>
                    <button
                      type="button"
                      className="collector-mobile-pay-link"
                      onClick={() => {
                        setNuevoRouteRef(null);
                        setNuevoClientSearch("");
                      }}
                    >
                      cambiar
                    </button>
                  </div>
                  <label className="quick-loan-field supervisor-nuevo-search">
                    <span className="sr-only">Buscar</span>
                    <input
                      value={nuevoClientSearch}
                      onChange={(event) => setNuevoClientSearch(event.target.value)}
                      placeholder="Nombre, cédula o celular"
                      autoFocus
                    />
                  </label>
                  {eligibleLoanClientRows.length === 0 ? (
                    <p className="ficha-empty">
                      No hay clientes disponibles en esta ruta
                      {nuevoClientSearch.trim() ? " con ese filtro" : ""}.
                    </p>
                  ) : (
                    <ClientesTable
                      rows={eligibleLoanClientRows}
                      onOpen={(ref) => {
                        suppressGhostClick();
                        setNuevoLoanClientRef(ref);
                      }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </section>
      ) : view === "prestamos" ? (
        <section className="supervisor-mobile-section">
          {prestamoPdfReport ? (
            <SupervisorClientFicha
              report={prestamoPdfReport}
              onBack={() => {
                suppressGhostClick();
                setPrestamoFichaRef(null);
              }}
            />
          ) : (
            <>
              <div className="supervisor-mobile-detail-head">
                <div className="supervisor-planilla-head-start">
                  <h3>Préstamos</h3>
                          <button
                            type="button"
                    className={
                      prestamosSearchOpen
                        ? "collector-history-planilla-search supervisor-clientes-search on"
                        : "collector-history-planilla-search supervisor-clientes-search"
                    }
                    aria-label="Buscar préstamo"
                    aria-pressed={prestamosSearchOpen}
                    onClick={() => {
                      suppressGhostClick();
                      if (prestamosSearchOpen) {
                        setPrestamosSearchOpen(false);
                        setPrestamosSearch("");
                        return;
                      }
                      setPrestamosSearchOpen(true);
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <circle cx="10.5" cy="10.5" r="6.5" />
                      <line x1="15.5" y1="15.5" x2="21" y2="21" />
                    </svg>
                          </button>
                </div>
                <div className="supervisor-prestamos-head-actions">
                  {planillaRoutePins.length > 0 ? (
                    <div
                      className="supervisor-planilla-route-btns"
                      role="group"
                      aria-label="Filtrar préstamos por ruta"
                    >
                      {planillaRoutePins.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className={
                            prestamosRouteFilter && sameRoute(prestamosRouteFilter, name)
                              ? "collector-mobile-route-pin on"
                              : "collector-mobile-route-pin"
                          }
                          onClick={() =>
                            setPrestamosRouteFilter((prev) =>
                              prev && sameRoute(prev, name) ? null : name,
                            )
                          }
                          title={`Ruta ${name}`}
                          aria-label={`Ruta ${name}`}
                        >
                          <b>{name}</b>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="collector-mobile-pay-link is-back"
                    onClick={() => goToView("nuevo")}
                  >
                    volver
                  </button>
                </div>
              </div>
              <div
                className={
                  prestamosSearchOpen
                    ? "supervisor-prestamos-search-row"
                    : "supervisor-prestamos-search-row is-saldo-only"
                }
              >
                {prestamosSearchOpen ? (
                  <label className="quick-loan-field supervisor-nuevo-search supervisor-prestamos-search">
                    <span className="sr-only">Buscar préstamo</span>
                    <input
                      value={prestamosSearch}
                      onChange={(event) => setPrestamosSearch(event.target.value)}
                      placeholder="Buscar cliente o fecha"
                      autoFocus
                    />
                  </label>
                ) : null}
                <div
                  className="supervisor-prestamos-saldo-sum"
                  title={
                    prestamosRouteFilter
                      ? `Saldo ruta ${prestamosRouteFilter}`
                      : "Saldo de préstamos actuales"
                  }
                  aria-label={
                    prestamosRouteFilter
                      ? `Saldo ruta ${prestamosRouteFilter}: ${money(prestamosSaldoRuta, { symbol: false })}`
                      : `Saldo total: ${money(prestamosSaldoRuta, { symbol: false })}`
                  }
                >
                  <span>Saldo</span>
                  <b>{money(prestamosSaldoRuta, { symbol: false })}</b>
                </div>
              </div>
              {prestamosActuales.length === 0 ? (
                <p className="ficha-empty">
                  {prestamosSearch.trim()
                    ? "No hay préstamos activos con ese filtro."
                    : prestamosRouteFilter
                      ? `Sin préstamos activos en ruta ${prestamosRouteFilter}.`
                      : "Sin préstamos activos."}
                </p>
              ) : (
                <ul
                  className="supervisor-mobile-list is-prestamos-hist"
                  aria-label="Préstamos actuales"
                >
                  <li className="is-head" aria-hidden>
                    <span className="is-client">Cliente</span>
                    <span className="is-date">Fecha</span>
                    <span className="is-origin">Origen</span>
                    <span className="is-amount">Total</span>
                    <span className="is-saldo">Saldo</span>
                  </li>
                  {prestamosActuales.map((loan) => {
                    const origin = loanDisbursementSource(loan);
                    const originClass =
                      origin === "nequi"
                        ? "is-nequi"
                        : origin === "efectivo"
                          ? "is-efectivo"
                          : origin === "banco"
                            ? "is-banco"
                            : "is-unknown";
                    const dateShort = formatLoanListDate(loan.date);
                    const totalCobrar =
                      Number(loan.total) > 0
                        ? Math.trunc(Number(loan.total))
                        : Math.trunc(Number(loan.capital) || 0) +
                          Math.trunc(Number(loan.interest) || 0);
                    return (
                      <li key={loan.ref} className={originClass}>
                        <button
                          type="button"
                          className={`supervisor-prestamo-hist-row ${originClass}`}
                          onClick={() => {
                            suppressGhostClick();
                            setPrestamoFichaRef(loan.ref);
                          }}
                        >
                          <strong className="is-client">{loan.client}</strong>
                          <span className="is-date">{dateShort}</span>
                          <em className={`is-origin ${originClass}`}>
                            {origin === "efectivo"
                              ? "Efec"
                              : loanDisbursementSourceLabel(origin)}
                          </em>
                          <b className={`is-amount ${originClass}`} title="Total a cobrar (capital + interés)">
                            {money(totalCobrar, { symbol: false })}
                          </b>
                          <b className="is-saldo">
                            {money(Math.max(0, loan.balance ?? 0), { symbol: false })}
                          </b>
                        </button>
                      </li>
                    );
                  })}
                    </ul>
              )}
            </>
          )}
        </section>
      ) : view === "clientes" ? (
        <section className="supervisor-mobile-section supervisor-mobile-clientes">
          {clientesEditClient && clientesModifyMode ? (
            <>
              <div className="supervisor-mobile-detail-head">
                <h3>Modificar</h3>
                <button
                  type="button"
                  className="collector-mobile-pay-link is-back"
                  onClick={() => {
                    setClientesEditRef(null);
                    setEditMsg("");
                  }}
                >
                  volver
                </button>
              </div>
              {!onUpdateClient ? (
                <p className="ficha-empty">No hay permiso para modificar clientes desde esta vista.</p>
              ) : (
                <form
                  className="supervisor-nuevo-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitClientesEdit();
                  }}
                >
                  <label className="quick-loan-field">
                    <span>Nombre</span>
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      placeholder="Nombre"
                      autoFocus
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Apellido</span>
                    <input
                      value={editLastName}
                      onChange={(event) => setEditLastName(event.target.value)}
                      placeholder="Apellido"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Teléfono</span>
                    <input
                      inputMode="tel"
                      value={editPhone}
                      onChange={(event) => setEditPhone(event.target.value)}
                      placeholder="Celular"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Cédula</span>
                    <input
                      value={editDocument}
                      onChange={(event) => setEditDocument(event.target.value)}
                      placeholder="Documento"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Dirección</span>
                    <input
                      value={editAddress}
                      onChange={(event) => setEditAddress(event.target.value)}
                      placeholder="Dirección"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Ciudad</span>
                    <input
                      value={editCity}
                      onChange={(event) => setEditCity(event.target.value)}
                      placeholder="Ciudad"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Barrio</span>
                    <input
                      value={editBarrio}
                      onChange={(event) => setEditBarrio(event.target.value)}
                      placeholder="Barrio"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Ruta</span>
                    <select
                      value={editRoute}
                      onChange={(event) => {
                        const next = event.target.value;
                        setEditRoute(next);
                        setEditPos(
                          String(
                            nextRouteOrder(
                              clients.filter((row) => row.ref !== clientesEditRef),
                              next,
                            ),
                          ),
                        );
                      }}
                    >
                      <option value="">Elija ruta</option>
                      {editRouteOptions.map((row) => (
                        <option key={row.id} value={row.name}>
                          Ruta {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="quick-loan-field">
                    <span>Posición en la lista</span>
                    <input
                      inputMode="numeric"
                      value={editPos}
                      onChange={(event) => setEditPos(event.target.value)}
                      placeholder="Ej. 1"
                    />
                  </label>
                  <label className="quick-loan-field">
                    <span>Notas</span>
                    <input
                      value={editNotes}
                      onChange={(event) => setEditNotes(event.target.value)}
                      placeholder="Notas"
                    />
                  </label>
                  {editMsg ? <p className="supervisor-nuevo-msg is-warn">{editMsg}</p> : null}
                  <div className="quick-loan-actions">
                    <button type="submit" className="btn">
                      Guardar
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : clientesPdfReport ? (
            <SupervisorClientFicha
              report={clientesPdfReport}
              onBack={() => {
                suppressGhostClick();
                setClientesLoanClientRef(null);
              }}
            />
          ) : clientesDetailOpen && clientesLoanClient ? (
            <div className="supervisor-client-ficha">
              <div className="supervisor-mobile-detail-head">
                <h3>{`${clientesLoanClient.name} ${clientesLoanClient.lastName}`.trim()}</h3>
                <button
                  type="button"
                  className="collector-mobile-pay-link is-back"
                  onClick={() => setClientesLoanClientRef(null)}
                >
                  volver
                </button>
              </div>
              <p className="ficha-empty">
                Sin préstamo activo actual. No hay ficha de cobro para mostrar.
              </p>
            </div>
          ) : (
            <>
              <div className="supervisor-planilla-head">
                <div className="supervisor-planilla-head-start">
                <h3>Clientes</h3>
                  <button
                    type="button"
                    className={
                      clientesModifyMode
                        ? "supervisor-planilla-route-btn supervisor-clientes-modify-btn on"
                        : "supervisor-planilla-route-btn supervisor-clientes-modify-btn"
                    }
                    disabled={!onUpdateClient}
                    onClick={() => {
                      suppressGhostClick();
                      if (clientesModifyMode) {
                        resetClientesModify();
                        return;
                      }
                      setClientesLoanClientRef(null);
                      setClientesModifyMode(true);
                      setClientesEditSearch("");
                      setEditMsg("");
                    }}
                  >
                    <b>{clientesModifyMode ? "CANCELAR" : "MODIFICAR"}</b>
                  </button>
                  <button
                    type="button"
                    className={
                      clientesSearchOpen
                        ? "collector-history-planilla-search supervisor-clientes-search on"
                        : "collector-history-planilla-search supervisor-clientes-search"
                    }
                    aria-label="Buscar cliente"
                    aria-pressed={clientesSearchOpen}
                    onClick={() => {
                      suppressGhostClick();
                      if (clientesSearchOpen) {
                        foldClientesSearch();
                        return;
                      }
                      setClientesSearchOpen(true);
                      if (!clientesModifyMode) setClientesEditSearch("");
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <circle cx="10.5" cy="10.5" r="6.5" />
                      <line x1="15.5" y1="15.5" x2="21" y2="21" />
                    </svg>
                  </button>
                </div>
                {planillaRoutePins.length > 0 ? (
                  <div
                    className="supervisor-planilla-route-btns"
                    role="group"
                    aria-label="Filtrar clientes por ruta"
                  >
                    {planillaRoutePins.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={
                          clientesRouteFilter && sameRoute(clientesRouteFilter, name)
                            ? "collector-mobile-route-pin on"
                            : "collector-mobile-route-pin"
                        }
                        onClick={() =>
                          setClientesRouteFilter((prev) =>
                            prev && sameRoute(prev, name) ? null : name,
                          )
                        }
                        title={`Ruta ${name}`}
                        aria-label={`Ruta ${name}`}
                      >
                        <b>{name}</b>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {clientesSearchActive ? (
                <label className="quick-loan-field supervisor-nuevo-search">
                  <span className="sr-only">Buscar cliente</span>
                  <input
                    type="search"
                    value={clientesEditSearch}
                    onChange={(event) => setClientesEditSearch(event.target.value)}
                    placeholder="Nombre, cédula o celular"
                    autoFocus
                  />
                </label>
              ) : null}
              {clientesListRows.length === 0 ? (
                <p className="ficha-empty">
                  {clientesSearchActive && clientesEditSearch.trim()
                    ? "No hay clientes con ese filtro."
                    : clientesRouteFilter
                    ? `No hay clientes en la ruta ${clientesRouteFilter}.`
                    : "No hay clientes activos."}
                </p>
              ) : (
                <ClientesTable
                  rows={clientesListRows}
                  onOpen={(ref) => {
                    suppressGhostClick();
                    if (clientesModifyMode) {
                      openClientesEdit(ref);
                      return;
                    }
                    const row = clientesListRows.find((entry) => entry.ref === ref);
                    if (row && !row.hasLoan && onCreateQuickLoan) {
                      const client = clients.find((entry) => entry.ref === ref);
                      const routeName = String(client?.route || row.route || "").trim();
                      const board = liquidaciones.find((entry) =>
                        sameRoute(entry.routeName, routeName),
                      );
                      setNuevoMode("prestamo");
                      setNuevoRouteRef(board?.routeRef ?? null);
                      setNuevoLoanClientRef(ref);
                      setNuevoClientSearch("");
                      goToView("nuevo");
                      return;
                    }
                    setClientesLoanClientRef(ref);
                  }}
                />
              )}
            </>
          )}
        </section>
      ) : (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          {connectionRow && connectionByRoute[connectionRow.routeRef] ? (
            <CollectorConnectionSheet
              routeName={connectionRow.routeName}
              collectorName={connectionRow.collectorName}
              connection={connectionByRoute[connectionRow.routeRef]}
              now={deviceStatuses.loadedAt}
              loadedAt={deviceStatuses.loadedAt}
              loadError={deviceStatuses.error}
              onBack={() => {
                suppressGhostClick(420);
                setConnectionRouteRef(null);
              }}
            />
          ) : liquidaciones.length === 0 ? (
            <p className="ficha-empty">No hay rutas con cobrador.</p>
          ) : (
            <div className="supervisor-route-boards">
              {liquidaciones.map((row, index) => (
                <RouteBoardCard
                  key={row.routeRef}
                  row={row}
                  accent={index}
                  unreadCount={unreadByRoute[row.routeRef] || 0}
                  onOpen={openRouteSummary}
                  connectionLevel={connectionByRoute[row.routeRef]?.level ?? "none"}
                  onConnection={() => {
                    suppressGhostClick(420);
                    setConnectionRouteRef(row.routeRef);
                  }}
                />
              ))}
            </div>
          )}
          {connectionRow && connectionByRoute[connectionRow.routeRef] ? null : (
          <footer className="supervisor-mobile-salir-foot">
            {onLogout ? (
              <button
                type="button"
                className="supervisor-mobile-kpi is-salir on"
                onClick={onLogout}
                title="Salir del sistema"
              >
                <b>SALIR</b>
          </button>
            ) : (
              <span className="supervisor-mobile-salir-spacer" aria-hidden />
            )}
            <div
              className="supervisor-caja-hero is-row is-money-lg supervisor-inicio-total"
              title="Saldo ruta T + ruta N + Banco"
              aria-label={`Total ruta T más ruta N más Banco: ${money(inicioTotalConT, { symbol: false })}`}
            >
              <b>{money(inicioTotalConT, { symbol: false })}</b>
            </div>
        </footer>
          )}
        </section>
      )}
    </div>
  );
}
