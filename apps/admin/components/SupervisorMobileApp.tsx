"use client";

import { useMemo, useState } from "react";
import { Pill } from "@/components/ui";
import { QuickLoanForm } from "@/components/QuickLoanForm";
import { buildLoanReport } from "@/lib/loan-report";
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
  openingSaldoForPeriod,
  periodFromDateIso,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { todayIso } from "@/lib/daily-dispatch";
import {
  visitStatusKind,
  visitStatusLabel,
  visitStatusLabelShort,
} from "@/lib/collector-mobile";
import {
  enrichSupervisorPlanillaRow,
  planillaAlertBadgeText,
  planillaAlertTitle,
} from "@/lib/planilla-display";
import {
  COLLECTION_ALERTS_BEFORE_MORA,
  collectionAlertsFromPayments,
} from "@/lib/collection-alerts";
import { isoToDisplay, syncLoan } from "@/lib/loan-preview";
import { primaryLoanForClient } from "@/lib/route-sync";
import {
  money,
  catalogRoutes,
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type StatusKind,
  type UserRow,
} from "@/lib/mock-data";

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
  onLogout?: () => void;
};

type SupervisorView = "inicio" | "planilla" | "caja" | "nuevo" | "clientes";
type NuevoMode = "menu" | "cliente" | "prestamo";
type RouteDetailMode = "totales" | "planilla" | "prestamos";

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
}: {
  row: RouteLiquidacion;
  accent: number;
  onOpen: (routeRef: string) => void;
  /** En vista caja siempre destaca el dinero en mano. */
  mode?: "ruta" | "caja";
}) {
  const total = row.planilla || 0;
  const pct = total > 0 ? Math.round((row.done / total) * 100) : 0;
  const showClosedSummary = mode === "ruta" && row.closed;
  const showLiveProgress = mode === "ruta" && !row.closed;

  return (
    <button
      type="button"
      className={`supervisor-route-board accent-${accent % 2}${row.closed ? " is-closed" : ""}${mode === "caja" ? " is-caja-mode" : ""}`}
      onClick={() => onOpen(row.routeRef)}
    >
      {mode === "caja" ? (
        <div className="supervisor-caja-row">
          <div className="supervisor-route-board-id">
            <span className="supervisor-route-board-ruta">Ruta {row.routeName}</span>
            <strong>{row.collectorName}</strong>
          </div>
          <div className="supervisor-caja-hero is-row">
            <span>Saldo</span>
            <b>{money(row.enCaja, { symbol: false })}</b>
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
              <strong>{row.collectorName}</strong>
            </div>
            <div className="supervisor-caja-hero is-row is-money-lg">
              <span>Saldo</span>
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
    cuota: number;
    alertCount?: number;
    alertBadge?: string;
    alertTitle?: string;
    inMora?: boolean;
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
            <th className="is-num">Cuota</th>
            <th className="is-alert" aria-label="Alerta" />
            <th className="is-estado">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = row.alertBadge ?? "";
            const alertOn = Boolean(badge);
            return (
              <tr key={row.key}>
                <td className="is-ruta">{row.index}</td>
                <td className="is-nombre" title={row.clientName}>
                  {row.clientName}
                </td>
                <td className="is-num">{money(row.saldo, { symbol: false })}</td>
                <td className="is-num">
                  {row.cuota > 0 ? money(row.cuota, { symbol: false }) : "—"}
                </td>
                <td className="is-alert">
                  <span
                    className={
                      alertOn
                        ? row.inMora
                          ? "supervisor-mobile-alert-n is-mora"
                          : "supervisor-mobile-alert-n"
                        : "supervisor-mobile-alert-n is-empty"
                    }
                    title={row.alertTitle}
                    aria-hidden={!alertOn}
                  >
                    {badge}
                  </span>
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
    alertCount: number;
    alertBadge: string;
    alertTitle?: string;
    inMora: boolean;
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
            <th className="is-alert" aria-label="Alerta" />
            <th className="is-num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = row.alertBadge ?? "";
            const alertOn = Boolean(badge);
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
                <td className="is-alert">
                  <span
                    className={
                      alertOn
                        ? row.inMora
                          ? "supervisor-mobile-alert-n is-mora"
                          : "supervisor-mobile-alert-n"
                        : "supervisor-mobile-alert-n is-empty"
                    }
                    title={row.alertTitle}
                    aria-hidden={!alertOn}
                  >
                    {badge}
                  </span>
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
function SupervisorClientFicha({
  report,
  onBack,
}: {
  report: ReturnType<typeof buildLoanReport>;
  onBack: () => void;
}) {
  const f = report.financials;
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

  return (
    <div className="supervisor-client-ficha">
      <div className="supervisor-mobile-detail-head">
        <h3>{report.clientName}</h3>
        <button type="button" className="collector-mobile-pay-link" onClick={onBack}>
          volver
        </button>
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
            {report.movements.map((row) => (
              <li key={row.ref}>
                <span className="is-amount">{money(row.amount, { symbol: false })}</span>
                <span className="is-date">{row.paidDate || "—"}</span>
                <span className="is-time">{row.paidTime || "—"}</span>
                <span className="is-method">{row.method || "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="supervisor-client-ficha-sum">
        <div>
          <span>Capital</span>
          <b>{money(report.loan.capital, { symbol: false })}</b>
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
  const todayRow = history.find((row) => row.date === date);
  const prior = history.filter((row) => row.date < date);
  const saldoInicial =
    prior[0]?.saldo ?? openingSaldoForPeriod(collector.ref, period, monthCloses);
  const cobradoHoy = todayRow?.cobro ?? 0;
  const gastosHoy = todayRow?.gasto ?? 0;
  const enCaja = todayRow?.saldo ?? saldoInicial + cobradoHoy - gastosHoy;
  return { saldoInicial, cobradoHoy, gastosHoy, enCaja };
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
  onLogout,
}: Props) {
  const today = todayIso();
  const todayDisplay = isoToDisplay(today);
  const [view, setView] = useState<SupervisorView>("inicio");
  const [openRouteRef, setOpenRouteRef] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<RouteDetailMode>("totales");
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

  const coverage = useMemo(
    () => routeCoverageSummaries(collectors, routes, payments, clients, assignments, today),
    [collectors, routes, payments, clients, assignments, today],
  );

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
        : { saldoInicial: 0, cobradoHoy: 0, gastosHoy: 0, enCaja: 0 };

      const closeRecord = dayCloses.find(
        (row) => row.collectorRef === collectorRef && row.date === today,
      );
      const planillaClosed = mine.length > 0 && mine.every((row) => Boolean(row.dayClosedAt));
      const closed = Boolean(closeRecord) || planillaClosed;

      const cobradoHoy = closeRecord ? closeRecord.collected : caja.cobradoHoy;
      const gastosHoy = closeRecord ? closeRecord.expensesTotal : caja.gastosHoy;
      /** Dinero real en mano (incluye saldo de arrastre / inicial). */
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

  const totals = useMemo(() => {
    const prestamosHoy = liquidaciones.reduce(
      (sum, row) => sum + row.newLoans.length + row.renewals.length,
      0,
    );
    return {
      routes: liquidaciones.length,
      planilla: todayAssignments.length,
      cobradoHoy: liquidaciones.reduce((sum, row) => sum + row.cobradoHoy, 0),
      gastosHoy: liquidaciones.reduce((sum, row) => sum + row.gastosHoy, 0),
      enCaja: liquidaciones.reduce((sum, row) => sum + row.enCaja, 0),
      saldoInicial: liquidaciones.reduce((sum, row) => sum + row.saldoInicial, 0),
      prestamosHoy,
    };
  }, [liquidaciones, todayAssignments.length]);

  const openRoute = liquidaciones.find((row) => row.routeRef === openRouteRef) ?? null;
  const openAssignments = useMemo(
    () =>
      openRoute
        ? todayAssignments.filter((row) => row.collectorRef === openRoute.collectorRef)
        : [],
    [todayAssignments, openRoute],
  );

  function goToView(next: SupervisorView) {
    setOpenRouteRef(null);
    setDetailMode("totales");
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
    setView(next);
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
      const alertCount = loan
        ? collectionAlertsFromPayments(
            loan.ref,
            payments,
            today,
            Number(loan.collectionAlerts) || 0,
          )
        : 0;
      return {
        ref: row.ref,
        routeOrder: row.routeOrder || 0,
        name: `${row.name} ${row.lastName}`.trim(),
        phone: row.phone?.trim() || "—",
        alertCount,
        alertBadge: planillaAlertBadgeText(alertCount),
        alertTitle: planillaAlertTitle(alertCount),
        inMora: alertCount >= COLLECTION_ALERTS_BEFORE_MORA,
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
    // Misma ficha del sistema: préstamo sincronizado + todos los pagos.
    return buildLoanReport(clientesLoanSynced, clientesLoanClient, payments, assignments);
  }, [assignments, clientesLoanClient, clientesLoanSynced, payments]);
  const clientesDetailOpen = Boolean(clientesLoanClientRef);

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

  function openRouteSummary(ref: string) {
    setOpenRouteRef(ref);
    setDetailMode("totales");
    setView("inicio");
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

      <div
        className="supervisor-mobile-kpis is-home has-nuevo has-clientes"
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
          onClick={() => {
            setOpenRouteRef(null);
            setDetailMode("totales");
            setView("inicio");
          }}
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
          onClick={() => {
            setPlanillaRouteFilter(null);
            goToView("planilla");
          }}
        >
          <b>RUTA</b>
        </button>
        <button
          type="button"
          className={
            view === "caja" || (openRoute && detailMode === "totales")
              ? "supervisor-mobile-kpi is-caja on"
              : "supervisor-mobile-kpi is-caja"
          }
          onClick={() => {
            if (openRoute) {
              setDetailMode("totales");
              return;
            }
            goToView("caja");
          }}
          title={openRoute ? `Caja · ${openRoute.collectorName}` : "Caja del día"}
        >
          <b>CAJA</b>
        </button>
        <button
          type="button"
          className={
            view === "nuevo"
              ? "supervisor-mobile-kpi is-nuevo on"
              : "supervisor-mobile-kpi is-nuevo"
          }
          onClick={() => goToView("nuevo")}
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
          onClick={() => {
            setClientesRouteFilter(null);
            setClientesLoanClientRef(null);
            goToView("clientes");
          }}
        >
          <b>CLIENTES</b>
        </button>
      </div>

      {openRoute ? (
        <section className="supervisor-mobile-section">
          <div className="supervisor-mobile-detail-head">
            <h3>
              Ruta {openRoute.routeName} · {openRoute.collectorName}
            </h3>
            <button
              type="button"
              className="collector-mobile-pay-link"
              onClick={() => {
                if (detailMode !== "totales") setDetailMode("totales");
                else {
                  setOpenRouteRef(null);
                  setDetailMode("totales");
                  setView("inicio");
                }
              }}
            >
              volver
            </button>
          </div>

          {detailMode === "totales" ? (
            <>
              <div className="supervisor-mobile-sheet" aria-label="Liquidación de caja">
                <div className="supervisor-mobile-sheet-row">
                  <span>Saldo inicial</span>
                  <b>{money(openRoute.saldoInicial, { symbol: false })}</b>
                </div>
                <div className="supervisor-mobile-sheet-row">
                  <span>Cobrado hoy</span>
                  <b>+ {money(openRoute.cobradoHoy, { symbol: false })}</b>
                </div>
                <div className="supervisor-mobile-sheet-row">
                  <span>Gastos / consignación</span>
                  <b>− {money(openRoute.gastosHoy, { symbol: false })}</b>
                </div>
                <div className="supervisor-mobile-sheet-row is-total">
                  <span>En caja</span>
                  <b>{money(openRoute.enCaja, { symbol: false })}</b>
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
                  Ver planilla
                </button>
                <button
                  type="button"
                  className="btn compact ghost"
                  disabled={openRoute.newLoans.length + openRoute.renewals.length === 0}
                  onClick={() => setDetailMode("prestamos")}
                >
                  Ver préstamos
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
                  onOpen={openRouteSummary}
                />
              ))}
            </div>
          )}
        </section>
      ) : view === "nuevo" ? (
        <section className="supervisor-mobile-section">
          {nuevoMode === "menu" ? (
            <>
              <h3>Nuevo</h3>
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
                  className="collector-mobile-pay-link"
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
                <button
                  type="button"
                  className="collector-mobile-pay-link"
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
                            onClick={() => setNuevoLoanClientRef(row.ref)}
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
      ) : view === "clientes" ? (
        <section className="supervisor-mobile-section supervisor-mobile-clientes">
          {clientesPdfReport ? (
            <SupervisorClientFicha
              report={clientesPdfReport}
              onBack={() => setClientesLoanClientRef(null)}
            />
          ) : clientesDetailOpen && clientesLoanClient ? (
            <div className="supervisor-client-ficha">
              <div className="supervisor-mobile-detail-head">
                <h3>{`${clientesLoanClient.name} ${clientesLoanClient.lastName}`.trim()}</h3>
                <button
                  type="button"
                  className="collector-mobile-pay-link"
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
                  onOpen={(ref) => setClientesLoanClientRef(ref)}
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
