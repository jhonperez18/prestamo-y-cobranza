"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AtMiniIcon,
  CloseIcon,
  PersonMiniIcon,
  PhoneMiniIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/icons";
import { ColumnPicker } from "@/components/ColumnPicker";
import { money, ROUTES, type ClientRow } from "@/lib/mock-data";
import { clientStatusKind } from "@/lib/client-review";
import { Pill } from "@/components/ui";

export const CLIENT_COLUMNS = [
  { id: "ref", label: "Código" },
  { id: "alta", label: "Fecha creación" },
  { id: "name", label: "Nombre" },
  { id: "lastName", label: "Apellidos" },
  { id: "document", label: "Documento" },
  { id: "route", label: "Ruta" },
  { id: "email", label: "Correo" },
  { id: "phone", label: "Teléfono" },
  { id: "city", label: "Ciudad" },
  { id: "barrio", label: "Barrio" },
  { id: "address", label: "Dirección" },
  { id: "notes", label: "Observaciones" },
  { id: "pending", label: "Pendiente" },
  { id: "status", label: "Estado" },
] as const;

type ColId = (typeof CLIENT_COLUMNS)[number]["id"];

type ClientListView = "listado" | "revision" | "activos" | "inactivos";

const DEFAULT_COLS: ColId[] = ["ref", "name", "lastName", "city", "route", "email", "phone", "pending"];
const REVISION_COLS: ColId[] = ["name", "lastName", "document", "route", "phone", "address"];
const STORAGE_KEY = "nexo.clientes.columns";

type Filters = Record<ColId, string>;

const EMPTY_FILTERS = Object.fromEntries(CLIENT_COLUMNS.map((col) => [col.id, ""])) as Filters;

type Props = {
  title: string;
  count: string | number;
  rows: ClientRow[];
  variant?: "default" | "revision";
  clientView?: ClientListView;
  canApprove?: boolean;
  onCreate: () => void;
  onOpen: (ref: string) => void;
  onApprove?: (refs: string[]) => void;
  onReject?: (refs: string[]) => void;
};

function matches(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function fieldOf(row: ClientRow, id: ColId) {
  if (id === "pending") return String(row.pending);
  return String(row[id] ?? "");
}

export function ClientList({
  title,
  count,
  rows,
  variant = "default",
  clientView = "listado",
  canApprove = false,
  onCreate,
  onOpen,
  onApprove,
  onReject,
}: Props) {
  const isRevision = variant === "revision";
  const hideStatusColumn = clientView !== "listado";
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<ColId[]>(DEFAULT_COLS);
  const [ready, setReady] = useState(false);

  const pickerColumns = useMemo(
    () =>
      CLIENT_COLUMNS.filter((col) => col.id !== "ref" && (!hideStatusColumn || col.id !== "status")).map(
        (col) => ({ id: col.id, label: col.label }),
      ),
    [hideStatusColumn],
  );

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage after mount */
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && !isRevision) {
        const parsed = JSON.parse(saved) as string[];
        const valid = parsed
          .map((id) => (id === "nick" ? "lastName" : id))
          .filter((id): id is ColId => CLIENT_COLUMNS.some((col) => col.id === id));
        if (valid.length) setVisibleCols(valid);
      } else if (isRevision) {
        setVisibleCols(REVISION_COLS);
      }
    } catch {
      if (isRevision) {
        setVisibleCols(REVISION_COLS);
      }
    }
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [isRevision]);

  useEffect(() => {
    if (!hideStatusColumn) return;
    setVisibleCols((current) => current.filter((id) => id !== "status"));
    setFilters((current) => ({ ...current, status: "" }));
    setApplied((current) => ({ ...current, status: "" }));
  }, [hideStatusColumn]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibleCols));
  }, [ready, visibleCols]);

  const activeCols = CLIENT_COLUMNS.filter(
    (col) => visibleCols.includes(col.id) && (!hideStatusColumn || col.id !== "status"),
  );

  const visible = useMemo(() => {
    return rows.filter((row) =>
      CLIENT_COLUMNS.every((col) => {
        const query = applied[col.id];
        if (!query) return true;
        if (col.id === "route" || col.id === "status") return fieldOf(row, col.id) === query;
        return matches(fieldOf(row, col.id), query);
      }),
    );
  }, [applied, rows]);

  const allChecked = visible.length > 0 && visible.every((row) => selected.includes(row.ref));

  function setField(id: ColId, value: string, applyNow = false) {
    setFilters((current) => ({ ...current, [id]: value }));
    if (applyNow) setApplied((current) => ({ ...current, [id]: value }));
  }

  function search() {
    setApplied(filters);
  }

  function clear() {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setSelected([]);
  }

  function toggleColumn(id: ColId) {
    setVisibleCols((current) => {
      if (current.includes(id)) {
        if (current.length === 1) return current;
        return current.filter((col) => col !== id);
      }
      return CLIENT_COLUMNS.map((col) => col.id).filter((col) => col === id || current.includes(col));
    });
  }

  function renderFilter(id: ColId) {
    if (id === "route") {
      return (
        <select value={filters.route} onChange={(event) => setField("route", event.target.value, true)}>
          <option value="">Todas</option>
          {ROUTES.map((route) => (
            <option key={route.id} value={route.name}>
              {route.name}
            </option>
          ))}
        </select>
      );
    }
    if (id === "status") return null;
    if (id === "pending") return null;
    return (
      <input
        value={filters[id]}
        onChange={(event) => setField(id, event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && search()}
      />
    );
  }

  function renderCell(row: ClientRow, id: ColId): ReactNode {
    if (id === "ref") return <span className="ref">{row.ref}</span>;
    if (id === "alta") return row.alta || "—";
    if (id === "name") {
      return (
        <span className="cell-with-ico">
          <PersonMiniIcon />
          {row.name}
        </span>
      );
    }
    if (id === "email") {
      return row.email ? (
        <span className="cell-with-ico">
          <AtMiniIcon />
          {row.email}
        </span>
      ) : (
        "—"
      );
    }
    if (id === "phone") {
      return row.phone ? (
        <span className="cell-with-ico">
          <PhoneMiniIcon />
          {row.phone}
        </span>
      ) : (
        "—"
      );
    }
    if (id === "pending") return money(row.pending);
    if (id === "status") return <Pill label={row.status} kind={clientStatusKind(row.status)} />;
    return fieldOf(row, id) || "—";
  }

  function approveSelected() {
    if (!onApprove || !selected.length) return;
    onApprove(selected);
    setSelected([]);
  }

  function rejectSelected() {
    if (!onReject || !selected.length) return;
    onReject(selected);
    setSelected([]);
  }

  function openSelectedForApproval() {
    if (selected.length !== 1 || !onApprove) return;
    onApprove([selected[0]!]);
    setSelected([]);
  }

  return (
    <section className="panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{count}</span>
        {isRevision && selected.length > 0 ? (
          <div className="client-review-actions">
            <button
              type="button"
              className="btn ghost compact"
              disabled={selected.length !== 1}
              onClick={openSelectedForApproval}
            >
              Completar ficha
            </button>
            {canApprove ? (
              <>
                <button type="button" className="btn primary compact" onClick={approveSelected}>
                  Aprobar
                </button>
                <button type="button" className="btn ghost compact" onClick={rejectSelected}>
                  Rechazar
                </button>
              </>
            ) : null}
          </div>
        ) : null}
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
        <ColumnPicker
          columns={pickerColumns}
          visibleCols={visibleCols}
          onToggle={(id) => toggleColumn(id as ColId)}
        />
      </div>

      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-filters">
              {activeCols.map((col) => (
                <th key={col.id}>{renderFilter(col.id)}</th>
              ))}
              <th>
                <div className="col-tools">
                  <button type="button" className="grid-tool" title="Buscar" onClick={search}>
                    <SearchIcon size={14} />
                  </button>
                  <button type="button" className="grid-tool" title="Limpiar" onClick={clear}>
                    <CloseIcon />
                  </button>
                  <input
                    className="check"
                    type="checkbox"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? [] : visible.map((row) => row.ref))}
                    title="Seleccionar todos"
                  />
                </div>
              </th>
            </tr>
            <tr className="col-titles">
              {activeCols.map((col) => (
                <th key={col.id} className={col.id === "pending" ? "right" : undefined}>
                  {col.label}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={activeCols.length + 1}>No hay clientes con esos filtros</td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={row.ref}
                  className={isRevision ? "client-review-row" : "clickable"}
                  onClick={isRevision ? undefined : () => onOpen(row.ref)}
                >
                  {activeCols.map((col) => (
                    <td
                      key={col.id}
                      className={col.id === "pending" ? "money right" : undefined}
                      onClick={isRevision ? undefined : () => onOpen(row.ref)}
                      role={isRevision ? undefined : "button"}
                    >
                      {renderCell(row, col.id)}
                    </td>
                  ))}
                  <td>
                    <input
                      className="check"
                      type="checkbox"
                      checked={selected.includes(row.ref)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(row.ref) ? current.filter((id) => id !== row.ref) : [...current, row.ref],
                        )
                      }
                    />
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
