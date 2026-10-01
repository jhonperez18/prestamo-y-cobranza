"use client";

/**
 * Informe mensual del supervisor (rutas M · T · N; A lleva dinero aparte y no entra).
 * Cartera = saldo por cobrar de préstamos activos por ruta del cliente.
 * Efectivo = caja del libro del día; T ya trae el saldo de M (cadena), por eso
 * el total es T + N y no suma M otra vez.
 */
import { useMemo } from "react";
import { sameRoute } from "@/lib/client-route-order";
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
};

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
}: Props) {
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
    </div>
  );
}
