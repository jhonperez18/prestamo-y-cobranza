"use client";

import { useMemo, useState, type FormEvent } from "react";
import { clientsOnRouteSorted } from "@/lib/client-route-order";
import type { RouteClientDraft } from "@/lib/commit-portfolio-catalog";
import type { ClientRow } from "@/lib/mock-data";

type Props = {
  routeName: string;
  clients: ClientRow[];
  onCancel: () => void;
  onSave: (draft: RouteClientDraft) => Promise<boolean> | boolean;
};

/** Nuevo cliente desde el cobrador: nombre, posición en la ruta (como el taller) y ruta fija. */
export function CollectorNewClientSheet({ routeName, clients, onCancel, onSave }: Props) {
  const positionOptions = useMemo(() => {
    const max = clientsOnRouteSorted(clients, routeName).length + 1;
    return Array.from({ length: max }, (_, index) => index + 1);
  }, [clients, routeName]);
  const [name, setName] = useState("");
  const [routeOrder, setRouteOrder] = useState(positionOptions.length);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Escribe el nombre del cliente.");
      return;
    }
    const maxPos = Math.max(1, positionOptions.length);
    const pos = Math.min(Math.max(1, routeOrder || maxPos), maxPos);
    setSaving(true);
    setError("");
    try {
      const ok = await onSave({ name: trimmed, route: routeName, routeOrder: pos });
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
          <div className="collector-new-client-field">
            <span>Ruta</span>
            <b className="collector-new-client-route">{routeName}</b>
          </div>
        </div>
        <p className="collector-new-client-hint">
          Quedará en #{routeOrder} de la ruta {routeName}; el resto se corre. Sin préstamo aparece
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
