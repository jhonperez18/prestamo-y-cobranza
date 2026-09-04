"use client";

import { useEffect, useMemo, useState } from "react";
import type { CollectorRow, RouteRow } from "@/lib/mock-data";
import { clientsOnRouteListed, catalogRoutes, routeIsActive } from "@/lib/mock-data";
import type { ClientRow } from "@/lib/mock-data";
import { Pill } from "@/components/ui";

type Props = {
  routes: RouteRow[];
  collectors: CollectorRow[];
  clients: ClientRow[];
  onAssign: (routeRef: string, collectorRef: string) => void;
};

export function AssignRouteCollectorView({
  routes,
  collectors,
  clients,
  onAssign,
}: Props) {
  const catalog = useMemo(
    () =>
      catalogRoutes(routes)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [routes],
  );
  const activeCollectors = collectors.filter((row) => row.active);

  /** Rutas en modo edición (elige cobrador + Guardar). */
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [draftByRoute, setDraftByRoute] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraftByRoute((current) => {
      const next = { ...current };
      for (const route of catalog) {
        if (editingRef === route.ref) continue;
        next[route.ref] = route.collectorRef || "";
      }
      return next;
    });
  }, [catalog, editingRef]);

  function startEdit(route: RouteRow) {
    setEditingRef(route.ref);
    setDraftByRoute((current) => ({
      ...current,
      [route.ref]: route.collectorRef || "",
    }));
  }

  function cancelEdit(routeRef: string) {
    const route = catalog.find((row) => row.ref === routeRef);
    setDraftByRoute((current) => ({
      ...current,
      [routeRef]: route?.collectorRef || "",
    }));
    setEditingRef(null);
  }

  function save(route: RouteRow) {
    const nextCollector = draftByRoute[route.ref] ?? "";
    onAssign(route.ref, nextCollector);
    setEditingRef(null);
  }

  return (
    <section className="panel">
      <div className="head">
        <h1>Asignar cobrador a ruta</h1>
        <span className="count">{catalog.length}</span>
      </div>
      <p className="panel-lead">
        El cobrador se asigna a <strong>toda la ruta</strong> y queda fijo día a día hasta que lo
        modifique. Esa es la planilla que recibe en su app.
      </p>
      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              <th>Ruta</th>
              <th>Clientes</th>
              <th>Estado</th>
              <th>Cobrador</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {catalog.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5}>Aún no hay rutas. Cree una en Nueva ruta.</td>
              </tr>
            ) : (
              catalog.map((route) => {
                const count = clientsOnRouteListed(route.name, clients).length;
                const active = routeIsActive(route);
                const assigned = Boolean(route.collectorRef);
                const editing = editingRef === route.ref || !assigned;
                const draft = draftByRoute[route.ref] ?? route.collectorRef ?? "";

                return (
                  <tr key={route.ref}>
                    <td className="ref">Ruta {route.name}</td>
                    <td>{count}</td>
                    <td>
                      <Pill label={active ? "Activa" : "Inactiva"} kind={active ? "ok" : "draft"} />
                    </td>
                    <td>
                      {editing ? (
                        <select
                          className="route-collector-select"
                          value={draft}
                          onChange={(event) =>
                            setDraftByRoute((current) => ({
                              ...current,
                              [route.ref]: event.target.value,
                            }))
                          }
                          aria-label={`Cobrador de la ruta ${route.name}`}
                        >
                          <option value="">Sin asignar</option>
                          {activeCollectors.map((collector) => (
                            <option key={collector.ref} value={collector.ref}>
                              {collector.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="route-collector-locked">{route.collector}</span>
                      )}
                    </td>
                    <td>
                      <div className="route-assign-actions">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              className="btn primary compact"
                              onClick={() => save(route)}
                              disabled={draft === (route.collectorRef || "")}
                            >
                              Guardar
                            </button>
                            {assigned ? (
                              <button
                                type="button"
                                className="btn ghost compact"
                                onClick={() => cancelEdit(route.ref)}
                              >
                                Cancelar
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost compact"
                            onClick={() => startEdit(route)}
                          >
                            Modificar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
