"use client";

import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { routeBlockStarts } from "@/lib/client-route-order";
import {
  historyMethodLabel,
  type CollectorHistoryPlanillaRow,
} from "@/lib/collector-history-planilla";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { money } from "@/lib/mock-data";

type Props = {
  dateLabel: string;
  planillaRows: CollectorHistoryPlanillaRow[];
  prestamos: RouteExpenseLine[];
  prestamosTotal: number;
  otrosGastos?: RouteExpenseLine[];
  otrosTotal?: number;
  /** Búsqueda opcional (cobrador en inicio). */
  searchOpen?: boolean;
  searchQuery?: string;
  onToggleSearch?: () => void;
  onSearchChange?: (value: string) => void;
};

/**
 * Debajo del saldo del cierre: préstamos nuevos (aparte) + planilla del día.
 * Misma vista para cobrador (inicio) y supervisor (historial → día).
 */
export function CollectorDayCloseExtras({
  dateLabel,
  planillaRows,
  prestamos,
  prestamosTotal,
  otrosGastos = [],
  otrosTotal = 0,
  searchOpen = false,
  searchQuery = "",
  onToggleSearch,
  onSearchChange,
}: Props) {
  const queryNorm = searchQuery.trim().toLocaleLowerCase("es");
  const visibleRows =
    searchOpen && queryNorm
      ? planillaRows.filter((row) => {
          const name = row.name.toLocaleLowerCase("es");
          return name.includes(queryNorm) || String(row.order ?? "").includes(queryNorm);
        })
      : planillaRows;
  const routeStarts = routeBlockStarts(visibleRows, (row) => row.route);

  return (
    <>
      {prestamos.length > 0 ? (
        <div className="collector-history-loans" aria-label={`Préstamos nuevos ${dateLabel}`}>
          <p className="collector-history-loans-title">
            <strong>Préstamos nuevos</strong>
            <span>{money(prestamosTotal, { symbol: false })}</span>
          </p>
          <ul>
            {prestamos.map((line) => (
              <li key={`${line.id}:${line.loanRef || line.label}`}>
                <span className="is-name">{line.label}</span>
                <b className="is-amount">{money(line.amount, { symbol: false })}</b>
              </li>
            ))}
          </ul>
          <p className="collector-history-loans-note">
            Sale de caja del cobrador · va aparte del gasto operativo
          </p>
        </div>
      ) : null}

      {otrosGastos.length > 0 ? (
        <div className="collector-history-loans is-otros" aria-label={`Otros gastos ${dateLabel}`}>
          <p className="collector-history-loans-title">
            <strong>Otros gastos</strong>
            <span>{money(otrosTotal, { symbol: false })}</span>
          </p>
          <ul>
            {otrosGastos.map((line) => (
              <li key={`${line.id}:${line.label}`}>
                <span className="is-name">{line.label}</span>
                <b className="is-amount">{money(line.amount, { symbol: false })}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {planillaRows.length > 0 ? (
        <div className="collector-history-planilla" aria-label={`Planilla ${dateLabel}`}>
          <p className="collector-history-planilla-title">
            <strong>Planilla {dateLabel}</strong>
            {onToggleSearch ? (
              <button
                type="button"
                className={
                  searchOpen
                    ? "collector-history-planilla-search on"
                    : "collector-history-planilla-search"
                }
                aria-label="Buscar cliente"
                aria-expanded={searchOpen}
                onClick={onToggleSearch}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle
                    cx="10.5"
                    cy="10.5"
                    r="6.25"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M15.2 15.2 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : null}
          </p>
          {searchOpen && onSearchChange ? (
            <input
              className="collector-history-planilla-query"
              type="search"
              value={searchQuery}
              placeholder="Buscar cliente"
              aria-label="Buscar cliente en la planilla"
              autoFocus
              onChange={(event) => onSearchChange(event.target.value)}
            />
          ) : null}
          <div className="collector-history-planilla-head">
            <span>#</span>
            <span>Nombre</span>
            <span>Cuota</span>
            <span>Hora</span>
            <span>Foto</span>
            <span>Método</span>
          </div>
          <ul>
            {visibleRows.length === 0 ? (
              <li className="is-empty-search">Sin coincidencias</li>
            ) : (
              visibleRows.map((row, index) => (
                <li
                  key={row.key}
                  className={[
                    row.method === "vacio" ? "is-vacio" : "",
                    row.lentToday || row.method === "prestamo" ? "is-lent" : "",
                    routeStarts[index] ? "is-route-start" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  <span className="is-ord">{row.order ?? "—"}</span>
                  <span className="is-name">{row.name}</span>
                  <span className="is-cuota">
                    {row.amount == null ? "—" : money(row.amount, { symbol: false })}
                  </span>
                  <span className="is-time">{row.time}</span>
                  <span className="is-photo">
                    {row.evidence.length > 0 ? (
                      <PaymentEvidenceThumb evidence={row.evidence} size={22} emptyLabel="—" />
                    ) : (
                      "—"
                    )}
                  </span>
                  <span
                    className={
                      row.method === "vacio"
                        ? "is-method"
                        : row.method === "prestamo"
                          ? "is-method is-pay-prestamo"
                          : `is-method is-pay-${row.method}`
                    }
                  >
                    {historyMethodLabel(row.method)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </>
  );
}
