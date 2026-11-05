"use client";

import { money } from "@/lib/mock-data";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";

type Props = {
  dateLabel: string;
  /** Préstamos en efectivo: salen de la caja del cobrador / de la ruta. */
  rows: DayLoanDisbursementRow[];
  total: number;
  /**
   * Reservado (compat). Banco / Nequi ya no se listan aquí: viven en BANCO / NEQUI.
   * El cobrador solo ve la cuota cuando toque cobrar.
   */
  digitalRows?: DayLoanDisbursementRow[];
  digitalTotal?: number;
  digitalLabel?: string;
};

/** Detalle del KPI Préstamos de la ruta: solo efectivo (caja). */
export function CollectorDayLoansPanel({ dateLabel, rows, total }: Props) {
  return (
    <section className="collector-day-loans-panel" aria-label={`Préstamos ${dateLabel}`}>
      {rows.length === 0 ? (
        <p className="collector-day-loans-empty">
          Aún no hay préstamos en efectivo en esta ruta hoy.
        </p>
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
                <span
                  className="is-name"
                  title={
                    row.topUp ? `Anexo ${row.loanRef}: entregar hoy al cliente` : row.clientName
                  }
                >
                  {row.topUp ? `${row.clientName} · Anexo` : row.clientName}
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
