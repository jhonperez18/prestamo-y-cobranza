"use client";

import { useMemo, useState } from "react";
import { Pill } from "@/components/ui";
import { routeCoverageSummaries } from "@/lib/collector-preview";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  buildCollectorDayHistory,
  openingSaldoForPeriod,
  periodFromDateIso,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { todayIso } from "@/lib/daily-dispatch";
import { isoToDisplay } from "@/lib/loan-preview";
import {
  money,
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
};

type SupervisorView = "routes" | "planilla" | "caja";
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
  newLoans: LoanRow[];
  renewals: LoanRow[];
  statusLabel: string;
  statusKind: StatusKind;
};

function visitLabel(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "Cobrado";
  if (status === "parcial") return "Parcial";
  if (status === "omitido") return "No visitado";
  return "Pendiente";
}

function visitLabelShort(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "Cob.";
  if (status === "parcial") return "Parc.";
  if (status === "omitido") return "N/V";
  return "Pend.";
}

function visitKind(status?: DailyCollectionAssignment["visitStatus"]): StatusKind {
  if (status === "cobrado") return "paid";
  if (status === "parcial") return "partial";
  if (status === "omitido") return "overdue";
  return "pending";
}

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

function loanBalanceForAssignment(loans: LoanRow[], loanRef: string) {
  return loans.find((row) => row.ref === loanRef)?.balance ?? 0;
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
            <th className="is-alert" aria-label="Atraso" />
            <th className="is-estado">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="is-ruta">{row.index}</td>
              <td className="is-nombre" title={row.clientName}>
                {row.clientName}
              </td>
              <td className="is-num">{money(row.saldo, { symbol: false })}</td>
              <td className="is-num">{row.cuota > 0 ? money(row.cuota, { symbol: false }) : "—"}</td>
              <td className="is-alert">
                <span
                  className={
                    (row.alertCount ?? 0) > 0
                      ? "supervisor-mobile-alert-n"
                      : "supervisor-mobile-alert-n is-empty"
                  }
                  title={
                    (row.alertCount ?? 0) > 0 ? `${row.alertCount} día(s) sin pago` : undefined
                  }
                  aria-hidden={(row.alertCount ?? 0) <= 0}
                >
                  {(row.alertCount ?? 0) > 0 ? row.alertCount : ""}
                </span>
              </td>
              <td className="is-estado">
                <span title={visitLabel(row.visitStatus)}>
                  <Pill label={visitLabelShort(row.visitStatus)} kind={visitKind(row.visitStatus)} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
}: Props) {
  const today = todayIso();
  const todayDisplay = isoToDisplay(today);
  const [view, setView] = useState<SupervisorView>("routes");
  const [openRouteRef, setOpenRouteRef] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<RouteDetailMode>("totales");

  const coverage = useMemo(
    () => routeCoverageSummaries(collectors, routes, payments, clients, assignments, today),
    [collectors, routes, payments, clients, assignments, today],
  );

  const todayAssignments = useMemo(
    () => assignments.filter((row) => row.dispatched && row.dispatchDate === today),
    [assignments, today],
  );

  const assignedCoverage = useMemo(
    () => coverage.filter((row) => row.collectorName !== "Sin cobrador"),
    [coverage],
  );

  const liquidaciones = useMemo((): RouteLiquidacion[] => {
    return assignedCoverage.map((route) => {
      const collector = route.collector;
      const collectorRef = collector?.ref ?? "";
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

      let statusLabel = "Sin planilla";
      let statusKind: StatusKind = "draft";
      if (mine.length) {
        if (pending === 0) {
          statusLabel = "Al día";
          statusKind = "ok";
        } else if (done > 0 || caja.cobradoHoy > 0) {
          statusLabel = "En campo";
          statusKind = "pending";
        } else {
          statusLabel = "Por iniciar";
          statusKind = "warn";
        }
      }
      if (loansToday.length > 0 && statusKind !== "ok") {
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
        cobradoHoy: caja.cobradoHoy,
        gastosHoy: caja.gastosHoy,
        enCaja: caja.enCaja,
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

  function toggleView(next: SupervisorView) {
    setOpenRouteRef(null);
    setDetailMode("totales");
    setView((current) => (current === next ? "routes" : next));
  }

  function openRouteSummary(ref: string) {
    setOpenRouteRef(ref);
    setDetailMode("totales");
    setView("routes");
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
        className={
          openRoute
            ? "supervisor-mobile-kpis has-caja"
            : "supervisor-mobile-kpis"
        }
        role="group"
        aria-label="Resumen del día"
      >
        <button
          type="button"
          className={view === "routes" && !openRoute ? "supervisor-mobile-kpi on" : "supervisor-mobile-kpi"}
          onClick={() => {
            setOpenRouteRef(null);
            setDetailMode("totales");
            setView("routes");
          }}
        >
          <b>{totals.routes}</b>
          <span>Rutas</span>
        </button>
        <button
          type="button"
          className={view === "planilla" ? "supervisor-mobile-kpi on" : "supervisor-mobile-kpi"}
          onClick={() => toggleView("planilla")}
        >
          <b>{totals.planilla}</b>
          <span>Planilla</span>
        </button>
        {openRoute ? (
          <button
            type="button"
            className={
              detailMode === "totales"
                ? "supervisor-mobile-kpi is-money on"
                : "supervisor-mobile-kpi is-money"
            }
            onClick={() => {
              setDetailMode("totales");
              setView("routes");
            }}
            title={`En caja · ${openRoute.collectorName}`}
          >
            <b>{money(openRoute.enCaja)}</b>
            <span>En caja</span>
          </button>
        ) : null}
      </div>

      {openRoute ? (
        <section className="supervisor-mobile-section">
          <div className="supervisor-mobile-detail-head">
            <h3>
              {openRoute.routeName} · {openRoute.collectorName}
            </h3>
            <button
              type="button"
              className="collector-mobile-pay-link"
              onClick={() => {
                if (detailMode !== "totales") setDetailMode("totales");
                else {
                  setOpenRouteRef(null);
                  setDetailMode("totales");
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
                  <b>{money(openRoute.saldoInicial)}</b>
                </div>
                <div className="supervisor-mobile-sheet-row">
                  <span>Cobrado hoy</span>
                  <b>+ {money(openRoute.cobradoHoy)}</b>
                </div>
                <div className="supervisor-mobile-sheet-row">
                  <span>Gastos / consignación</span>
                  <b>− {money(openRoute.gastosHoy)}</b>
                </div>
                <div className="supervisor-mobile-sheet-row is-total">
                  <span>En caja</span>
                  <b>{money(openRoute.enCaja)}</b>
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
                <span>En caja {money(openRoute.enCaja)}</span>
              </p>
              {openAssignments.length === 0 ? (
                <p className="ficha-empty">Sin planilla enviada hoy.</p>
              ) : (
                <PlanillaTable
                  rows={openAssignments.map((row, index) => ({
                    key: row.itemId,
                    index: index + 1,
                    clientName: row.clientName,
                    saldo: loanBalanceForAssignment(loans, row.loanRef),
                    cuota: row.amountDue,
                    alertCount: row.alertCount,
                    visitStatus: row.visitStatus,
                  }))}
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
                          {money(loan.balance || loan.total || 0)}
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
          <h3>Planilla de hoy</h3>
          {todayAssignments.length === 0 ? (
            <p className="ficha-empty">No hay cobros en planilla hoy.</p>
          ) : (
            <PlanillaTable
              rows={todayAssignments.map((row, index) => ({
                key: `${row.itemId}-${row.collectorRef}`,
                index: index + 1,
                clientName: row.clientName,
                saldo: loanBalanceForAssignment(loans, row.loanRef),
                cuota: row.amountDue,
                alertCount: row.alertCount,
                visitStatus: row.visitStatus,
              }))}
            />
          )}
        </section>
      ) : view === "caja" ? (
        <section className="supervisor-mobile-section">
          <h3>Caja consolidada</h3>
          <div className="supervisor-mobile-sheet">
            <div className="supervisor-mobile-sheet-row">
              <span>Saldo inicial</span>
              <b>{money(totals.saldoInicial)}</b>
            </div>
            <div className="supervisor-mobile-sheet-row">
              <span>Cobrado hoy</span>
              <b>+ {money(totals.cobradoHoy)}</b>
            </div>
            <div className="supervisor-mobile-sheet-row">
              <span>Gastos / consignación</span>
              <b>− {money(totals.gastosHoy)}</b>
            </div>
            <div className="supervisor-mobile-sheet-row is-total">
              <span>En caja</span>
              <b>{money(totals.enCaja)}</b>
            </div>
            <div className="supervisor-mobile-sheet-row is-muted">
              <span>Préstamos / renovaciones</span>
              <b>{totals.prestamosHoy}</b>
            </div>
          </div>
          <LiquidacionTable rows={liquidaciones} onOpen={openRouteSummary} />
        </section>
      ) : (
        <section className="supervisor-mobile-section">
          <h3>Liquidación por ruta</h3>
          {liquidaciones.length === 0 ? (
            <p className="ficha-empty">No hay rutas con cobrador.</p>
          ) : (
            <LiquidacionTable rows={liquidaciones} onOpen={openRouteSummary} />
          )}
        </section>
      )}
    </div>
  );
}
