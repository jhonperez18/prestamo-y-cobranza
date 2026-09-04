"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  normalizeRouteNumber,
  nextRouteNumber,
  type RouteRow,
} from "@/lib/mock-data";

export type RouteDraft = {
  name: string;
};

type Props = {
  route?: RouteRow;
  existingRoutes?: RouteRow[];
  onCancel: () => void;
  onSave: (draft: RouteDraft) => void;
};

export function NewRouteForm({ route, existingRoutes = [], onCancel, onSave }: Props) {
  const editing = Boolean(route);
  const suggested = useMemo(
    () =>
      editing
        ? normalizeRouteNumber(route!.name) || nextRouteNumber(existingRoutes)
        : nextRouteNumber(existingRoutes),
    [editing, route, existingRoutes],
  );
  const [number, setNumber] = useState(suggested);
  const [error, setError] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = normalizeRouteNumber(number);
    if (!value) {
      setError("Indique el número de la ruta (solo dígitos).");
      return;
    }
    const taken = existingRoutes.some(
      (row) =>
        row.ref !== route?.ref &&
        normalizeRouteNumber(row.name) === value,
    );
    if (taken) {
      setError(`Ya existe la ruta ${value}.`);
      return;
    }
    setError("");
    onSave({ name: value });
  }

  return (
    <>
      <div className="head">
        <h1>{editing ? "Modificar ruta" : "Nueva ruta"}</h1>
        {editing ? <span className="sheet-code">{route!.ref}</span> : null}
      </div>

      <form className="route-create sheet" onSubmit={onSubmit}>
        <div className="sheet-body">
          <div className="sheet-fields">
            <div className="sheet-row">
              <label className="sheet-label" htmlFor="route-number">
                Número
              </label>
              <input
                id="route-number"
                name="numero"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                autoFocus
                placeholder="Ej. 1"
                value={number}
                onChange={(event) => {
                  setNumber(normalizeRouteNumber(event.target.value));
                  if (error) setError("");
                }}
              />
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <p className="form-hint">Solo números: 1, 2, 3…</p>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            {editing ? "Guardar cambios" : "Guardar ruta"}
          </button>
        </div>
      </form>
    </>
  );
}
