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
import {
  ColumnPicker,
  ColumnPickerBodyCell,
  ColumnPickerHeadCell,
  useColumnVisibility,
} from "@/components/ColumnPicker";
import { money, ROUTES, type ClientRow } from "@/lib/mock-data";
import { clientStatusKind } from "@/lib/client-review";
import {
  compareClientsByRoutePosition,
  routeBlockStarts,
  sameRoute,
} from "@/lib/client-route-order";
import { clientNeedsProfileCompletion } from "@/lib/profile-pending";
import { Pill } from "@/components/ui";

export const CLIENT_COLUMNS = [
  { id: "ref", label: "Código" },
  { id: "alta", label: "Fecha creación" },
  { id: "routeOrder", label: "#" },
  { id: "name", label: "Nombre" },
  { id: "nickname", label: "Apodo" },
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

/**
 * Vista organizada del listado (la que ya se había dejado):
 * # · Nombre · Apodo · Documento. El resto se enciende con el picker.
 */
const DEFAULT_COLS: ColId[] = ["routeOrder", "name", "nickname", "document"];
const REVISION_COLS: ColId[] = ["name", "nickname", "document", "phone", "address", "city"];
/** Preferencias de columnas del listado (no de revisión). */
const STORAGE_KEY = "nexo.clientes.columns.v4";

/** Migración v2/v3 → v4. Garantiza la columna # si el listado quedó sin ella. */
function migrateClientColumnPrefs() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY)) return;

    const fromV3 = window.localStorage.getItem("nexo.clientes.columns.v3");
    const fromV2 = window.localStorage.getItem("nexo.clientes.columns.v2");
    const legacy = fromV3 || fromV2;
    if (!legacy) return;

    const parsed = JSON.parse(legacy) as unknown;
    if (!Array.isArray(parsed)) return;

    const migrated = parsed
      .map((id) => (id === "nick" ? "nickname" : String(id)))
      .filter((id) => CLIENT_COLUMNS.some((col) => col.id === id));

    // Si faltaba "#", la reinserta al frente (era parte de la vista organizada).
    if (migrated.includes("name") && !migrated.includes("routeOrder")) {
      migrated.unshift("routeOrder");
    }

    if (migrated.length) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
  } catch {
    /* ignore */
  }
}

type Filters = Record<ColId, string>;

const EMPTY_FILTERS = Object.fromEntries(CLIENT_COLUMNS.map((col) => [col.id, ""])) as Filters;

type Props = {
  title: string;
  count: string | number;
  rows: ClientRow[];
  variant?: "default" | "revision";
  clientView?: ClientListView;
  canApprove?: boolean;
  /**
   * Rutas del catálogo (Listado): botones «Ruta 1» / «Ruta 2».
   * Cada ruta tiene su propia # 1…N; separadas se organizan sin chocar.
   */
  routeTabs?: string[];
  onCreate: () => void;
  onOpen: (ref: string) => void;
  onApprove?: (refs: string[]) => void;
  onReject?: (refs: string[]) => void;
};

function sortRouteNames(names: string[]) {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

function matches(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function clientListDisplayName(row: ClientRow) {
  return `${row.name} ${row.lastName}`.trim();
}

function fieldOf(row: ClientRow, id: ColId) {
  if (id === "pending") return String(row.pending);
  if (id === "routeOrder") return String(row.routeOrder || "");
  if (id === "nickname") return row.nickname ?? "";
  if (id === "name") return clientListDisplayName(row);
  return String(row[id as keyof ClientRow] ?? "");
}

export function ClientList({
  title,
  count,
  rows,
  variant = "default",
  clientView = "listado",
  canApprove = false,
  routeTabs,
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

  // Botones de ruta: catálogo + cualquier ruta que aún tenga clientes.
  const routeNames = useMemo(
    () =>
      routeTabs
        ? sortRouteNames([...routeTabs, ...rows.map((row) => row.route || "")])
        : [],
    [routeTabs, rows],
  );
  const [routeTab, setRouteTab] = useState<string | null>(null);
  // Arranca en la primera ruta; si la ruta elegida desaparece, vuelve a la primera.
  const activeRoute =
    routeNames.length === 0
      ? null
      : routeTab === ""
        ? null
        : routeTab && routeNames.includes(routeTab)
          ? routeTab
          : routeNames[0] ?? null;
  const routeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const name of routeNames) {
      counts.set(name, rows.filter((row) => sameRoute(row.route, name)).length);
    }
    return counts;
  }, [routeNames, rows]);

  migrateClientColumnPrefs();

  const catalogColumns = useMemo(
    () =>
      CLIENT_COLUMNS.filter((col) => col.id !== "ref").map((col) => ({
        id: col.id,
        label: col.label,
      })),
    [],
  );

  const { visibleCols, toggleColumn } = useColumnVisibility(
    catalogColumns,
    isRevision ? [...REVISION_COLS] : [...DEFAULT_COLS],
    { storageKey: isRevision ? undefined : STORAGE_KEY },
  );

  const pickerColumns = useMemo(
    () => catalogColumns.filter((col) => !hideStatusColumn || col.id !== "status"),
    [catalogColumns, hideStatusColumn],
  );

  useEffect(() => {
    if (!hideStatusColumn) return;
    setFilters((current) => ({ ...current, status: "" }));
    setApplied((current) => ({ ...current, status: "" }));
  }, [hideStatusColumn]);

  const activeCols = CLIENT_COLUMNS.filter(
    (col) => visibleCols.includes(col.id) && (!hideStatusColumn || col.id !== "status"),
  );

  const visible = useMemo(() => {
    const onRoute = activeRoute ? rows.filter((row) => sameRoute(row.route, activeRoute)) : rows;
    const filtered = onRoute.filter((row) =>
      CLIENT_COLUMNS.every((col) => {
        const query = applied[col.id];
        if (!query) return true;
        if (col.id === "route" || col.id === "status") return fieldOf(row, col.id) === query;
        return matches(fieldOf(row, col.id), query);
      }),
    );
    // Orden sagrado = ruta + # (routeOrder). Misma ley en planilla/app/supervisor.
    return filtered.slice().sort(compareClientsByRoutePosition);
  }, [activeRoute, applied, rows]);
  /** Vista total: raya gris donde arranca cada ruta (1 → 1.1 → 2). */
  const routeStarts = useMemo(() => routeBlockStarts(visible, (row) => row.route), [visible]);

  function pickRoute(name: string) {
    // Volver a tocar la ruta activa muestra el total (ambas rutas, una tras otra).
    setRouteTab(activeRoute === name ? "" : name);
    setSelected([]);
  }

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
      const showCompletarBadge =
        clientNeedsProfileCompletion(row) && !visibleCols.includes("status");
      return (
        <span className="cell-with-ico">
          <PersonMiniIcon />
          {clientListDisplayName(row)}
          {showCompletarBadge ? <Pill label="Completar" kind="warn" /> : null}
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
    if (id === "routeOrder") return row.routeOrder || "—";
    if (id === "nickname") return row.nickname?.trim() || "—";
    if (id === "status") {
      if (clientNeedsProfileCompletion(row)) {
        return <Pill label="Completar" kind="warn" />;
      }
      return <Pill label={row.status} kind={clientStatusKind(row.status)} />;
    }
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
        {routeNames.length > 0 ? (
          <div className="client-route-tabs" role="group" aria-label="Filtrar por ruta">
            {routeNames.map((name) => (
              <button
                key={name}
                type="button"
                className={`client-route-tab${activeRoute === name ? " on" : ""}`}
                aria-pressed={activeRoute === name}
                onClick={() => pickRoute(name)}
              >
                Ruta {name}
                <span className="client-route-tab-count">{routeCounts.get(name) ?? 0}</span>
              </button>
            ))}
          </div>
        ) : null}
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
                  {isRevision ? (
                    <input
                      className="check"
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? [] : visible.map((row) => row.ref))}
                      title="Seleccionar todos"
                    />
                  ) : null}
                </div>
              </th>
            </tr>
            <tr className="col-titles">
              {activeCols.map((col) => (
                <th key={col.id} className={col.id === "pending" ? "right" : col.id === "name" ? "is-nombre" : undefined}>
                  {col.label}
                </th>
              ))}
              <ColumnPickerHeadCell>
                <ColumnPicker
                  columns={pickerColumns}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </ColumnPickerHeadCell>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={activeCols.length + 1}>No hay clientes con esos filtros</td>
              </tr>
            ) : (
              visible.map((row, index) => {
                const incomplete = clientNeedsProfileCompletion(row);
                const rowClass = [
                  isRevision ? "client-review-row" : "clickable",
                  incomplete ? "is-profile-incomplete" : "",
                  routeStarts[index] ? "is-route-start" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                <tr
                  key={row.ref}
                  className={rowClass}
                  title={incomplete ? "Ficha incompleta (alta en calle) — completar en oficina" : undefined}
                  onClick={isRevision ? undefined : () => onOpen(row.ref)}
                >
                  {activeCols.map((col) => (
                    <td
                      key={col.id}
                      className={
                        col.id === "pending"
                          ? "money right"
                          : col.id === "name"
                            ? "is-nombre"
                            : undefined
                      }
                      onClick={isRevision ? undefined : () => onOpen(row.ref)}
                      role={isRevision ? undefined : "button"}
                    >
                      {renderCell(row, col.id)}
                    </td>
                  ))}
                  {isRevision ? (
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
                  ) : (
                    <ColumnPickerBodyCell />
                  )}
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
