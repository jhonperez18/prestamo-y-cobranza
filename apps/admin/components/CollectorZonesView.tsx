"use client";

import { useMemo, useState } from "react";
import { Kpi, Pill } from "@/components/ui";
import { kpiToneAt } from "@/lib/kpi-tones";
import { money, ZONES } from "@/lib/mock-data";
import { zoneSummaries } from "@/lib/collector-preview";
import type { ClientRow, CollectorRow, PaymentRow, RouteRow } from "@/lib/mock-data";

type Props = {
  collectors: CollectorRow[];
  routes: RouteRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  onOpenCollector: (ref: string) => void;
  onOpenZoneList: (zone: string) => void;
};

export function CollectorZonesView({ collectors, routes, payments, clients, onOpenCollector, onOpenZoneList }: Props) {
  const [zoneFilter, setZoneFilter] = useState("");
  const summaries = useMemo(
    () => zoneSummaries(collectors, routes, payments, clients),
    [collectors, routes, payments, clients],
  );
  const visible = zoneFilter ? summaries.filter((row) => row.zone === zoneFilter) : summaries;

  return (
    <>
      <div className="kpis tone-kpis zone-kpis">
        {summaries.map((row, index) => (
          <Kpi
            key={row.zone}
            label={`Zona ${row.zone}`}
            value={String(row.collectors.length)}
            hint={`${row.activeRoutes} rutas · ${money(row.collected)} cobrado`}
            tone={kpiToneAt(index)}
          />
        ))}
      </div>

      <section className="panel">
        <div className="head">
          <h1>Zonas</h1>
          <span className="count">{visible.length}</span>
          <div className="grow" />
          <div className="filters collector-filters compact">
            <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
              <option value="">Todas las zonas</option>
              {ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="zone-cards">
          {visible.map((row) => (
            <article className="zone-card" key={row.zone}>
              <header>
                <h2>{row.zone}</h2>
                <button type="button" className="btn ghost" onClick={() => onOpenZoneList(row.zone)}>
                  Ver usuarios
                </button>
              </header>
              <div className="zone-stats">
                <div className="zone-stat">
                  <span>Cobradores</span>
                  <strong>{row.collectors.length}</strong>
                </div>
                <div className="zone-stat">
                  <span>Rutas activas</span>
                  <strong>{row.activeRoutes}</strong>
                </div>
                <div className="zone-stat">
                  <span>Clientes en ruta</span>
                  <strong>{row.clients}</strong>
                </div>
                <div className="zone-stat">
                  <span>Cobrado</span>
                  <strong>{money(row.collected)}</strong>
                </div>
              </div>
              <div className="zone-routes">
                {row.routes.length ? (
                  row.routes.map((route) => (
                    <div className="zone-route-row" key={route.ref}>
                      <div>
                        <strong>{route.name}</strong>
                        <span>
                          {route.collector} · {route.clients} clientes
                        </span>
                      </div>
                      <Pill label={route.status} kind={route.kind} />
                    </div>
                  ))
                ) : (
                  <p className="ficha-empty">Sin rutas en esta zona.</p>
                )}
              </div>
              <div className="zone-collectors">
                {row.collectors.map((collector) => (
                  <button
                    key={collector.ref}
                    type="button"
                    className="zone-collector-chip"
                    onClick={() => onOpenCollector(collector.ref)}
                  >
                    {collector.name}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
