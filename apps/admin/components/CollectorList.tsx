"use client";

import { useMemo, useState } from "react";
import { PhoneMiniIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { Pill } from "@/components/ui";
import { money } from "@/lib/mock-data";
import type { CollectorListItem } from "@/lib/collector-preview";

type Props = {
  title: string;
  rows: CollectorListItem[];
  onCreate: () => void;
  onOpen: (ref: string) => void;
};

export function CollectorList({ title, rows, onCreate, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState({ query: "", status: "" });

  const visible = useMemo(() => {
    return rows.filter((row) => {
      if (applied.status && row.statusLabel !== applied.status) return false;
      if (!applied.query) return true;
      const q = applied.query.toLowerCase();
      return (
        row.ref.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.phone.toLowerCase().includes(q) ||
        (row.document ?? "").toLowerCase().includes(q)
      );
    });
  }, [applied, rows]);

  function search() {
    setApplied({ query, status });
  }

  function clear() {
    setQuery("");
    setStatus("");
    setApplied({ query: "", status: "" });
  }

  return (
    <section className="panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{visible.length}</span>
        <div className="grow" />
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        <button className="plus" title="Crear" onClick={onCreate}>
          <PlusIcon />
        </button>
      </div>

      <div className="filters collector-filters">
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los estados</option>
          <option>En campo</option>
          <option>Disponible</option>
          <option>Cerrada</option>
          <option>Inactivo</option>
        </select>
        <input
          placeholder="Buscar nombre, teléfono, código…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && search()}
        />
        <button className="go" type="button" onClick={search}>
          <SearchIcon size={15} />
        </button>
        <button className="btn ghost filter-clear" type="button" onClick={clear}>
          Limpiar
        </button>
      </div>

      <div className="table-wrap">
        <table className="data list-grid collector-grid">
          <thead>
            <tr className="col-titles">
              <th>Código</th>
              <th>Cobrador</th>
              <th>Usuario móvil</th>
              <th>Rol</th>
              <th>Teléfono</th>
              <th>Ruta hoy</th>
              <th className="right">Cobrado</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={8}>No hay cobradores con esos filtros</td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.ref} onClick={() => onOpen(row.ref)}>
                  <td className="ref">{row.ref}</td>
                  <td>{row.name}</td>
                  <td>{row.accessLabel}</td>
                  <td>{row.roleName}</td>
                  <td>
                    {row.phone ? (
                      <span className="cell-with-ico">
                        <PhoneMiniIcon />
                        {row.phone}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{row.routeLabel}</td>
                  <td className="money right">{row.collected > 0 ? money(row.collected) : "—"}</td>
                  <td>
                    <Pill label={row.statusLabel} kind={row.statusKind} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
