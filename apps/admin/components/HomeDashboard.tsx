"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteClientsView } from "@/components/RouteClientsView";
import { TodayMovementsTable } from "@/components/TodayMovementsTable";
import { Pill } from "@/components/ui";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import { buildHomeDashboard } from "@/lib/home-dashboard";
import type { ModuleId } from "@/lib/navigation";
import { clientsOnRouteSorted, compareRouteNames } from "@/lib/client-route-order";
import {
  catalogRoutes,
  routeIsActive,
  type ActivityRow,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import type { KpiTone } from "@/lib/kpi-tones";

/** Color fijo por ruta: al reordenar paletas no cambia el tono de cada cuadro. */
const ROUTE_CHIP_TONE: Record<string, KpiTone> = {
  A: "amber",
  M: "teal",
  N: "coral",
  T: "sage",
};

type Props = {
  clients: ClientRow[];
  routes: RouteRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  collectors?: CollectorRow[];
  activities?: ActivityRow[];
  assignments?: DailyCollectionAssignment[];
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
  onOpenLoan,
  onOpenClient,
  onOpenPayment,
  onGo,
}: Props) {
  const today = todayIso();
  /** Celular vertical: siempre 2 columnas. Escritorio: una fila. */
  const [phoneStrip, setPhoneStrip] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setPhoneStrip(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const home = useMemo(
    () =>
      buildHomeDashboard(clients, loans, payments, routes, collectors, activities, assignments),
    [activities, assignments, clients, collectors, loans, payments, routes],
  );

  const routePanels = useMemo(() => {
    return catalogRoutes(routes)
      .filter(routeIsActive)
      .slice()
      .sort((a, b) => compareRouteNames(a.name, b.name))
      .map((route, index) => {
        const collector =
          route.collectorRef && route.collector && route.collector !== "—"
            ? route.collector
            : "Sin cobrador";
        const count = clientsOnRouteSorted(clients, route.name).length;
        return {
          ref: route.ref,
          name: route.name,
          collectorRef: route.collectorRef || "",
          collector,
          catalogCount: count,
          count,
          tone: ROUTE_CHIP_TONE[route.name] ?? TONES[index % TONES.length]!,
        };
      });
  }, [clients, routes]);

  const [selectedRoute, setSelectedRoute] = useState("");
  /** Paleta derecha: abre / cierra la tabla Movimientos hoy. */
  const [movementsOpen, setMovementsOpen] = useState(false);

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

  /** Solo M · T · A · N. Clientes / Préstamos / Cobrado / Mora viven en sus módulos. */
  const stripChips: StripChip[] = useMemo(
    () =>
      routePanels.map((route) => ({
        key: route.ref,
        label: `Ruta ${route.name}`,
        value: `${route.count} - ${route.collector}`,
        tone: route.tone,
        active: selectedRoute === route.name,
        onClick: () => setSelectedRoute(route.name),
      })),
    [routePanels, selectedRoute],
  );

  const stripStyle = phoneStrip
    ? ({
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "6px",
        width: "100%",
      } as const)
    : ({
        ["--home-strip-count" as string]: String(Math.max(stripChips.length, 1)),
      } as const);

  return (
    <div className="home-dashboard home-routes-dashboard is-unified">
      <div className={phoneStrip ? "home-strip is-phone-strip" : "home-strip"} style={stripStyle}>
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
        <div className="home-route-plantilla-row">
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
              onOpenLoan={onOpenLoan}
              onOpenClient={onOpenClient}
            />
          </div>
          <aside className="home-route-plantilla-side" aria-label="Movimientos hoy">
            <button
              type="button"
              className={
                movementsOpen
                  ? "home-strip-chip kpi-amber is-clickable is-active home-movements-chip"
                  : "home-strip-chip kpi-amber is-clickable home-movements-chip"
              }
              aria-pressed={movementsOpen}
              aria-expanded={movementsOpen}
              title="Abrir movimientos de hoy"
              onClick={() => setMovementsOpen((open) => !open)}
            >
              <span className="home-strip-label">Movimientos hoy</span>
              <span className="home-strip-value">
                {home.todayPayments.length.toLocaleString("es-CO")}
              </span>
            </button>
            {movementsOpen ? (
              <div className="home-movements-panel">
                <TodayMovementsTable
                  payments={home.todayPayments}
                  loans={loans}
                  onCreate={onGo ? () => onGo("cobranza", "hoy") : undefined}
                  onOpenPayment={onOpenPayment}
                />
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

      <div className="home-today-split">
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
