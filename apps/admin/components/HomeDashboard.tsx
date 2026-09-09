"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteClientsView } from "@/components/RouteClientsView";
import { TodayMovementsTable } from "@/components/TodayMovementsTable";
import { Pill } from "@/components/ui";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import { APP_BUILD } from "@/lib/app-build";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import type { ModuleId } from "@/lib/navigation";
import { planillaAssignmentsForRoute } from "@/lib/planilla-day-sync";
import {
  catalogRoutes,
  clientsOnRouteListed,
  money,
  routeIsActive,
  type ActivityRow,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import type { KpiTone } from "@/lib/kpi-tones";

type Props = {
  clients: ClientRow[];
  routes: RouteRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  collectors?: CollectorRow[];
  activities?: ActivityRow[];
  assignments?: DailyCollectionAssignment[];
  onRenewLoan?: (loanRef: string) => void;
  onOpenLoan?: (loanRef: string) => void;
  onOpenClient?: (clientRef: string) => void;
  onOpenPayment?: (ref: string) => void;
  onGo?: (moduleId: ModuleId, viewId: string) => void;
};

const TONES: KpiTone[] = ["amber", "teal", "coral", "sage"];

type StripChip = {
  key: string;
  label: string;
  value: string;
  meta?: string;
  tone: KpiTone;
  active?: boolean;
  onClick?: () => void;
};

export function HomeDashboard({
  clients,
  routes,
  loans,
  payments,
  collectors = [],
  activities = [],
  assignments = [],
  onRenewLoan,
  onOpenLoan,
  onOpenClient,
  onOpenPayment,
  onGo,
}: Props) {
  const today = todayIso();

  const home = useMemo(
    () =>
      buildHomeDashboard(clients, loans, payments, routes, collectors, activities, assignments),
    [activities, assignments, clients, collectors, loans, payments, routes],
  );

  const routePanels = useMemo(() => {
    return catalogRoutes(routes)
      .filter(routeIsActive)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((route, index) => {
        const catalogCount = clientsOnRouteListed(route.name, clients).length;
        const planillaCount = planillaAssignmentsForRoute(
          assignments,
          route.name,
          route.collectorRef,
          today,
        ).length;
        const collector =
          route.collectorRef && route.collector && route.collector !== "—"
            ? route.collector
            : "Sin cobrador";
        return {
          ref: route.ref,
          name: route.name,
          collectorRef: route.collectorRef || "",
          collector,
          catalogCount,
          count: planillaCount,
          tone: TONES[index % TONES.length]!,
        };
      });
  }, [clients, routes, assignments, today]);

  const [selectedRoute, setSelectedRoute] = useState("");

  useEffect(() => {
    if (!routePanels.length) {
      setSelectedRoute("");
      return;
    }
    if (!routePanels.some((row) => row.name === selectedRoute)) {
      setSelectedRoute(routePanels[0]!.name);
    }
  }, [routePanels, selectedRoute]);

  const selected = routePanels.find((row) => row.name === selectedRoute);

  const stripChips: StripChip[] = useMemo(() => {
    const day: StripChip[] = [
      {
        key: "clientes",
        label: "Clientes activos",
        value: home.activeClients.toLocaleString("es-CO"),
        tone: "teal",
        onClick: onGo ? () => onGo("clientes", "activos") : undefined,
      },
      {
        key: "prestamos",
        label: "Préstamos",
        value: money(home.portfolioTotal, { symbol: false }),
        meta: home.activeLoansCount.toLocaleString("es-CO"),
        tone: "sage",
        onClick: onGo ? () => onGo("prestamos", "listado") : undefined,
      },
      {
        key: "cobrado",
        label: "Cobrado hoy",
        value: money(home.collectedToday, { symbol: false }),
        meta:
          home.collectedCount === 1
            ? "1 operación"
            : `${home.collectedCount.toLocaleString("es-CO")} operaciones`,
        tone: "amber",
        onClick: onGo ? () => onGo("cobranza", "pagos") : undefined,
      },
      {
        key: "mora",
        label: "Mora",
        value: money(home.moraTotal, { symbol: false }),
        meta:
          home.moraCount === 1
            ? "1 crédito"
            : `${home.moraCount.toLocaleString("es-CO")} créditos`,
        tone: "coral",
        onClick: onGo ? () => onGo("cartera", "mora") : undefined,
      },
    ];
    const routeChips: StripChip[] = routePanels.map((route) => ({
      key: route.ref,
      label: `Ruta ${route.name}`,
      value: `${route.count} - ${route.collector}`,
      tone: route.tone,
      active: selectedRoute === route.name,
      onClick: () => setSelectedRoute(route.name),
    }));
    return [...day, ...routeChips];
  }, [home, onGo, routePanels, selectedRoute]);

  return (
    <div className="home-dashboard home-routes-dashboard is-unified">
      <p className="home-build-stamp" title="Commit desplegado en este sitio">
        Código en este sitio: <strong>{APP_BUILD}</strong>
        {home.collectedCount === 0 ? (
          <span className="home-build-hint">
            {" "}
            · Cobrado hoy 0 = sin pagos en ESTE navegador (Chrome y Vercel no comparten datos demo)
          </span>
        ) : null}
      </p>
      <div
        className="home-strip"
        style={{ ["--home-strip-count" as string]: String(Math.max(stripChips.length, 1)) }}
      >
        {stripChips.map((chip) => {
          const className = [
            "home-strip-chip",
            `kpi-${chip.tone}`,
            chip.onClick ? "is-clickable" : "",
            chip.active ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const body = (
            <>
              <span className="home-strip-label">{chip.label}</span>
              <span className="home-strip-value">{chip.value}</span>
              {chip.meta ? <span className="home-strip-meta">{chip.meta}</span> : null}
            </>
          );
          if (chip.onClick) {
            return (
              <button
                key={chip.key}
                type="button"
                className={className}
                onClick={chip.onClick}
                aria-pressed={chip.active}
                title={`${chip.label}: ${chip.value}`}
              >
                {body}
              </button>
            );
          }
          return (
            <div key={chip.key} className={className} title={`${chip.label}: ${chip.value}`}>
              {body}
            </div>
          );
        })}
      </div>

      {routePanels.length === 0 ? (
        <section className="panel">
          <div className="head">
            <h1>Rutas</h1>
          </div>
          <p className="ficha-empty">Aún no hay rutas creadas. Cree la primera en Rutas → Nueva ruta.</p>
        </section>
      ) : selectedRoute && selected ? (
        <div className="home-route-plantilla">
          <RouteClientsView
            routeName={selectedRoute}
            clients={clients}
            loans={loans}
            payments={payments}
            assignments={assignments}
            collectorRef={selected.collectorRef || undefined}
            collectorName={selected.collector}
            planillaDate={today}
            embedded
            onRenewLoan={onRenewLoan}
            onOpenLoan={onOpenLoan}
            onOpenClient={onOpenClient}
          />
        </div>
      ) : null}

      <div className="grid-2 home-today-split">
        <TodayMovementsTable
          payments={home.todayPayments}
          loans={loans}
          onCreate={onGo ? () => onGo("cobranza", "hoy") : undefined}
          onOpenPayment={onOpenPayment}
        />
        <section className="panel home-routes-field">
          <div className="head">
            <h2>Rutas en campo</h2>
            <span className="count">{home.routes.length}</span>
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
                {home.routes.length === 0 ? (
                  <tr className="empty-row">
                    <td colSpan={3}>No hay rutas activas.</td>
                  </tr>
                ) : (
                  home.routes.map((row) => (
                    <tr key={row.ref}>
                      <td className="routes-zone">{row.zone}</td>
                      <td className="routes-assignment">
                        {row.collector} · {row.clients} cliente
                        {row.clients === 1 ? "" : "s"}
                      </td>
                      <td>
                        <Pill label={row.status} kind={row.statusKind} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
