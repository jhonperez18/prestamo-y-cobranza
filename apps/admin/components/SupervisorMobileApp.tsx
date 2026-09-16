"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pill } from "@/components/ui";
import { QuickLoanForm } from "@/components/QuickLoanForm";
import { CollectorClosedDayReview } from "@/components/CollectorClosedDayReview";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { buildLoanReport } from "@/lib/loan-report";
import { shareLoanFichaCapture } from "@/lib/loan-ficha-share";
import { routeCoverageSummaries } from "@/lib/collector-preview";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { dedupePlanillaAssignments } from "@/lib/planilla-dedupe";
import { clientsOnRouteSorted, nextRouteOrder } from "@/lib/client-route-order";
import { isOperationalClient } from "@/lib/client-review";
import {
  clientsEligibleForNewLoan,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";
import {
  buildCollectorDayHistory,
  expensesForCollectorDay,
  openingSaldoForPeriod,
  periodFromDateIso,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import {
  collectorRecaudoBreakdown,
  visitStatusKind,
  visitStatusLabel,
  visitStatusLabelShort,
} from "@/lib/collector-mobile";
import { todayIso } from "@/lib/daily-dispatch";
import {
  enrichSupervisorPlanillaRow,
} from "@/lib/planilla-display";
import { computeLoanCuotasProgress } from "@/lib/loan-cuotas-progress";
import { CuotasProgressCell } from "@/components/CuotasProgressCell";
import { isoToDisplay, displayToIso, syncLoan } from "@/lib/loan-preview";
import { primaryLoanForClient } from "@/lib/route-sync";
import { nequiAcumuladoNet, loanDisbursementSource, loanDisbursementSourceLabel } from "@/lib/nequi-pool";
import { suppressGhostClick, isNavQuiet } from "@/lib/suppress-ghost-click";
import { createNavIntent, navButtonProps } from "@/lib/nav-intent";
import {
  normalizePaymentMethod,
  paymentMethodLabel,
  paymentMethodToneClass,
  type PaymentMethod,
} from "@/lib/payment-method";
import {
  money,
  catalogRoutes,
  paymentsForCollector,
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type StatusKind,
  type UserRow,
} from "@/lib/mock-data";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import {
  ensureCollectorDayBaseline,
  markCollectorDaySeen,
  playSupervisorPaymentChime,
  unreadPaymentCountForCollector,
} from "@/lib/supervisor-route-alerts";
import {
  indexPaymentEvidenceFromPayments,
  withPaymentEvidence,
} from "@/lib/payment-evidence-store";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";

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
  onCreateStreetClient?: (draft: {
    name: string;
    lastName?: string;
    phone?: string;
    routeOrder: number;
    routeName: string;
    routeRef: string;
  }) => void;
  onCreateQuickLoan?: (draft: QuickLoanDraft) => void;
  /** Adjuntar constancia a un PG- que quedó sin foto en la nube. */
  onAttachPaymentEvidence?: (paymentRef: string, evidence: PaymentEvidenceRef[]) => void;
  onLogout?: () => void;
};

type SupervisorView =
  | "inicio"
  | "planilla"
  | "caja"
  | "nequi"
  | "banco"
  | "nuevo"
  | "clientes"
  | "prestamos";
type NuevoMode = "menu" | "cliente" | "prestamo";
type RouteDetailMode =
  | "totales"
  | "planilla"
  | "prestamos"
  | "gastos"
  | "cobros"
  | "nequi-historial"
  | "nequi-dia";

const SUPERVISOR_NAV_KEY = "nexo-supervisor-mobile-nav";
const SUPERVISOR_VIEWS: SupervisorView[] = [
  "inicio",
  "planilla",
  "caja",
  "nequi",
  "banco",
  "nuevo",
  "clientes",
  "prestamos",
];

function readSupervisorNav(): { view: SupervisorView; openRouteRef: string | null } {
  if (typeof window === "undefined") return { view: "inicio", openRouteRef: null };
  try {
    const raw = sessionStorage.getItem(SUPERVISOR_NAV_KEY);
    if (!raw) return { view: "inicio", openRouteRef: null };
    const parsed = JSON.parse(raw) as { view?: string; openRouteRef?: string | null };
    const view = SUPERVISOR_VIEWS.includes(parsed.view as SupervisorView)
      ? (parsed.view as SupervisorView)
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
  gastosHoy: number;
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
  unreadCount = 0,
}: {
  row: RouteLiquidacion;
  accent: number;
  onOpen: (routeRef: string) => void;
  /** En vista caja siempre destaca el dinero en mano. */
  mode?: "ruta" | "caja" | "nequi" | "banco";
  /** Cobros nuevos del día aún no revisados por el supervisor. */
  unreadCount?: number;
}) {
  const total = row.planilla || 0;
  const pct = total > 0 ? Math.round((row.done / total) * 100) : 0;
  const showClosedSummary = mode === "ruta" && row.closed;
  const showLiveProgress = mode === "ruta" && !row.closed;
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const moneyMode = mode === "caja" || mode === "nequi" || mode === "banco";
  const heroAmount =
    mode === "nequi"
      ? row.cobradoNequi
      : mode === "banco"
        ? row.cobradoBanco
        : row.enCaja;

  return (
    <button
      type="button"
      className={`supervisor-route-board accent-${accent % 2}${row.closed ? " is-closed" : ""}${mode === "caja" ? " is-caja-mode" : ""}${mode === "nequi" ? " is-nequi-mode" : ""}${mode === "banco" ? " is-banco-mode" : ""}${unreadCount > 0 ? " has-unread" : ""}`}
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
            className={`supervisor-caja-hero is-row${mode === "nequi" ? " is-nequi" : ""}${mode === "banco" ? " is-banco" : ""}`}
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

          {(showClosedSummary || showLiveProgress) ? (
            <div className="supervisor-route-board-progress" aria-hidden>
              <div className="supervisor-route-board-bar">
                <span style={{ width: `${pct}%` }} />
              </div>
              <em>
                {row.done}/{total || 0} · {pct}%
              </em>
            </div>
          ) : null}

          <div className="supervisor-route-board-metrics">
            <div>
              <span>Inicial</span>
              <b>{money(row.saldoInicial, { symbol: false })}</b>
            </div>
            <div>
              <span>Cobrado</span>
              <b>{money(row.cobradoHoy, { symbol: false })}</b>
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
}

function PlanillaTable({
  rows,
}: {
  rows: Array<{
    key: string;
    index: number;
    clientName: string;
    saldo: number;
    method?: PaymentMethod | null;
    cuotas?: ReturnType<typeof computeLoanCuotasProgress>;
    visitStatus?: DailyCollectionAssignment["visitStatus"];
  }>;
}) {
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
          {rows.map((row) => {
            const method = row.method ?? null;
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
            return (
              <tr key={row.key}>
                <td className="is-ruta">{row.index}</td>
                <td className="is-nombre" title={row.clientName}>
                  {row.clientName}
                </td>
                <td className="is-num">{money(row.saldo, { symbol: false })}</td>
                <td className="is-metodo">
                  {method ? (
                    <em className={`supervisor-planilla-method ${paymentMethodToneClass(method)}`}>
                      {paymentMethodLabel(method)}
                    </em>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="is-cuotas">
                  <CuotasProgressCell progress={cuotas} />
                </td>
                <td className="is-estado">
                  <span title={visitStatusLabel(row.visitStatus)}>
                    <Pill
                      label={visitStatusLabelShort(row.visitStatus)}
                      kind={visitStatusKind(row.visitStatus)}
                    />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Lista de clientes para app supervisor: # (ruta), nombre, teléfono, saldo vivo. */
function ClientesTable({
  rows,
  onOpen,
}: {
  rows: Array<{
    ref: string;
    routeOrder: number;
    name: string;
    phone: string;
    cuotas: ReturnType<typeof computeLoanCuotasProgress>;
    saldo: number | null;
    hasLoan: boolean;
  }>;
  onOpen?: (clientRef: string) => void;
}) {
  return (
    <div className="supervisor-liq-wrap">
      <table className="supervisor-liq-table supervisor-clientes-table">
        <thead>
          <tr>
            <th className="is-ruta">#</th>
            <th className="is-nombre">Nombre</th>
            <th className="is-tel">Teléfono</th>
            <th className="is-cuotas">Mora</th>
            <th className="is-num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            return (
              <tr
                key={row.ref}
                className={onOpen ? "is-clickable" : undefined}
                onClick={onOpen ? () => onOpen(row.ref) : undefined}
              >
                <td className="is-ruta">{row.routeOrder > 0 ? row.routeOrder : "—"}</td>
                <td className="is-nombre" title={row.name}>
                  {row.name}
                </td>
                <td className="is-tel" title={row.phone}>
                  {row.phone}
                </td>
                <td className="is-cuotas">
                  {row.hasLoan ? <CuotasProgressCell progress={row.cuotas} /> : "—"}
                </td>
                <td className="is-num">
                  {row.hasLoan && row.saldo != null
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
  if (synced.status === "Finalizado" || synced.balance <= 0) return null;
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
            {report.movements.map((row) => {
              const method = normalizePaymentMethod(row.method);
              return (
                <li key={row.ref}>
                  <span className="is-amount">{money(row.amount, { symbol: false })}</span>
                  <span className="is-date">{row.paidDate || "—"}</span>
                  <span className="is-time">{row.paidTime || "—"}</span>
                  <span className={`is-method ${paymentMethodToneClass(method)}`}>
                    {paymentMethodLabel(method)}
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
  return Boolean(loan.notes?.toLowerCase().includes("renovación"));
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

/** App móvil del supervisor: caja + planilla + préstamos/renovaciones en vivo. */
export function SupervisorMobileApp({
  supervisor,
  collectors,
  routes,
  clients,
  loans,
  payments,
  assignments,
  dayExpenseDrafts = [],
  dayCloses = [],
  monthCloses = [],
  onCreateStreetClient,
  onCreateQuickLoan,
  onAttachPaymentEvidence,
  onLogout,
}: Props) {
  const today = todayIso();
  const todayDisplay = isoToDisplay(today);
  const navIntent = useMemo(() => createNavIntent(), []);
  const [view, setView] = useState<SupervisorView>(() => readSupervisorNav().view);
  const [openRouteRef, setOpenRouteRef] = useState<string | null>(
    () => readSupervisorNav().openRouteRef,
  );
  /** Panel al que vuelve al salir del detalle de ruta (inicio / caja / nequi). */
  const [routeReturnView, setRouteReturnView] = useState<SupervisorView>("inicio");
  const [detailMode, setDetailMode] = useState<RouteDetailMode>("totales");
  const [cobrosMethodFilter, setCobrosMethodFilter] = useState<PaymentMethod | null>(null);
  /** Día ISO seleccionado en historial Nequi de una ruta. */
  const [nequiDayIso, setNequiDayIso] = useState<string | null>(null);
  const [nequiDayBackTo, setNequiDayBackTo] = useState<"totales" | "nequi-historial">(
    "nequi-historial",
  );
  const [nuevoMode, setNuevoMode] = useState<NuevoMode>("menu");
  const [nuevoRouteRef, setNuevoRouteRef] = useState<string | null>(null);
  const [nuevoName, setNuevoName] = useState("");
  const [nuevoPhone, setNuevoPhone] = useState("");
  const [nuevoPos, setNuevoPos] = useState("");
  const [nuevoMsg, setNuevoMsg] = useState("");
  const [nuevoClientSearch, setNuevoClientSearch] = useState("");
  const [nuevoLoanClientRef, setNuevoLoanClientRef] = useState<string | null>(null);
  /** null = todas las rutas; string = nombre de ruta filtrada en planilla. */
  const [planillaRouteFilter, setPlanillaRouteFilter] = useState<string | null>(null);
  const [clientesRouteFilter, setClientesRouteFilter] = useState<string | null>(null);
  const [clientesLoanClientRef, setClientesLoanClientRef] = useState<string | null>(null);
  /** Ficha de un préstamo concreto desde historial «Ver préstamos». */
  const [prestamoFichaRef, setPrestamoFichaRef] = useState<string | null>(null);
  const [prestamosSearch, setPrestamosSearch] = useState("");

  useEffect(() => {
    writeSupervisorNav(view, openRouteRef);
  }, [view, openRouteRef]);

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
      dedupePlanillaAssignments(
        assignments.filter((row) => row.dispatched && row.dispatchDate === today),
      ),
    [assignments, today],
  );

  const assignedCoverage = useMemo(
    () =>
      coverage.filter(
        (row) => row.active && Boolean(row.collector?.ref || row.collectorRef),
      ),
    [coverage],
  );

  const liquidaciones = useMemo((): RouteLiquidacion[] => {
    return assignedCoverage.map((route) => {
      const collector = route.collector;
      const collectorRef = collector?.ref || route.collectorRef || "";
      const mine = todayAssignments.filter((row) => row.collectorRef === collectorRef);
      const pending = mine.filter((row) => !row.visitStatus || row.visitStatus === "pendiente").length;
      const done = mine.filter((row) => row.visitStatus === "cobrado").length;

      const clientRefs = new Set(
        clients.filter((row) => row.route === route.routeName).map((row) => row.ref),
      );
      // También clientes que aparecen hoy en planilla de este cobrador.
      for (const row of mine) clientRefs.add(row.clientRef);

      const loansToday = loans.filter(
        (loan) => clientRefs.has(loan.clientRef) && loan.date === todayDisplay,
      );
      const renewals = loansToday.filter(isRenewalLoan);
      const newLoans = loansToday.filter((loan) => !isRenewalLoan(loan));

      const caja = collector
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

      const closeRecord = dayCloses.find(
        (row) => row.collectorRef === collectorRef && row.date === today,
      );
      const planillaClosed = mine.length > 0 && mine.every((row) => Boolean(row.dayClosedAt));
      const closed = Boolean(closeRecord) || planillaClosed;

      const cobradoHoy = caja.cobradoHoy;
      const gastosHoy = closeRecord ? closeRecord.expensesTotal : caja.gastosHoy;
      /** Dinero en mano del cobrador (arrastre + efectivo − gastos; sin Nequi). */
      const enCaja = caja.enCaja;

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
      }
      if (!closed && loansToday.length > 0 && statusKind !== "ok") {
        statusLabel = loansToday.length === 1 ? "1 préstamo hoy" : `${loansToday.length} préstamos hoy`;
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
        saldoInicial: caja.saldoInicial,
        cobradoHoy,
        cobradoEfectivo: caja.cobradoEfectivo,
        cobradoNequi: caja.cobradoNequi,
        cobradoBanco: caja.cobradoBanco,
        gastosHoy,
        enCaja,
        closed,
        newLoans,
        renewals,
        statusLabel,
        statusKind,
      };
    });
  }, [
    assignedCoverage,
    todayAssignments,
    today,
    todayDisplay,
    payments,
    dayCloses,
    dayExpenseDrafts,
    monthCloses,
    clients,
    loans,
  ]);

  const [unreadByCollector, setUnreadByCollector] = useState<Record<string, number>>({});
  const unreadTotalRef = useRef(0);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const row of liquidaciones) {
      ensureCollectorDayBaseline(row.collectorRef, today);
      next[row.collectorRef] = unreadPaymentCountForCollector(
        row.collectorRef,
        today,
        collectors,
        paymentsWithEvidence,
      );
    }
    const total = Object.values(next).reduce((sum, n) => sum + n, 0);
    if (total > unreadTotalRef.current) {
      playSupervisorPaymentChime();
    }
    unreadTotalRef.current = total;
    setUnreadByCollector(next);
  }, [liquidaciones, collectors, paymentsWithEvidence, today]);

  const totals = useMemo(() => {
    const prestamosHoy = liquidaciones.reduce(
      (sum, row) => sum + row.newLoans.length + row.renewals.length,
      0,
    );
    return {
      routes: liquidaciones.length,
      planilla: todayAssignments.length,
      cobradoHoy: liquidaciones.reduce((sum, row) => sum + row.cobradoHoy, 0),
      cobradoNequi: liquidaciones.reduce((sum, row) => sum + row.cobradoNequi, 0),
      cobradoBanco: liquidaciones.reduce((sum, row) => sum + row.cobradoBanco, 0),
      gastosHoy: liquidaciones.reduce((sum, row) => sum + row.gastosHoy, 0),
      enCaja: liquidaciones.reduce((sum, row) => sum + row.enCaja, 0),
      saldoInicial: liquidaciones.reduce((sum, row) => sum + row.saldoInicial, 0),
      prestamosHoy,
    };
  }, [liquidaciones, todayAssignments.length]);

  /** Registro Nequi solo del día (se limpia solo al cambiar de fecha). */
  const nequiRegisterToday = useMemo(() => {
    const items = paymentsWithEvidence
      .filter(
        (row) =>
          normalizePaymentMethod(row.method) === "nequi" &&
          (row.amount ?? 0) > 0 &&
          normalizeHistoryDate(row.paidDate ?? "") === today,
      )
      .slice()
      .sort((a, b) => (b.paidTime || "").localeCompare(a.paidTime || ""));
    const total = items.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { date: todayDisplay, items, total };
  }, [paymentsWithEvidence, today, todayDisplay]);

  /** Total Nequi acumulado = cobros Nequi − capitales desembolsados (préstamo/renovación). */
  const nequiAcumulado = useMemo(() => {
    const refs = liquidaciones
      .map((row) => row.collectorRef)
      .filter((ref): ref is string => Boolean(ref));
    return nequiAcumuladoNet({
      payments: paymentsWithEvidence,
      loans,
      collectors,
      collectorRefs: refs,
    });
  }, [liquidaciones, collectors, paymentsWithEvidence, loans]);

  /** Suma Nequi solo de hoy (los cobradores de la lista). */
  const nequiHoyTotal = totals.cobradoNequi;
  const bancoHoyTotal = totals.cobradoBanco;

  /** Acumulado Banco = todos los PG- con método banco (sin restar desembolsos). */
  const bancoAcumulado = useMemo(() => {
    const refs = new Set(
      liquidaciones.map((row) => row.collectorRef).filter((ref): ref is string => Boolean(ref)),
    );
    return paymentsWithEvidence.reduce((sum, row) => {
      if (normalizePaymentMethod(row.method) !== "banco") return sum;
      if (!(Number(row.amount) > 0)) return sum;
      if (row.collectorRef && refs.size > 0 && !refs.has(row.collectorRef)) return sum;
      return sum + (row.amount ?? 0);
    }, 0);
  }, [liquidaciones, paymentsWithEvidence]);

  const bancoRegisterToday = useMemo(() => {
    const items = paymentsWithEvidence
      .filter(
        (row) =>
          normalizePaymentMethod(row.method) === "banco" &&
          (row.amount ?? 0) > 0 &&
          normalizeHistoryDate(row.paidDate ?? "") === today,
      )
      .slice()
      .sort((a, b) => (b.paidTime || "").localeCompare(a.paidTime || ""));
    const total = items.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    return { date: todayDisplay, items, total };
  }, [paymentsWithEvidence, today, todayDisplay]);

  const openRoute = liquidaciones.find((row) => row.routeRef === openRouteRef) ?? null;
  const openAssignments = useMemo(
    () =>
      openRoute
        ? todayAssignments.filter((row) => row.collectorRef === openRoute.collectorRef)
        : [],
    [todayAssignments, openRoute],
  );
  const openRouteExpenses = useMemo(
    () =>
      openRoute
        ? expensesForCollectorDay(
            openRoute.collectorRef,
            today,
            dayCloses,
            dayExpenseDrafts,
          )
        : [],
    [openRoute, today, dayCloses, dayExpenseDrafts],
  );
  const openRouteNequiDays = useMemo(() => {
    if (!openRoute) return [];
    const mine = paymentsForCollector(
      openRoute.collectorRef,
      collectors,
      paymentsWithEvidence,
    ).filter(
      (row) => normalizePaymentMethod(row.method) === "nequi" && (row.amount ?? 0) > 0,
    );
    const byDate = new Map<string, { count: number; amount: number }>();
    for (const row of mine) {
      const date = normalizeHistoryDate(row.paidDate ?? "");
      if (!date) continue;
      const prev = byDate.get(date) ?? { count: 0, amount: 0 };
      byDate.set(date, {
        count: prev.count + 1,
        amount: prev.amount + (row.amount ?? 0),
      });
    }
    return Array.from(byDate.entries())
      .map(([date, stats]) => ({
        date,
        dateLabel: isoToDisplay(date),
        count: stats.count,
        amount: stats.amount,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [openRoute, collectors, paymentsWithEvidence]);
  const openRouteNequiDayPays = useMemo(() => {
    if (!openRoute || !nequiDayIso) return [];
    const byRef = new Map(
      paymentsWithEvidence.filter((row) => row.ref).map((row) => [row.ref, row] as const),
    );
    return paymentsForCollector(openRoute.collectorRef, collectors, paymentsWithEvidence)
      .filter(
        (row) =>
          normalizePaymentMethod(row.method) === "nequi" &&
          (row.amount ?? 0) > 0 &&
          normalizeHistoryDate(row.paidDate ?? "") === nequiDayIso,
      )
      .map((row) => withPaymentEvidence(byRef.get(row.ref) ?? row))
      .slice()
      .sort((a, b) => (b.paidTime || "").localeCompare(a.paidTime || ""));
  }, [openRoute, nequiDayIso, collectors, paymentsWithEvidence]);
  const openRouteNequiDayTotal = openRouteNequiDayPays.reduce(
    (sum, row) => sum + (row.amount ?? 0),
    0,
  );

  function openCobrosReport(method: PaymentMethod | null = null) {
    suppressGhostClick();
    setCobrosMethodFilter(method);
    setDetailMode("cobros");
  }

  /** Misma ficha Nequi del día que el flujo NEQUI → ruta → día. */
  function openNequiDayFicha(
    dayIso: string,
    backTo: "totales" | "nequi-historial" = "nequi-historial",
  ) {
    const day = normalizeHistoryDate(dayIso) || dayIso;
    suppressGhostClick();
    setCobrosMethodFilter("nequi");
    setNequiDayIso(day);
    setNequiDayBackTo(backTo);
    setDetailMode("nequi-dia");
  }

  function goToView(next: SupervisorView) {
    if (isNavQuiet()) return;
    // Misma pestaña sin detalle de ruta: no resetear (evita click fantasma).
    if (next === view && !openRouteRef) return;
    suppressGhostClick(900);
    setOpenRouteRef(null);
    setRouteReturnView("inicio");
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoMode("menu");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setNuevoName("");
    setNuevoPhone("");
    if (next !== "planilla") setPlanillaRouteFilter(null);
    if (next !== "clientes") {
      setClientesRouteFilter(null);
      setClientesLoanClientRef(null);
    }
    if (next !== "prestamos") {
      setPrestamoFichaRef(null);
      setPrestamosSearch("");
    }
    setView(next);
  }

  /** INICIO solo por gesto intencional: cierra todo y queda en home. */
  function goHome() {
    if (isNavQuiet()) return;
    if (view === "inicio" && !openRouteRef && !prestamoFichaRef && !clientesLoanClientRef) {
      return;
    }
    suppressGhostClick(900);
    setOpenRouteRef(null);
    setRouteReturnView("inicio");
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoMode("menu");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setNuevoName("");
    setNuevoPhone("");
    setPlanillaRouteFilter(null);
    setClientesRouteFilter(null);
    setClientesLoanClientRef(null);
    setPrestamoFichaRef(null);
    setPrestamosSearch("");
    setView("inicio");
  }

  function resetNuevoFlow() {
    setNuevoRouteRef(null);
    setNuevoMsg("");
    setNuevoClientSearch("");
    setNuevoLoanClientRef(null);
    setNuevoName("");
    setNuevoPhone("");
  }

  /** Pins 1, 2, 3, 4…: toda ruta activa con cobrador asignado (aparece al asignar). */
  const planillaRoutePins = useMemo(
    () =>
      catalogRoutes(routes)
        .filter((row) => routeIsActive(row) && Boolean(row.collectorRef))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        .map((row) => row.name)
        .filter(Boolean),
    [routes],
  );

  const planillaAssignments = useMemo(() => {
    if (!planillaRouteFilter) return todayAssignments;
    const fromLiq = liquidaciones.find((row) => row.routeName === planillaRouteFilter);
    const fromCatalog = catalogRoutes(routes).find((row) => row.name === planillaRouteFilter);
    const collectorRef = fromLiq?.collectorRef || fromCatalog?.collectorRef || "";
    return todayAssignments.filter(
      (row) =>
        row.clientRoute === planillaRouteFilter ||
        (collectorRef ? row.collectorRef === collectorRef : false),
    );
  }, [todayAssignments, planillaRouteFilter, liquidaciones, routes]);

  const supervisorClientRows = useMemo(() => {
    // Lista = todos los clientes operativos del sistema (filtro de ruta opcional).
    const base = clientesRouteFilter
      ? clientsOnRouteSorted(clients, clientesRouteFilter).filter(isOperationalClient)
      : clients
          .filter(isOperationalClient)
          .slice()
          .sort((a, b) => {
            const routeCmp = String(a.route || "").localeCompare(String(b.route || ""), undefined, {
              numeric: true,
            });
            if (routeCmp) return routeCmp;
            return (a.routeOrder || 0) - (b.routeOrder || 0);
          });

    return base.map((row) => {
      const loan = currentActiveLoan(row.ref, loans, payments);
      const cuotas = computeLoanCuotasProgress(loan, payments, today);
      return {
        ref: row.ref,
        routeOrder: row.routeOrder || 0,
        name: `${row.name} ${row.lastName}`.trim(),
        phone: row.phone?.trim() || "—",
        cuotas,
        saldo: loan ? loan.balance : null,
        hasLoan: Boolean(loan),
      };
    });
  }, [clients, clientesRouteFilter, loans, payments, today]);

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

  const prestamosHistorial = useMemo(() => {
    const sorted = [...loans].sort((a, b) => {
      const da = displayToIso(a.date) || a.date || "";
      const db = displayToIso(b.date) || b.date || "";
      return db.localeCompare(da) || b.ref.localeCompare(a.ref);
    });
    const q = prestamosSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((loan) => {
      const hay = `${loan.client} ${loan.ref} ${loan.date} ${loan.clientRef || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [loans, prestamosSearch]);

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

  const nuevoLoanClient =
    eligibleLoanClients.find((row) => row.ref === nuevoLoanClientRef) ??
    clients.find((row) => row.ref === nuevoLoanClientRef) ??
    null;

  function submitStreetClient() {
    const route = liquidaciones.find((row) => row.routeRef === nuevoRouteRef);
    if (!route || !onCreateStreetClient) return;
    const name = nuevoName.trim();
    if (!name) {
      setNuevoMsg("Escriba el nombre del cliente.");
      return;
    }
    const nextPos = nextRouteOrder(clients, route.routeName);
    const pos = Math.min(
      Math.max(1, Math.trunc(Number(String(nuevoPos).replace(/\D/g, ""))) || nextPos),
      nextPos,
    );
    onCreateStreetClient({
      name,
      phone: nuevoPhone.trim() || undefined,
      routeOrder: pos,
      routeName: route.routeName,
      routeRef: route.routeRef,
    });
    setNuevoName("");
    setNuevoPhone("");
    setNuevoPos("");
    setNuevoMsg(
      `Listo: ${name} en posición ${pos} de la ruta de ${route.collectorName}.`,
    );
    setNuevoRouteRef(null);
    setNuevoMode("menu");
  }

  function closeRouteDetail() {
    const backTo = routeReturnView;
    suppressGhostClick();
    setOpenRouteRef(null);
    setDetailMode("totales");
    setCobrosMethodFilter(null);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    setRouteReturnView("inicio");
    setView(backTo);
  }

  function openRouteSummary(
    ref: string,
    opts?: { method?: PaymentMethod | null; returnView?: SupervisorView },
  ) {
    const route = liquidaciones.find((row) => row.routeRef === ref);
    if (route?.collectorRef) {
      markCollectorDaySeen(
        route.collectorRef,
        today,
        collectors,
        paymentsWithEvidence,
      );
      setUnreadByCollector((current) => ({
        ...current,
        [route.collectorRef]: 0,
      }));
      unreadTotalRef.current = Math.max(
        0,
        unreadTotalRef.current - (unreadByCollector[route.collectorRef] || 0),
      );
    }
    const backTo = opts?.returnView ?? "inicio";
    suppressGhostClick();
    setOpenRouteRef(ref);
    setRouteReturnView(backTo);
    setNequiDayIso(null);
    setNequiDayBackTo("nequi-historial");
    if (opts?.method === "nequi" && opts.returnView === "nequi") {
      setCobrosMethodFilter("nequi");
      setDetailMode("nequi-historial");
    } else if (opts && "method" in opts) {
      setCobrosMethodFilter(opts.method ?? null);
      setDetailMode("cobros");
    } else {
      setCobrosMethodFilter(null);
      setDetailMode("totales");
    }
    // Mantener el panel de origen (caja/nequi/banco). Antes forzaba "inicio"
    // y cualquier cierre accidental dejaba al usuario en el home.
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
        <div
          className="supervisor-kpi-nb-sum"
          aria-label={`Nequi + Banco: ${money(nequiHoyTotal + bancoHoyTotal, { symbol: false })}`}
        >
          <b>{money(nequiHoyTotal + bancoHoyTotal, { symbol: false })}</b>
        </div>
        <span className="supervisor-mobile-date">{dateLabel}</span>
      </header>

      <div
        className="supervisor-mobile-kpis is-home has-nuevo has-clientes has-nequi has-banco"
        role="group"
        aria-label="Menú supervisor"
      >
        <button
          type="button"
          className={
            view === "inicio" && !openRoute
              ? "supervisor-mobile-kpi is-inicio on"
              : "supervisor-mobile-kpi is-inicio"
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
          {...navButtonProps(navIntent, () => {
            if (view === "planilla" && !openRouteRef) return;
            setPlanillaRouteFilter(null);
            goToView("planilla");
          })}
        >
          <b>RUTA</b>
        </button>
        <button
          type="button"
          className={
            view === "caja" ||
            (openRoute &&
              (detailMode === "totales" ||
                detailMode === "gastos" ||
                detailMode === "cobros") &&
              cobrosMethodFilter !== "nequi" &&
              cobrosMethodFilter !== "banco")
              ? "supervisor-mobile-kpi is-caja on"
              : "supervisor-mobile-kpi is-caja"
          }
          {...navButtonProps(navIntent, () => {
            if (openRoute) {
              setCobrosMethodFilter(null);
              setDetailMode("totales");
              return;
            }
            if (view === "caja") return;
            goToView("caja");
          })}
          title={openRoute ? `Caja · ${openRoute.collectorName}` : "Caja del día"}
        >
          <b>CAJA</b>
        </button>
        <button
          type="button"
          className={
            view === "nequi" || cobrosMethodFilter === "nequi"
              ? "supervisor-mobile-kpi is-nequi on"
              : "supervisor-mobile-kpi is-nequi"
          }
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
            view === "banco" || cobrosMethodFilter === "banco"
              ? "supervisor-mobile-kpi is-banco on"
              : "supervisor-mobile-kpi is-banco"
          }
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
            view === "nuevo" || view === "prestamos"
              ? "supervisor-mobile-kpi is-nuevo on"
              : "supervisor-mobile-kpi is-nuevo"
          }
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
          {...navButtonProps(navIntent, () => {
            if (view === "clientes" && !openRouteRef) return;
            setClientesRouteFilter(null);
            setClientesLoanClientRef(null);
            goToView("clientes");
          })}
        >
          <b>CLIENTES</b>
        </button>
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
              <p className="supervisor-mobile-detail-meta">Historial Nequi por día</p>
              {openRouteNequiDays.length === 0 ? (
                <p className="ficha-empty">Sin cobros Nequi en esta ruta.</p>
              ) : (
                <ul className="supervisor-nequi-day-list" aria-label="Días con Nequi">
                  {openRouteNequiDays.map((day) => (
                    <li key={day.date}>
                      <button
                        type="button"
                        className="supervisor-nequi-day-row"
                        onClick={() => openNequiDayFicha(day.date, "nequi-historial")}
                      >
                        <span className="is-date">{day.dateLabel}</span>
                        <span className="is-count">
                          {day.count} cobro{day.count === 1 ? "" : "s"}
                        </span>
                        <b className="is-amount">{money(day.amount, { symbol: false })}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : detailMode === "nequi-dia" ? (
            <>
              <p className="supervisor-mobile-detail-meta">
                <span>{nequiDayIso ? isoToDisplay(nequiDayIso) : ""}</span>
                <span className="supervisor-mobile-detail-sep" aria-hidden>
                  ·
                </span>
                <span>
                  {openRouteNequiDayPays.length} cobro
                  {openRouteNequiDayPays.length === 1 ? "" : "s"}
                </span>
              </p>
              {openRouteNequiDayPays.length === 0 ? (
                <p className="ficha-empty">Sin movimientos Nequi ese día.</p>
              ) : (
                <>
                  {openRouteNequiDayPays.some((pay) => !pay.evidence?.some((e) => e.previewUrl)) ? (
                    <p className="supervisor-nequi-evidence-hint">
                      Si ves un +, la foto está solo en el celular que cobró. Abrí ese celular
                      (misma app) o subila acá con +.
                    </p>
                  ) : null}
                <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-register is-nequi-day-ficha">
                  {openRouteNequiDayPays.map((pay) => (
                    <li key={pay.ref}>
                      <strong className="is-name">{pay.client}</strong>
                      <span className="is-when">{pay.paidTime || "—"}</span>
                      <span className="is-loan">{pay.loanRef || "—"}</span>
                      <em className={`is-method ${paymentMethodToneClass("nequi")}`}>
                        {paymentMethodLabel("nequi")}
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
                  ))}
                  <li className="is-total">
                    <span>Total Nequi</span>
                    <b>{money(openRouteNequiDayTotal, { symbol: false })}</b>
                  </li>
                </ul>
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
                  <div className="is-means-spacer" aria-hidden />
                  <button
                    type="button"
                    className="is-pay-efectivo is-tap-means"
                    onClick={() => openCobrosReport("efectivo")}
                    aria-label="Ver cobros en efectivo"
                  >
                    <span>Efectivo</span>
                    <b>{money(openRoute.cobradoEfectivo, { symbol: false })}</b>
                  </button>
                  <button
                    type="button"
                    className="is-pay-nequi is-tap-means"
                    onClick={() => openNequiDayFicha(today, "totales")}
                    aria-label="Ver cobros Nequi del día"
                  >
                    <span>Nequi</span>
                    <b>{money(openRoute.cobradoNequi, { symbol: false })}</b>
                  </button>
                  <button
                    type="button"
                    className="is-pay-banco is-tap-means"
                    onClick={() => openCobrosReport("banco")}
                    aria-label="Ver cobros banco del día"
                  >
                    <span>Banco</span>
                    <b>{money(openRoute.cobradoBanco, { symbol: false })}</b>
                  </button>
                  <button
                    type="button"
                    className="is-total-means is-tap-means"
                    onClick={() => openCobrosReport(null)}
                    aria-label="Ver todos los cobros"
                  >
                    <span>Total</span>
                    <b>{money(openRoute.cobradoHoy, { symbol: false })}</b>
                  </button>
                </div>
                <button
                  type="button"
                  className="supervisor-mobile-sheet-row is-tap is-gastos is-primary-row"
                  onClick={() => setDetailMode("gastos")}
                  aria-label="Ver reporte de gastos del día"
                >
                  <span className="is-primary-title">Gasto</span>
                  <b>{money(openRoute.gastosHoy, { symbol: false })}</b>
                </button>
                <div className="supervisor-mobile-cuadre" aria-label="Cuadre de caja">
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
                <div className="supervisor-mobile-sheet-row is-muted">
                  <span>Préstamos / renovaciones hoy</span>
                  <b>{openRoute.newLoans.length + openRoute.renewals.length}</b>
                </div>
              </div>

              <div className="supervisor-mobile-actions">
                <button
                  type="button"
                  className="btn compact"
                  disabled={openAssignments.length === 0}
                  onClick={() => setDetailMode("planilla")}
                >
                  Planilla
                </button>
                <button
                  type="button"
                  className="btn compact"
                  onClick={() => setDetailMode("gastos")}
                >
                  Gastos
                </button>
                <button
                  type="button"
                  className="btn compact"
                  disabled={openRoute.cobradoHoy <= 0}
                  onClick={() => openCobrosReport(null)}
                >
                  Cobros
                </button>
                <button
                  type="button"
                  className="btn compact"
                  disabled={openRoute.newLoans.length + openRoute.renewals.length === 0}
                  onClick={() => setDetailMode("prestamos")}
                >
                  Préstamos
                </button>
              </div>
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
              {openAssignments.length === 0 ? (
                <p className="ficha-empty">Sin planilla enviada hoy.</p>
              ) : (
                <PlanillaTable
                  rows={openAssignments.map((row, index) =>
                    enrichSupervisorPlanillaRow(row, index + 1, loans, payments, today),
                  )}
                />
              )}
            </>
          ) : (
            <>
              <p className="supervisor-mobile-detail-meta">
                Préstamos generados hoy (incluye renovación al liquidar).
              </p>
              {openRoute.newLoans.length + openRoute.renewals.length === 0 ? (
                <p className="ficha-empty">Sin préstamos nuevos ni renovaciones hoy.</p>
              ) : (
                <ul className="supervisor-mobile-list">
                  {[...openRoute.renewals, ...openRoute.newLoans].map((loan) => (
                    <li key={loan.ref}>
                      <div>
                        <strong>{loan.client}</strong>
                        <span>
                          {loan.ref} · {isRenewalLoan(loan) ? "Renovación" : "Nuevo"} ·{" "}
                          {money(loan.balance || loan.total || 0, { symbol: false })}
                        </span>
                      </div>
                      <Pill
                        label={isRenewalLoan(loan) ? "Renovación" : "Nuevo"}
                        kind={isRenewalLoan(loan) ? "partial" : "ok"}
                      />
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
                      planillaRouteFilter === name
                        ? "supervisor-planilla-route-btn on"
                        : "supervisor-planilla-route-btn"
                    }
                    onClick={() =>
                      setPlanillaRouteFilter((prev) => (prev === name ? null : name))
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
            <PlanillaTable
              rows={planillaAssignments.map((row, index) =>
                enrichSupervisorPlanillaRow(row, index + 1, loans, payments, today),
              )}
            />
          )}
        </section>
      ) : view === "caja" ? (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          <div className="supervisor-day-boards" aria-label="Total en caja">
            <div className="supervisor-day-board is-caja supervisor-day-board-wide is-total-row">
              <div className="supervisor-day-board-copy">
                <span>Total en caja</span>
                <em>
                  {liquidaciones.length} cobrador
                  {liquidaciones.length === 1 ? "" : "es"}
                </em>
              </div>
              <b>{money(totals.enCaja, { symbol: false })}</b>
            </div>
          </div>

          <h3>Por cobrador</h3>
          {liquidaciones.length === 0 ? (
            <p className="ficha-empty">No hay rutas con cobrador.</p>
          ) : (
            <div className="supervisor-route-boards">
              {liquidaciones.map((row, index) => (
                <RouteBoardCard
                  key={row.routeRef}
                  row={row}
                  accent={index}
                  mode="caja"
                  unreadCount={unreadByCollector[row.collectorRef] || 0}
                  onOpen={(ref) => openRouteSummary(ref, { returnView: "caja" })}
                />
              ))}
            </div>
          )}
        </section>
      ) : view === "nequi" ? (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          <div className="supervisor-day-boards" aria-label="Total Nequi acumulado">
            <div className="supervisor-day-board is-nequi supervisor-day-board-wide is-total-row">
              <div className="supervisor-day-board-copy">
                <span>Total acumulado</span>
              </div>
              <b>{money(nequiAcumulado, { symbol: false })}</b>
            </div>
          </div>

          <h3>Por cobrador</h3>
          {liquidaciones.length === 0 ? (
            <p className="ficha-empty">No hay rutas con cobrador.</p>
          ) : (
            <div className="supervisor-route-boards">
              {liquidaciones.map((row, index) => (
                <RouteBoardCard
                  key={row.routeRef}
                  row={row}
                  accent={index}
                  mode="nequi"
                  unreadCount={unreadByCollector[row.collectorRef] || 0}
                  onOpen={(ref) =>
                    openRouteSummary(ref, { method: "nequi", returnView: "nequi" })
                  }
                />
              ))}
            </div>
          )}

          <div
            className="supervisor-day-boards supervisor-nequi-day-total"
            aria-label="Total Nequi del día"
          >
            <div className="supervisor-day-board is-nequi supervisor-day-board-wide is-nequi-hoy">
              <div className="supervisor-day-board-copy">
                <span>Total del día</span>
                <em>
                  {liquidaciones.length} cobrador
                  {liquidaciones.length === 1 ? "" : "es"} · hoy
                </em>
              </div>
              <div className="supervisor-caja-hero is-row is-nequi">
                <b>{money(nequiHoyTotal, { symbol: false })}</b>
              </div>
            </div>
          </div>

          <h3>Registro Nequi</h3>
          {nequiRegisterToday.items.length === 0 ? (
            <p className="ficha-empty">Sin cobros Nequi hoy.</p>
          ) : (
            <div className="supervisor-nequi-register is-today-only">
              <div className="supervisor-nequi-day">
                <div className="supervisor-nequi-day-head">
                  <strong>Hoy · {nequiRegisterToday.date}</strong>
                  <b>{money(nequiRegisterToday.total, { symbol: false })}</b>
                </div>
                <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-register">
                  {nequiRegisterToday.items.map((pay) => (
                    <li key={pay.ref}>
                      <div className="is-name-block">
                        <strong className="is-name">{pay.client}</strong>
                        {pay.paidTime ? (
                          <span className="is-when">{pay.paidTime}</span>
                        ) : null}
                      </div>
                      <span className="is-loan">{pay.loanRef || "—"}</span>
                      <em className={`is-method ${paymentMethodToneClass("nequi")}`}>
                        {paymentMethodLabel("nequi")}
                      </em>
                      <span className="is-evidence">
                        <PaymentEvidenceThumb
                          evidence={pay.evidence}
                          size={36}
                          onAttach={
                            onAttachPaymentEvidence
                              ? (piece) => onAttachPaymentEvidence(pay.ref, [piece])
                              : undefined
                          }
                        />
                      </span>
                      <b className="is-cobro">{money(pay.amount, { symbol: false })}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      ) : view === "banco" ? (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          <div className="supervisor-day-boards" aria-label="Total Banco acumulado">
            <div className="supervisor-day-board is-banco supervisor-day-board-wide is-total-row">
              <div className="supervisor-day-board-copy">
                <span>Total acumulado</span>
              </div>
              <b>{money(bancoAcumulado, { symbol: false })}</b>
            </div>
          </div>

          <h3>Por cobrador</h3>
          {liquidaciones.length === 0 ? (
            <p className="ficha-empty">No hay rutas con cobrador.</p>
          ) : (
            <div className="supervisor-route-boards">
              {liquidaciones.map((row, index) => (
                <RouteBoardCard
                  key={row.routeRef}
                  row={row}
                  accent={index}
                  mode="banco"
                  unreadCount={unreadByCollector[row.collectorRef] || 0}
                  onOpen={(ref) =>
                    openRouteSummary(ref, { method: "banco", returnView: "banco" })
                  }
                />
              ))}
            </div>
          )}

          <div
            className="supervisor-day-boards supervisor-nequi-day-total"
            aria-label="Total Banco del día"
          >
            <div className="supervisor-day-board is-banco supervisor-day-board-wide is-banco-hoy">
              <div className="supervisor-day-board-copy">
                <span>Total del día</span>
                <em>
                  {liquidaciones.length} cobrador
                  {liquidaciones.length === 1 ? "" : "es"} · hoy
                </em>
              </div>
              <div className="supervisor-caja-hero is-row is-banco">
                <b>{money(bancoHoyTotal, { symbol: false })}</b>
              </div>
            </div>
          </div>

          <h3>Registro Banco</h3>
          {bancoRegisterToday.items.length === 0 ? (
            <p className="ficha-empty">Sin cobros Banco hoy.</p>
          ) : (
            <div className="supervisor-nequi-register is-today-only">
              <div className="supervisor-nequi-day">
                <div className="supervisor-nequi-day-head">
                  <strong>Hoy · {bancoRegisterToday.date}</strong>
                  <b>{money(bancoRegisterToday.total, { symbol: false })}</b>
                </div>
                <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-register">
                  {bancoRegisterToday.items.map((pay) => (
                    <li key={pay.ref}>
                      <div className="is-name-block">
                        <strong className="is-name">{pay.client}</strong>
                        {pay.paidTime ? (
                          <span className="is-when">{pay.paidTime}</span>
                        ) : null}
                      </div>
                      <span className="is-loan">{pay.loanRef || "—"}</span>
                      <em className={`is-method ${paymentMethodToneClass("banco")}`}>
                        {paymentMethodLabel("banco")}
                      </em>
                      <span className="is-evidence">
                        <PaymentEvidenceThumb
                          evidence={pay.evidence}
                          size={36}
                          onAttach={
                            onAttachPaymentEvidence
                              ? (piece) => onAttachPaymentEvidence(pay.ref, [piece])
                              : undefined
                          }
                        />
                      </span>
                      <b className="is-cobro">{money(pay.amount, { symbol: false })}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
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
                  disabled={!onCreateStreetClient}
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
              </div>
              {!onCreateStreetClient && !onCreateQuickLoan ? (
                <p className="ficha-empty">No hay permiso para crear desde esta vista.</p>
              ) : null}
            </>
          ) : nuevoMode === "cliente" ? (
            <>
              <div className="supervisor-mobile-detail-head">
                <h3>Nuevo cliente</h3>
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
              {!onCreateStreetClient ? (
                <p className="ficha-empty">No hay permiso para crear clientes desde esta vista.</p>
              ) : !nuevoRouteRef ? (
                <>
                  <p className="supervisor-mobile-subhead">
                    Elija la ruta: el cliente llega a la lista del cobrador para prestarle.
                  </p>
                  {nuevoMsg ? <p className="supervisor-nuevo-msg">{nuevoMsg}</p> : null}
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
                            setNuevoPos(String(nextRouteOrder(clients, row.routeName)));
                            setNuevoMsg("");
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
              ) : (
                <>
                  <div className="supervisor-mobile-detail-head">
                    <h3>
                      Ruta {nuevoRoute?.routeName} · {nuevoRoute?.collectorName}
                    </h3>
                    <button
                      type="button"
                      className="collector-mobile-pay-link"
                      onClick={() => setNuevoRouteRef(null)}
                    >
                      cambiar
                    </button>
                  </div>
                  <form
                    className="supervisor-nuevo-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitStreetClient();
                    }}
                  >
                    <label className="quick-loan-field">
                      <span>Nombre</span>
                      <input
                        value={nuevoName}
                        onChange={(event) => setNuevoName(event.target.value)}
                        placeholder="Nombre del cliente"
                        autoFocus
                      />
                    </label>
                    <label className="quick-loan-field">
                      <span>Teléfono</span>
                      <input
                        inputMode="tel"
                        value={nuevoPhone}
                        onChange={(event) => setNuevoPhone(event.target.value)}
                        placeholder="Celular"
                      />
                    </label>
                    <label className="quick-loan-field">
                      <span>Posición en la lista</span>
                      <input
                        inputMode="numeric"
                        value={nuevoPos}
                        onChange={(event) => setNuevoPos(event.target.value)}
                        placeholder="Ej. 1"
                      />
                    </label>
                    {nuevoMsg ? <p className="supervisor-nuevo-msg is-warn">{nuevoMsg}</p> : null}
                    <div className="quick-loan-actions">
                      <button type="submit" className="btn">
                        Crear y enviar a ruta
                      </button>
                    </div>
                  </form>
                </>
              )}
            </>
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
                    fundedByOptions={["nequi", "banco"]}
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
                  <p className="supervisor-mobile-subhead">
                    Clientes sin préstamo activo. Busque o elija uno.
                  </p>
                  <label className="quick-loan-field supervisor-nuevo-search">
                    <span>Buscar</span>
                    <input
                      value={nuevoClientSearch}
                      onChange={(event) => setNuevoClientSearch(event.target.value)}
                      placeholder="Nombre, cédula o celular"
                      autoFocus
                    />
                  </label>
                  {eligibleLoanClients.length === 0 ? (
                    <p className="ficha-empty">
                      No hay clientes disponibles en esta ruta
                      {nuevoClientSearch.trim() ? " con ese filtro" : ""}.
                    </p>
                  ) : (
                    <ul className="supervisor-nuevo-client-list">
                      {eligibleLoanClients.map((row) => (
                        <li key={row.ref}>
                          <button
                            type="button"
                            className="supervisor-nuevo-client-btn"
                            onClick={() => {
                              suppressGhostClick();
                              setNuevoLoanClientRef(row.ref);
                            }}
                          >
                            <strong>{`${row.name} ${row.lastName}`.trim()}</strong>
                            <span>
                              {row.document || row.ref}
                              {row.phone ? ` · ${row.phone}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
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
                <h3>Préstamos</h3>
                <button
                  type="button"
                  className="collector-mobile-pay-link is-back"
                  onClick={() => goToView("nuevo")}
                >
                  volver
                </button>
              </div>
              <label className="quick-loan-field supervisor-nuevo-search supervisor-prestamos-search">
                <span className="sr-only">Buscar cliente</span>
                <input
                  value={prestamosSearch}
                  onChange={(event) => setPrestamosSearch(event.target.value)}
                  placeholder="Buscar cliente o fecha"
                  autoFocus
                />
              </label>
              {prestamosHistorial.length === 0 ? (
                <p className="ficha-empty">
                  {prestamosSearch.trim()
                    ? "No hay préstamos con ese filtro."
                    : "Sin préstamos registrados."}
                </p>
              ) : (
                <ul
                  className="supervisor-mobile-list is-prestamos-hist"
                  aria-label="Historial de préstamos"
                >
                  <li className="is-head" aria-hidden>
                    <span className="is-client">Cliente</span>
                    <span className="is-date">Fecha</span>
                    <span className="is-origin">Origen</span>
                    <span className="is-amount">Total</span>
                    <span className="is-saldo">Saldo</span>
                  </li>
                  {prestamosHistorial.map((loan) => {
                    const origin = loanDisbursementSource(loan);
                    const originClass =
                      origin === "nequi"
                        ? "is-nequi"
                        : origin === "efectivo"
                          ? "is-efectivo"
                          : origin === "banco"
                            ? "is-banco"
                            : "is-unknown";
                    const synced = syncLoan(loan, payments) as LoanRow;
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
                            {loanDisbursementSourceLabel(origin)}
                          </em>
                          <b className={`is-amount ${originClass}`} title="Total a cobrar (capital + interés)">
                            {money(totalCobrar, { symbol: false })}
                          </b>
                          <b className="is-saldo">
                            {money(Math.max(0, synced.balance ?? 0), { symbol: false })}
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
          {clientesPdfReport ? (
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
                <h3>Clientes</h3>
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
                          clientesRouteFilter === name
                            ? "supervisor-planilla-route-btn on"
                            : "supervisor-planilla-route-btn"
                        }
                        onClick={() =>
                          setClientesRouteFilter((prev) => (prev === name ? null : name))
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
              {supervisorClientRows.length === 0 ? (
                <p className="ficha-empty">
                  {clientesRouteFilter
                    ? `No hay clientes en la ruta ${clientesRouteFilter}.`
                    : "No hay clientes activos."}
                </p>
              ) : (
                <ClientesTable
                  rows={supervisorClientRows}
                  onOpen={(ref) => {
                    suppressGhostClick();
                    setClientesLoanClientRef(ref);
                  }}
                />
              )}
            </>
          )}
        </section>
      ) : (
        <section className="supervisor-mobile-section supervisor-mobile-home">
          {liquidaciones.length === 0 ? (
            <p className="ficha-empty">No hay rutas con cobrador.</p>
          ) : (
            <div className="supervisor-route-boards">
              {liquidaciones.map((row, index) => (
                <RouteBoardCard
                  key={row.routeRef}
                  row={row}
                  accent={index}
                  unreadCount={unreadByCollector[row.collectorRef] || 0}
                  onOpen={openRouteSummary}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {onLogout && view === "inicio" && !openRoute ? (
        <footer className="collector-mobile-foot mobile-app-logout-foot">
          <button type="button" className="btn aside-logout" onClick={onLogout}>
            Cerrar sesión
          </button>
        </footer>
      ) : null}
    </div>
  );
}
