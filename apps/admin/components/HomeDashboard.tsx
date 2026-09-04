"use client";

import { useEffect, useMemo, useState } from "react";
import { RouteClientsView } from "@/components/RouteClientsView";
import { Kpi } from "@/components/ui";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { todayIso } from "@/lib/daily-dispatch";
import { planillaAssignmentsForRoute } from "@/lib/planilla-day-sync";
import {
  catalogRoutes,
  clientsOnRouteListed,
  routeIsActive,
  type ClientRow,
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
  assignments?: DailyCollectionAssignment[];
  onRenewLoan?: (loanRef: string) => void;
  onOpenLoan?: (loanRef: string) => void;
  onOpenClient?: (clientRef: string) => void;
};

const TONES: KpiTone[] = ["amber", "teal", "coral", "sage"];

export function HomeDashboard({
  clients,
  routes,
  loans,
  payments,
  assignments = [],
  onRenewLoan,
  onOpenLoan,
  onOpenClient,
}: Props) {
  const today = todayIso();

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

  return (
    <div className="home-dashboard home-routes-dashboard">
      {routePanels.length === 0 ? (
        <section className="panel">
          <div className="head">
            <h1>Rutas</h1>
          </div>
          <p className="ficha-empty">Aún no hay rutas creadas. Cree la primera en Rutas → Nueva ruta.</p>
        </section>
      ) : (
        <>
          <div className="kpis tone-kpis home-kpis home-route-kpis">
            {routePanels.map((route) => (
              <Kpi
                key={route.ref}
                label={`Ruta ${route.name}`}
                value={String(route.count)}
                hint={`${route.collector} · ${
                  route.count === 1
                    ? "1 en planilla"
                    : `${route.count} en planilla`
                }${
                  route.catalogCount !== route.count
                    ? ` · ${route.catalogCount} en ruta`
                    : ""
                }`}
                tone={route.tone}
                active={selectedRoute === route.name}
                onClick={() => setSelectedRoute(route.name)}
              />
            ))}
          </div>

          {selectedRoute && selected ? (
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
        </>
      )}
    </div>
  );
}
