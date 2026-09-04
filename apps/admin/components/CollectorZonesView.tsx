"use client";

import { useMemo, useState } from "react";
import { Kpi, Pill } from "@/components/ui";
import {
  routeCoverageSummaries,
  routeCoverageTotals,
} from "@/lib/collector-preview";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { money, type ClientRow, type CollectorRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";

type Props = {
  collectors: CollectorRow[];
  routes: RouteRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  assignments?: DailyCollectionAssignment[];
  onOpenCollector: (ref: string) => void;
  onAssignCollectors: () => void;
  onOpenRouteClients?: (routeName: string) => void;
};

type CoverageFilter = "all" | "with" | "without";

export function CollectorZonesView({
  collectors,
  routes,
  payments,
  clients,
  assignments = [],
  onOpenCollector,
  onAssignCollectors,
  onOpenRouteClients,
}: Props) {
  const [filter, setFilter] = useState<CoverageFilter>("all");

  const summaries = useMemo(
    () => routeCoverageSummaries(collectors, routes, payments, clients, assignments),
    [collectors, routes, payments, clients, assignments],
  );
  const totals = useMemo(() => routeCoverageTotals(summaries), [summaries]);

  const visible = useMemo(() => {
    if (filter === "with") return summaries.filter((row) => row.collectorName !== "Sin cobrador");
    if (filter === "without") return summaries.filter((row) => row.collectorName === "Sin cobrador");
    return summaries;
  }, [summaries, filter]);

  return (
    <>
      <div className="kpis tone-kpis zone-kpis">
        <Kpi
          label="Rutas"
          value={String(totals.routes)}
          hint={`${totals.clients} clientes en cobertura`}
          tone="teal"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <Kpi
          label="Con cobrador"
          value={String(totals.withCollector)}
          hint="Asignación fija por ruta"
          tone="sage"
          active={filter === "with"}
          onClick={() => setFilter("with")}
        />
        <Kpi
          label="Sin cobrador"
          value={String(totals.withoutCollector)}
          hint="Hay que asignar"
          tone="coral"
          active={filter === "without"}
          onClick={() => setFilter("without")}
        />
        <Kpi
          label="Planilla hoy"
          value={String(totals.planillaToday)}
          hint={`${money(totals.collectedToday)} cobrado`}
          tone="amber"
          onClick={() => setFilter("all")}
        />
      </div>

      <section className="panel">
        <div className="head">
          <div className="head-title">
            <h1>Cobertura por ruta</h1>
            <span className="count">{visible.length}</span>
          </div>
          <div className="grow" />
          <button type="button" className="btn primary" onClick={onAssignCollectors}>
            Asignar cobrador
          </button>
        </div>
        <p className="panel-lead">
          Cada ruta tiene un cobrador fijo. Eso arma la planilla del día en la app. Si falta
          cobrador, asígnalo una vez; queda hasta que lo cambies.
        </p>

        {visible.length === 0 ? (
          <p className="ficha-empty">
            {summaries.length === 0
              ? "Aún no hay rutas. Crea la primera en Rutas → Nueva ruta."
              : filter === "without"
                ? "Todas las rutas ya tienen cobrador."
                : "No hay rutas con cobrador asignado."}
          </p>
        ) : (
          <div className="zone-cards">
            {visible.map((row) => (
              <article className="zone-card" key={row.routeRef}>
                <header>
                  <div>
                    <h2>Ruta {row.routeName}</h2>
                    <p className="zone-card-sub">{row.collectorName}</p>
                  </div>
                  <Pill label={row.statusLabel} kind={row.statusKind} />
                </header>
                <div className="zone-stats">
                  <div className="zone-stat">
                    <span>Clientes</span>
                    <strong>{row.clients}</strong>
                  </div>
                  <div className="zone-stat">
                    <span>En planilla hoy</span>
                    <strong>{row.planillaToday}</strong>
                  </div>
                  <div className="zone-stat">
                    <span>Cobrado hoy</span>
                    <strong>{money(row.collectedToday)}</strong>
                  </div>
                  <div className="zone-stat">
                    <span>Cobrador</span>
                    <strong>{row.collector ? "Asignado" : "Pendiente"}</strong>
                  </div>
                </div>
                <div className="zone-card-actions">
                  {row.collector ? (
                    <button
                      type="button"
                      className="btn ghost compact"
                      onClick={() => onOpenCollector(row.collector!.ref)}
                    >
                      Ver cobrador
                    </button>
                  ) : (
                    <button type="button" className="btn primary compact" onClick={onAssignCollectors}>
                      Asignar
                    </button>
                  )}
                  {onOpenRouteClients ? (
                    <button
                      type="button"
                      className="btn ghost compact"
                      onClick={() => onOpenRouteClients(row.routeName)}
                    >
                      Ver clientes
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
