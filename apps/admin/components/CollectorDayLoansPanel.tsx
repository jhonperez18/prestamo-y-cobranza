"use client";

import { useState } from "react";
import { money } from "@/lib/mock-data";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";

type Props = {
  dateLabel: string;
  /** Préstamos en efectivo: salen de la caja del cobrador. */
  rows: DayLoanDisbursementRow[];
  total: number;
  /** Préstamos Banco / Nequi del supervisor: solo reporte, no restan de la caja. */
  digitalRows: DayLoanDisbursementRow[];
  digitalTotal: number;
  /** «Banco» (M / T / N) o «Nequi» (A). */
  digitalLabel: string;
};

type Tab = "efectivo" | "digital";

/** Detalle del KPI Préstamos: Efectivo (caja) y Banco / Nequi (reporte), a quién, capital y cuota. */
export function CollectorDayLoansPanel({
  dateLabel,
  rows,
  total,
  digitalRows,
  digitalTotal,
  digitalLabel,
}: Props) {
  const [tab, setTab] = useState<Tab>("efectivo");
  const shown = tab === "efectivo" ? rows : digitalRows;
  const shownTotal = tab === "efectivo" ? total : digitalTotal;
  return (
    <section className="collector-day-loans-panel" aria-label={`Préstamos ${dateLabel}`}>
      <div className="collector-day-loans-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "efectivo"}
          className={tab === "efectivo" ? "on" : undefined}
          title="Préstamos con plata de la caja (se restan de la caja)"
          onClick={() => setTab("efectivo")}
        >
          <span>Efectivo</span>
          <b>{money(total, { symbol: false })}</b>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "digital"}
          className={tab === "digital" ? "on" : undefined}
          title={`Préstamos por ${digitalLabel} del supervisor (no se restan de la caja)`}
          onClick={() => setTab("digital")}
        >
          <span>{digitalLabel}</span>
          <b>{money(digitalTotal, { symbol: false })}</b>
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="collector-day-loans-empty">
          {tab === "efectivo"
            ? "Aún no hay préstamos en efectivo en esta ruta hoy."
            : `Aún no hay préstamos por ${digitalLabel} en esta ruta hoy.`}
        </p>
      ) : (
        <>
          <div className="collector-day-loans-head">
            <span>Cliente</span>
            <span>Capital</span>
            <span>Cuota</span>
          </div>
          <ul className="collector-day-loans-list">
            {shown.map((row) => (
              <li key={row.loanRef}>
                <span
                  className="is-name"
                  title={row.topUp ? `Anexo ${row.loanRef}: entregar hoy al cliente` : row.clientName}
                >
                  {row.topUp ? `${row.clientName} · Anexo` : row.clientName}
                </span>
                <b className="is-capital">{money(row.capital, { symbol: false })}</b>
                <span className="is-cuota">{money(row.installment, { symbol: false })}</span>
              </li>
            ))}
            <li className="is-total">
              <span>{tab === "efectivo" ? "Total prestado" : `Total ${digitalLabel}`}</span>
              <b>{money(shownTotal, { symbol: false })}</b>
              <span aria-hidden />
            </li>
          </ul>
        </>
      )}
    </section>
  );
}
