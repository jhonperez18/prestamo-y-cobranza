"use client";

import { useMemo, useState, type FormEvent } from "react";
import { clientsOnRouteSorted } from "@/lib/client-route-order";
import type { RouteClientDraft } from "@/lib/commit-portfolio-catalog";
import type { ClientRow } from "@/lib/mock-data";

type Props = {
  routeName: string;
  clients: ClientRow[];
  /** Supervisor: rutas a elegir. Sin esto la ruta es fija (planilla abierta del cobrador). */
  routeOptions?: string[];
  onCancel: () => void;
  onSave: (draft: RouteClientDraft) => Promise<boolean> | boolean;
};

/** Nuevo cliente desde el cobrador: nombre, posición en la ruta (como el taller) y ruta fija. */
export function CollectorNewClientSheet({
  routeName,
  clients,
  routeOptions,
  onCancel,
  onSave,
}: Props) {
  const [route, setRoute] = useState(routeName);
  const positionOptions = useMemo(() => {
    const max = clientsOnRouteSorted(clients, route).length + 1;
    return Array.from({ length: max }, (_, index) => index + 1);
  }, [clients, route]);
  const [name, setName] = useState("");
  const [routeOrder, setRouteOrder] = useState(positionOptions.length);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canPickRoute = Boolean(routeOptions && routeOptions.length > 1);

  function changeRoute(next: string) {
    setRoute(next);
    setRouteOrder(clientsOnRouteSorted(clients, next).length + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Escribe el nombre del cliente.");
      return;
    }
    if (!route.trim()) {
      setError("Elige la ruta del cliente.");
      return;
    }
    const maxPos = Math.max(1, positionOptions.length);
    const pos = Math.min(Math.max(1, routeOrder || maxPos), maxPos);
    setSaving(true);
    setError("");
    try {
      const ok = await onSave({ name: trimmed, route, routeOrder: pos });
      if (!ok) setError("No se pudo crear el cliente.");
    } catch (err) {
      console.error("[nuevo cliente]", err);
      setError("No se pudo crear el cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="collector-new-client" role="dialog" aria-labelledby="collector-new-client-title">
      <div className="collector-new-client-head">
        <h2 id="collector-new-client-title">Nuevo cliente</h2>
        <button type="button" className="collector-mobile-pay-link is-back" onClick={onCancel}>
          cerrar
        </button>
      </div>
      <form className="collector-new-client-form" onSubmit={handleSubmit}>
        <label className="collector-new-client-field">
          <span>Nombre</span>
          <input
            name="nombre"
            autoComplete="off"
            placeholder="Nombre del cliente"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <div className="collector-new-client-row">
          <label className="collector-new-client-field">
            <span>Posición</span>
            <select
              name="posicion"
              value={routeOrder}
              onChange={(event) => setRouteOrder(Number(event.target.value))}
            >
              {positionOptions.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                  {pos === positionOptions.length ? " (al final)" : ""}
                </option>
              ))}
            </select>
          </label>
          {canPickRoute ? (
            <label className="collector-new-client-field">
              <span>Ruta</span>
              <select
                name="ruta"
                value={route}
                onChange={(event) => changeRoute(event.target.value)}
              >
                {routeOptions?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="collector-new-client-field">
              <span>Ruta</span>
              <b className="collector-new-client-route">{route}</b>
            </div>
          )}
        </div>
        <p className="collector-new-client-hint">
          Quedará en #{routeOrder} de la ruta {route}; el resto se corre. Sin préstamo aparece
          en la lista para prestarle.
        </p>
        {error ? (
          <p className="receipt-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="collector-new-client-actions">
          <button type="submit" className="collector-new-client-save" disabled={saving}>
            {saving ? "Guardando…" : "Crear cliente"}
          </button>
        </div>
      </form>
    </section>
  );
}
