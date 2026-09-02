import type { ReactNode } from "react";
import type { StatusKind } from "@/lib/mock-data";
import type { KpiTone } from "@/lib/kpi-tones";
import { PlusIcon, SearchIcon } from "@/components/icons";
import { monthStartIso, todayIso } from "@/lib/daily-dispatch";

export function Pill({ label, kind }: { label: string; kind: StatusKind }) {
  return <span className={`pill ${kind}`}>{label}</span>;
}

type Header = { t: string; right?: boolean; center?: boolean; width?: string; sortKey?: string };

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
}) {
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
        {toolbarEnd}
      </div>
      <div className="filters">
        <select defaultValue="Todos los cobradores">
          <option>Todos los cobradores</option>
          <option>Juan Ríos</option>
          <option>Lina Soto</option>
        </select>
        <select defaultValue="Todas las rutas">
          <option>Todas las rutas</option>
          <option>Norte</option>
          <option>Sur</option>
        </select>
        <input type="date" defaultValue={monthStartIso()} />
        <input type="date" defaultValue={todayIso()} />
        <input placeholder="Buscar…" />
        <button className="go" type="button">
          <SearchIcon size={15} />
        </button>
      </div>
      <div className="table-wrap">
        <table className={fixedColumns ? "data cols-fixed" : "data"}>
          {fixedColumns ? (
            <colgroup>
              {headers.map((header) => (
                <col key={header.t} style={header.width ? { width: header.width } : undefined} />
              ))}
            </colgroup>
          ) : null}
          <thead>
            <tr>
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

                return (
                  <th key={header.t} className={className || undefined} aria-sort={ariaSort}>
                    {header.sortKey && onSort ? (
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
                    )}
                  </th>
                );
              })}
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
}: {
  label: string;
  value: string;
  hint: string;
  tone?: KpiTone;
  onClick?: () => void;
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
      <button type="button" className={`${className} kpi-clickable`} onClick={onClick}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}
