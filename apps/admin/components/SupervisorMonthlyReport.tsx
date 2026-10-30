"use client";

/**
 * Informe mensual del supervisor (rutas M · T · N; A lleva dinero aparte y no entra).
 * Cartera = saldo por cobrar de préstamos activos por ruta del cliente.
 * Efectivo = caja del libro del día; T ya trae el saldo de M (cadena), por eso
 * el total es T + N y no suma M otra vez.
 */
import { useMemo, useState } from "react";
import { sameRoute } from "@/lib/client-route-order";
import type { DigitalPoolGasto } from "@/lib/digital-pools";
import {
  INFORME_HISTORY_ROUTES,
  informePrestamoSourceLabel,
  type InformeHistory,
  type InformeHistoryKind,
  type InformePrestamoLine,
} from "@/lib/informe-route-days";
import type { InformeMonthSnapshot } from "@/lib/informe-month-snapshot";
import { isoToDisplay } from "@/lib/loan-preview";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { portfolioBalanceForClients } from "@/lib/portfolio-stats";

export type InformeEfectivo = { t: number; n: number };

type Props = {
  loans: LoanRow[];
  clients: ClientRow[];
  payments: PaymentRow[];
  efectivo: InformeEfectivo;
  banco: number;
  /** Historial diario por ruta desde el día 1 del mes (Cobrado / Préstamo / Gasto). `null` = leyendo. */
  history: InformeHistory | null;
  /** Si la lectura falló. No se sustituye por otra suma. */
  historyNote?: string;
  /** Misma lista que Banco → Gastos. No entra a la caja ni al Inicial. */
  bancoGastos: readonly DigitalPoolGasto[];
  bancoGastado: number;
  /** Mes ya cerrado. Si viene, la pantalla lee esta copia y no recalcula. */
  snapshot?: InformeMonthSnapshot | null;
};

export function InformePrestamoLines({ lines }: { lines: readonly InformePrestamoLine[] }) {
  if (!lines.length) return null;
  return (
    <div className="supervisor-prestamo-lines">
      <div className="supervisor-prestamo-lines-head" aria-hidden>
        <span>Día</span>
        <span>Préstamo</span>
        <span>Valor</span>
      </div>
      <ul className="supervisor-prestamo-lines-list" aria-label="Préstamos del mes">
        {lines.map((row, index) => (
          <li key={`${row.date}|${row.route}|${row.ref}|${row.source}|${row.anexo ? "anexo" : "capital"}|${index}`}>
            <span className="is-date">{isoToDisplay(row.date)}</span>
            <span className="is-label">
              {row.anexo ? `Anexo · ${row.ref}` : row.ref}
              {row.name ? ` · ${row.name}` : ""}
              {` · ${row.route} · ${informePrestamoSourceLabel(row.source)}`}
            </span>
            <span className="is-amount">{money(row.capital, { symbol: false })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  history,
  historyNote = "",
  bancoGastos,
  bancoGastado,
  snapshot = null,
}: Props) {
  const frozen = snapshot?.scope === "general" ? snapshot : null;
  const [openKind, setOpenKind] = useState<InformeHistoryKind | null>(null);
  const [bancoGastosOpen, setBancoGastosOpen] = useState(false);
  const liveRows = useMemo((): ReportRow[] => {
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
  const rows: ReportRow[] = frozen ? (frozen.rows as ReportRow[]) : liveRows;
  const shownHistory = frozen ? (frozen.history as InformeHistory) : history;
  const shownGastos = frozen ? frozen.poolGastos : bancoGastos;
  const shownGastado = frozen ? frozen.poolGastado : bancoGastado;

  return (
    <div className="supervisor-informe">
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
              setBancoGastosOpen(false);
              setOpenKind((prev) => (prev === kind ? null : kind));
            }}
          >
            <span>{label}</span>
            <b>{shownHistory ? money(shownHistory[kind].total, { symbol: false }) : "…"}</b>
          </button>
        ))}
        <button
          type="button"
          className={`supervisor-informe-history-btn is-gasto-banco${bancoGastosOpen ? " on" : ""}`}
          aria-expanded={bancoGastosOpen}
          onClick={() => {
            setOpenKind(null);
            setBancoGastosOpen((prev) => !prev);
          }}
        >
          <span>Gasto banco</span>
          <b>{money(shownGastado, { symbol: false })}</b>
        </button>
      </div>
      {bancoGastosOpen ? (
        shownGastos.length === 0 ? (
          <p className="ficha-empty">Sin gastos pagados desde Banco este mes.</p>
        ) : (
          <div className="supervisor-banco-hist">
            <div className="supervisor-banco-gastos-head" aria-hidden>
              <span>Fecha</span>
              <span>Concepto</span>
              <span>Valor</span>
            </div>
            <ul className="supervisor-banco-gastos-list" aria-label="Gastos pagados desde Banco">
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
            <colgroup>
              <col className="is-dia" />
              {INFORME_HISTORY_ROUTES.map((route) => (
                <col key={route} className="is-route" />
              ))}
              <col className="is-total" />
            </colgroup>
            <thead>
              <tr>
                <th className="is-dia">Día</th>
                {INFORME_HISTORY_ROUTES.map((route) => (
                  <th key={route} className="is-num is-route">
                    {route}
                  </th>
                ))}
                <th className="is-num is-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {!shownHistory || shownHistory[openKind].days.length === 0 ? (
                <tr>
                  <td colSpan={INFORME_HISTORY_ROUTES.length + 2} className="is-empty">
                    {shownHistory ? "Sin movimientos este mes." : historyNote || "Leyendo…"}
                  </td>
                </tr>
              ) : (
                shownHistory[openKind].days.map((day) => (
                  <tr key={day.date}>
                    <td className="is-dia">{day.date.slice(8, 10)}</td>
                    {INFORME_HISTORY_ROUTES.map((route) => (
                      <td key={route} className="is-num is-route">
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
      {openKind === "prestamo" ? (
        <InformePrestamoLines lines={shownHistory?.prestamo.lines ?? []} />
      ) : null}
    </div>
  );
}
