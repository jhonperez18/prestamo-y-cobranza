"use client";

/**
 * Informe mensual del supervisor (rutas M · T · N; A lleva dinero aparte y no entra).
 * Cartera = saldo por cobrar de préstamos activos por ruta del cliente.
 * Efectivo = caja del libro del día; T ya trae el saldo de M (cadena), por eso
 * el total es T + N y no suma M otra vez.
 */
import { useMemo, useState } from "react";
import { sameRoute } from "@/lib/client-route-order";
import { isoToDisplay } from "@/lib/loan-preview";
import {
  INFORME_HISTORY_ROUTES,
  type InformeHistory,
  type InformeHistoryKind,
} from "@/lib/informe-route-days";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { portfolioBalanceForClients } from "@/lib/portfolio-stats";

export type InformeEfectivo = { t: number; n: number };

type Props = {
  loans: LoanRow[];
  clients: ClientRow[];
  payments: PaymentRow[];
  efectivo: InformeEfectivo;
  banco: number;
  corteLabel: string;
  /** Historial diario por ruta desde el día 1 del mes (Cobrado / Préstamo / Gasto). `null` = calculando. */
  history: InformeHistory | null;
};

const HISTORY_BUTTONS: { kind: InformeHistoryKind; label: string }[] = [
  { kind: "cobrado", label: "Cobrado" },
  { kind: "prestamo", label: "Préstamo" },
  { kind: "gasto", label: "Gasto" },
];

type ReportRow =
  | { kind: "section"; label: string }
  | { kind: "line"; label: string; value: number; tone?: "sub" | "total" | "grand" };

const INFORME_ROUTES = ["M", "T", "N"] as const;

function carteraOfRoute(
  route: string,
  loans: LoanRow[],
  clients: ClientRow[],
  payments: PaymentRow[],
) {
  const refs = new Set(
    clients.filter((row) => sameRoute(row.route, route)).map((row) => row.ref),
  );
  return portfolioBalanceForClients(loans, payments, refs);
}

export function SupervisorMonthlyReport({
  loans,
  clients,
  payments,
  efectivo,
  banco,
  corteLabel,
  history,
}: Props) {
  const [openKind, setOpenKind] = useState<InformeHistoryKind | null>(null);
  const rows = useMemo((): ReportRow[] => {
    const cartera = INFORME_ROUTES.map((route) => ({
      route,
      value: carteraOfRoute(route, loans, clients, payments),
    }));
    const carteraTotal = cartera.reduce((sum, row) => sum + row.value, 0);
    const efectivoTotal = efectivo.t + efectivo.n;
    return [
      { kind: "section", label: "Cartera" },
      ...cartera.map(
        (row): ReportRow => ({ kind: "line", label: row.route, value: row.value, tone: "sub" }),
      ),
      { kind: "line", label: "Total cartera", value: carteraTotal, tone: "total" },
      { kind: "section", label: "Efectivo" },
      { kind: "line", label: "T (saldo final, incluye M)", value: efectivo.t, tone: "sub" },
      { kind: "line", label: "N", value: efectivo.n, tone: "sub" },
      { kind: "line", label: "Total efectivo (T + N)", value: efectivoTotal, tone: "total" },
      { kind: "section", label: "Banco" },
      { kind: "line", label: "Banco", value: banco, tone: "total" },
      { kind: "section", label: "Gran total" },
      {
        kind: "line",
        label: "Cartera + efectivo + banco",
        value: carteraTotal + efectivoTotal + banco,
        tone: "grand",
      },
    ];
  }, [loans, clients, payments, efectivo, banco]);

  return (
    <div className="supervisor-informe">
      <header className="supervisor-informe-head">
        <h3>Informe mensual</h3>
        <p>Rutas M · T · N · corte {corteLabel}</p>
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
                {INFORME_HISTORY_ROUTES.map((route) => (
                  <th key={route} className="is-num">
                    {route}
                  </th>
                ))}
                <th className="is-num is-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {!history || history[openKind].days.length === 0 ? (
                <tr>
                  <td colSpan={INFORME_HISTORY_ROUTES.length + 2} className="is-empty">
                    {history ? "Sin movimientos este mes." : "Calculando…"}
                  </td>
                </tr>
              ) : (
                history[openKind].days.map((day) => (
                  <tr key={day.date}>
                    <td className="is-dia">{isoToDisplay(day.date).slice(0, 5)}</td>
                    {INFORME_HISTORY_ROUTES.map((route) => (
                      <td key={route} className="is-num">
                        {money(day[route], { symbol: false })}
                      </td>
                    ))}
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
