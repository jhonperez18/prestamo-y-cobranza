import type { ReactNode } from "react";
import type { StatusKind } from "@/lib/mock-data";
import type { KpiTone } from "@/lib/kpi-tones";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { monthStartIso, todayIso } from "@/lib/daily-dispatch";

export function Pill({ label, kind }: { label: string; kind: StatusKind }) {
  return <span className={`pill ${kind}`}>{label}</span>;
}

type Header = { t: string; right?: boolean; center?: boolean; width?: string; sortKey?: string };

export type DataTableFilterOptions = {
  collectors?: { ref: string; name: string }[];
  routes?: string[];
  collectorRef?: string;
  routeName?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
  onCollectorChange?: (value: string) => void;
  onRouteChange?: (value: string) => void;
  onDateFromChange?: (value: string) => void;
  onDateToChange?: (value: string) => void;
  onQueryChange?: (value: string) => void;
};

export function DataTable({
  title,
  count,
  headers,
  onCreate,
  children,
  fixedColumns,
  sortKey,
  sortDir,
  onSort,
  toolbarEnd,
  showFilters = true,
  filterOptions,
}: {
  title: string;
  count: string | number;
  headers: Header[];
  onCreate?: () => void;
  children: ReactNode;
  fixedColumns?: boolean;
  sortKey?: string | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  toolbarEnd?: ReactNode;
  showFilters?: boolean;
  filterOptions?: DataTableFilterOptions;
}) {
  const collectors = filterOptions?.collectors ?? [];
  const routes = filterOptions?.routes ?? [];
  const collectorRef = filterOptions?.collectorRef ?? "";
  const routeName = filterOptions?.routeName ?? "";
  const dateFrom = filterOptions?.dateFrom ?? monthStartIso();
  const dateTo = filterOptions?.dateTo ?? todayIso();
  const query = filterOptions?.query ?? "";

  return (
    <section className="panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{count}</span>
        <div className="grow" />
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        {onCreate ? (
          <button className="plus" title="Crear" onClick={onCreate}>
            <PlusIcon />
          </button>
        ) : null}
      </div>
      {showFilters ? (
        <div className="filters">
          <select
            value={collectorRef}
            onChange={(event) => filterOptions?.onCollectorChange?.(event.target.value)}
            aria-label="Filtrar por cobrador"
          >
            <option value="">Todos los cobradores</option>
            {collectors.map((row) => (
              <option key={row.ref} value={row.ref}>
                {row.name}
              </option>
            ))}
          </select>
          <select
            value={routeName}
            onChange={(event) => filterOptions?.onRouteChange?.(event.target.value)}
            aria-label="Filtrar por ruta"
          >
            <option value="">Todas las rutas</option>
            {routes.map((name) => (
              <option key={name} value={name}>
                Ruta {name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => filterOptions?.onDateFromChange?.(event.target.value)}
            aria-label="Desde"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => filterOptions?.onDateToChange?.(event.target.value)}
            aria-label="Hasta"
          />
          <input
            placeholder="Buscar…"
            value={query}
            onChange={(event) => filterOptions?.onQueryChange?.(event.target.value)}
            aria-label="Buscar"
          />
          <button className="go" type="button" aria-label="Buscar">
            <SearchIcon size={15} />
          </button>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className={fixedColumns ? "data cols-fixed" : "data"}>
          {fixedColumns ? (
            <colgroup>
              {headers.map((header) => (
                <col key={header.t} style={header.width ? { width: header.width } : undefined} />
              ))}
              {toolbarEnd ? <col className="col-picker-spacer" /> : null}
            </colgroup>
          ) : null}
          <thead>
            <tr className={toolbarEnd ? "col-titles" : undefined}>
              {headers.map((header) => {
                const active = Boolean(header.sortKey && sortKey === header.sortKey);
                const ariaSort = active
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined;
                const className = [
                  header.center ? "center" : header.right ? "right" : undefined,
                  header.sortKey && onSort ? "sortable" : undefined,
                  active ? "sorted" : undefined,
                ]
                  .filter(Boolean)
                  .join(" ");

                const label =
                  header.sortKey && onSort ? (
                    <button
                      type="button"
                      className="th-sort"
                      onClick={() => onSort(header.sortKey!)}
                    >
                      <span className="th-sort-arrow" aria-hidden>
                        {active ? (sortDir === "asc" ? "▲" : "▼") : "▲"}
                      </span>
                      {header.t}
                    </button>
                  ) : (
                    header.t
                  );

                return (
                  <th key={header.t} className={className || undefined} aria-sort={ariaSort}>
                    {label}
                  </th>
                );
              })}
              {toolbarEnd ? <th className="col-picker-cell">{toolbarEnd}</th> : null}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: KpiTone;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = tone ? `kpi kpi-${tone}` : "kpi";
  const body = (
    <>
      <s>{label}</s>
      <b>{value}</b>
      <em>{hint}</em>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} kpi-clickable${active ? " kpi-active" : ""}`}
        onClick={onClick}
        aria-pressed={active}
      >
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}
