"use client";

/**
 * Informe de una planilla con caja propia (A · Angélica), mismo formato que el general.
 * Cartera = saldo por cobrar de préstamos activos de clientes de la ruta.
 * Efectivo = caja propia del día (`independentRouteDay`, la misma cifra de su tarjeta).
 * Nequi = total acumulado NEQUI (`digitalPoolBalances`): A cobra por Nequi, no por Banco.
 */
import { useMemo, useState } from "react";
import { sameRoute } from "@/lib/client-route-order";
import type { DigitalPoolGasto } from "@/lib/digital-pools";
import type { InformeHistoryKind, InformeRouteHistory } from "@/lib/informe-route-days";
import type { InformeMonthSnapshot } from "@/lib/informe-month-snapshot";
import { informePeriodName } from "@/lib/informe-month-snapshot";
import { isoToDisplay } from "@/lib/loan-preview";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { portfolioBalanceForClients } from "@/lib/portfolio-stats";

type Props = {
  route: string;
  loans: LoanRow[];
  clients: ClientRow[];
  payments: PaymentRow[];
  efectivo: number;
  nequi: number;
  corteLabel: string;
  /** Historial diario de la ruta desde el día 1 del mes. `null` = calculando. */
  history: InformeRouteHistory | null;
  /** Misma lista que Nequi → Gastos. No entra a la caja ni al Inicial. */
  nequiGastos: readonly DigitalPoolGasto[];
  nequiGastado: number;
  /** Mes ya cerrado. Si viene, la pantalla lee esta copia y no recalcula. */
  snapshot?: InformeMonthSnapshot | null;
};

const HISTORY_BUTTONS: { kind: InformeHistoryKind; label: string }[] = [
  { kind: "cobrado", label: "Cobrado" },
  { kind: "prestamo", label: "Préstamo" },
  { kind: "gasto", label: "Gasto" },
];

type ReportRow =
  | { kind: "section"; label: string }
  | { kind: "line"; label: string; value: number; tone?: "sub" | "total" | "grand" };

export function SupervisorOwnRouteReport({
  route,
  loans,
  clients,
  payments,
  efectivo,
  nequi,
  corteLabel,
  history,
  nequiGastos,
  nequiGastado,
  snapshot = null,
}: Props) {
  const frozen = snapshot?.scope === "angelica" ? snapshot : null;
  const [openKind, setOpenKind] = useState<InformeHistoryKind | null>(null);
  const [nequiGastosOpen, setNequiGastosOpen] = useState(false);
  const liveRows = useMemo((): ReportRow[] => {
    const refs = new Set(clients.filter((row) => sameRoute(row.route, route)).map((row) => row.ref));
    const cartera = portfolioBalanceForClients(loans, payments, refs);
    return [
      { kind: "section", label: "Cartera" },
      { kind: "line", label: route, value: cartera, tone: "sub" },
      { kind: "line", label: "Total cartera", value: cartera, tone: "total" },
      { kind: "section", label: "Efectivo" },
      { kind: "line", label: `${route} (saldo final)`, value: efectivo, tone: "sub" },
      { kind: "line", label: "Total efectivo", value: efectivo, tone: "total" },
      { kind: "section", label: "Nequi" },
      { kind: "line", label: "Nequi", value: nequi, tone: "total" },
      { kind: "section", label: "Gran total" },
      { kind: "line", label: "Cartera + efectivo + nequi", value: cartera + efectivo + nequi, tone: "grand" },
    ];
  }, [route, loans, clients, payments, efectivo, nequi]);
  const rows: ReportRow[] = frozen ? (frozen.rows as ReportRow[]) : liveRows;
  const shownHistory = frozen ? (frozen.history as InformeRouteHistory) : history;
  const shownGastos = frozen ? frozen.poolGastos : nequiGastos;
  const shownGastado = frozen ? frozen.poolGastado : nequiGastado;
  const shownCorte = frozen ? frozen.corteLabel : corteLabel;

  return (
    <div className="supervisor-informe">
      <header className="supervisor-informe-head">
        <h3>Informe mensual</h3>
        <p>
          {frozen
            ? `Ruta ${route} · ${informePeriodName(frozen.period)} · cierre ${shownCorte}`
            : `Ruta ${route} · corte ${shownCorte}`}
        </p>
      </header>
      <div className="supervisor-liq-wrap">
        <table className="supervisor-liq-table is-informe">
          <thead>
            <tr>
              <th className="is-detalle">Detalle</th>
              <th className="is-num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) =>
              row.kind === "section" ? (
                <tr key={`s-${row.label}`} className="is-informe-section">
                  <td colSpan={2}>{row.label}</td>
                </tr>
              ) : (
                <tr key={`l-${index}`} className={row.tone ? `is-${row.tone}` : undefined}>
                  <td className="is-detalle">{row.label}</td>
                  <td className="is-num">{money(row.value, { symbol: false })}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <div className="supervisor-informe-history-btns">
        {HISTORY_BUTTONS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            className={`supervisor-informe-history-btn is-${kind}${openKind === kind ? " on" : ""}`}
            aria-expanded={openKind === kind}
            onClick={() => {
              setNequiGastosOpen(false);
              setOpenKind((prev) => (prev === kind ? null : kind));
            }}
          >
            <span>{label}</span>
            <b>{shownHistory ? money(shownHistory[kind].total, { symbol: false }) : "…"}</b>
          </button>
        ))}
        <button
          type="button"
          className={`supervisor-informe-history-btn is-gasto-nequi${nequiGastosOpen ? " on" : ""}`}
          aria-expanded={nequiGastosOpen}
          onClick={() => {
            setOpenKind(null);
            setNequiGastosOpen((prev) => !prev);
          }}
        >
          <span>Gasto nequi</span>
          <b>{money(shownGastado, { symbol: false })}</b>
        </button>
      </div>
      {nequiGastosOpen ? (
        shownGastos.length === 0 ? (
          <p className="ficha-empty">Sin gastos pagados desde Nequi este mes.</p>
        ) : (
          <div className="supervisor-banco-hist">
            <div className="supervisor-banco-gastos-head" aria-hidden>
              <span>Fecha</span>
              <span>Concepto</span>
              <span>Valor</span>
            </div>
            <ul className="supervisor-banco-gastos-list" aria-label="Gastos pagados desde Nequi">
              {shownGastos.map((row) => (
                <li key={row.ref}>
                  <span className="is-date">{isoToDisplay(row.date)}</span>
                  <span className="is-label">{row.label}</span>
                  <span className="is-amount">{money(row.amount, { symbol: false })}</span>
                </li>
              ))}
            </ul>
            <div className="supervisor-banco-gastos-total">
              <span>Total gastado</span>
              <b>{money(shownGastado, { symbol: false })}</b>
            </div>
          </div>
        )
      ) : null}
      {openKind ? (
        <div className="supervisor-liq-wrap">
          <table className="supervisor-liq-table is-informe-days">
            <thead>
              <tr>
                <th className="is-dia">Día</th>
                <th className="is-num is-total">{route}</th>
              </tr>
            </thead>
            <tbody>
              {!shownHistory || shownHistory[openKind].days.length === 0 ? (
                <tr>
                  <td colSpan={2} className="is-empty">
                    {shownHistory ? "Sin movimientos este mes." : "Calculando…"}
                  </td>
                </tr>
              ) : (
                shownHistory[openKind].days.map((day) => (
                  <tr key={day.date}>
                    <td className="is-dia">{day.date.slice(8, 10)}</td>
                    <td className="is-num is-total">{money(day.total, { symbol: false })}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
