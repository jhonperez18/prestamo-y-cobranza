"use client";

/**
 * Informe de una planilla con caja propia (A · Angélica), mismo formato que el general.
 * Cartera = saldo por cobrar de préstamos activos de clientes de la ruta.
 * Efectivo = caja propia del día (`independentRouteDay`, la misma cifra de su tarjeta).
 * Nequi = total acumulado NEQUI (`digitalPoolBalances`): A cobra por Nequi, no por Banco.
 */
import { useMemo, useState } from "react";
import { sameRoute } from "@/lib/client-route-order";
import { isoToDisplay } from "@/lib/loan-preview";
import type { InformeHistoryKind, InformeRouteHistory } from "@/lib/informe-route-days";
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
}: Props) {
  const [openKind, setOpenKind] = useState<InformeHistoryKind | null>(null);
  const rows = useMemo((): ReportRow[] => {
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

  return (
    <div className="supervisor-informe">
      <header className="supervisor-informe-head">
        <h3>Informe mensual</h3>
        <p>
          Ruta {route} · corte {corteLabel}
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
            onClick={() => setOpenKind((prev) => (prev === kind ? null : kind))}
          >
            <span>{label}</span>
            <b>{history ? money(history[kind].total, { symbol: false }) : "…"}</b>
          </button>
        ))}
      </div>
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
              {!history || history[openKind].days.length === 0 ? (
                <tr>
                  <td colSpan={2} className="is-empty">
                    {history ? "Sin movimientos este mes." : "Calculando…"}
                  </td>
                </tr>
              ) : (
                history[openKind].days.map((day) => (
                  <tr key={day.date}>
                    <td className="is-dia">{isoToDisplay(day.date).slice(0, 5)}</td>
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
