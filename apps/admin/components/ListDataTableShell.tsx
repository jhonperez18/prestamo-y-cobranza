"use client";

import type { ReactNode } from "react";

export type ListTableColumn = {
  id: string;
  label: string;
  right?: boolean;
  center?: boolean;
};

type Props = {
  title: string;
  columns: ListTableColumn[];
  count?: number | string;
  emptyMessage?: string;
  badge?: ReactNode;
  toolbar?: ReactNode;
  /** Filas fantasma para mostrar el rayado intercalado aunque no haya datos. */
  ghostRows?: number;
};

/**
 * Plantilla de listado: ancho completo, columnas repartidas y filas intercaladas.
 * Usar en vistas nuevas y en pantallas «próx.» para fijar el formato desde ya.
 */
export function ListDataTableShell({
  title,
  columns,
  count = 0,
  emptyMessage = "Sin registros todavía.",
  badge,
  toolbar,
  ghostRows = 4,
}: Props) {
  const showGhost = ghostRows > 0 && Number(count) === 0;

  return (
    <section className="panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{count}</span>
        {badge}
        <div className="grow" />
        {toolbar}
      </div>
      <div className="table-wrap">
        <table className="data list-grid list-data-table">
          <thead>
            <tr className="col-titles">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={col.center ? "center" : col.right ? "right" : undefined}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showGhost ? (
              Array.from({ length: ghostRows }, (_, index) => (
                <tr key={`ghost-${index}`} className="list-data-ghost-row" aria-hidden>
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={col.center ? "center" : col.right ? "right" : undefined}
                    >
                      <span className="list-data-ghost-bar" />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr className="empty-row">
                <td colSpan={Math.max(columns.length, 1)}>{emptyMessage}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Columnas reservadas para vistas Cartera / Reportes aún no activas. */
export const CARTERA_POR_COBRADOR_COLUMNS: ListTableColumn[] = [
  { id: "collector", label: "Cobrador" },
  { id: "credits", label: "Créditos", center: true },
  { id: "onTime", label: "Al día", right: true },
  { id: "mora", label: "En mora", right: true },
  { id: "balance", label: "Saldo", right: true },
  { id: "collected", label: "Cobrado mes", right: true },
];

export const CARTERA_POR_RUTA_COLUMNS: ListTableColumn[] = [
  { id: "route", label: "Ruta" },
  { id: "credits", label: "Créditos", center: true },
  { id: "onTime", label: "Al día", right: true },
  { id: "mora", label: "En mora", right: true },
  { id: "balance", label: "Saldo", right: true },
  { id: "pending", label: "Por cobrar", right: true },
];

export const REPORTES_GENERIC_COLUMNS: ListTableColumn[] = [
  { id: "period", label: "Periodo" },
  { id: "detail", label: "Detalle" },
  { id: "count", label: "Registros", center: true },
  { id: "amount", label: "Total", right: true },
];
