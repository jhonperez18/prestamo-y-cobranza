"use client";

import { type FormEvent } from "react";
import { ZONES, type RouteRow } from "@/lib/mock-data";

export type RouteDraft = {
  name: string;
  zone: string;
  frequency: string;
  notes: string;
};

type Props = {
  route?: RouteRow;
  onCancel: () => void;
  onSave: (draft: RouteDraft) => void;
};

const FREQUENCIES = ["Lun–Vie", "Lun–Sáb", "Diario", "Quincenal", "Mensual"];

export function NewRouteForm({ route, onCancel, onSave }: Props) {
  const editing = Boolean(route);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: String(form.get("nombre") ?? "").trim(),
      zone: String(form.get("zona") ?? "").trim(),
      frequency: String(form.get("frecuencia") ?? FREQUENCIES[1]),
      notes: String(form.get("notas") ?? "").trim(),
    });
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
              <label className="sheet-label" htmlFor="route-name">
                Nombre de la ruta
              </label>
              <input
                id="route-name"
                name="nombre"
                required
                placeholder="Ej. Barrio San Mateo, Playa norte…"
                defaultValue={route?.name}
              />
            </div>
            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="route-zone">
                Zona
              </label>
              <select id="route-zone" name="zona" required defaultValue={route?.zone ?? ZONES[0]}>
                {ZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <label className="sheet-label" htmlFor="route-frequency">
                Frecuencia
              </label>
              <select
                id="route-frequency"
                name="frecuencia"
                defaultValue={route?.frequency ?? FREQUENCIES[1]}
              >
                {FREQUENCIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <div className="sheet-row">
              <label className="sheet-label" htmlFor="route-notes">
                Notas
              </label>
              <input id="route-notes" name="notas" placeholder="Opcional" defaultValue={route?.notes ?? ""} />
            </div>
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
