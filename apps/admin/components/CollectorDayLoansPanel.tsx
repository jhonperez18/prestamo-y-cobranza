"use client";

import { money } from "@/lib/mock-data";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";

type Props = {
  dateLabel: string;
  rows: DayLoanDisbursementRow[];
  total: number;
  onBack: () => void;
};

/** Detalle del KPI Préstamos: a quién, capital y cuota. */
export function CollectorDayLoansPanel({ dateLabel, rows, total, onBack }: Props) {
  return (
    <section className="collector-day-loans-panel" aria-label={`Préstamos ${dateLabel}`}>
      <div className="collector-day-loans-panel-head">
        <div>
          <h2>Préstamos del día</h2>
          <p>{dateLabel}</p>
        </div>
        <button type="button" className="collector-mobile-pay-link is-back" onClick={onBack}>
          volver
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="collector-day-loans-empty">Aún no hay préstamos en esta ruta hoy.</p>
      ) : (
        <>
          <div className="collector-day-loans-head">
            <span>Cliente</span>
            <span>Capital</span>
            <span>Cuota</span>
          </div>
          <ul className="collector-day-loans-list">
            {rows.map((row) => (
              <li key={row.loanRef}>
                <span className="is-name" title={row.clientName}>
                  {row.clientName}
                </span>
                <b className="is-capital">{money(row.capital, { symbol: false })}</b>
                <span className="is-cuota">{money(row.installment, { symbol: false })}</span>
              </li>
            ))}
            <li className="is-total">
              <span>Total prestado</span>
              <b>{money(total, { symbol: false })}</b>
              <span aria-hidden />
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
