"use client";

import { useMemo } from "react";
import { Kpi } from "@/components/ui";
import {
  buildCarteraByCollector,
  buildCarteraByRoute,
} from "@/lib/cartera-by-group";
import { money, type ClientRow, type CollectorRow, type LoanRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";

type Props = {
  mode: "cobrador" | "ruta";
  loans: LoanRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
  routes: RouteRow[];
};

export function CarteraGroupView({
  mode,
  loans,
  payments,
  clients,
  collectors,
  routes,
}: Props) {
  const rows = useMemo(
    () =>
      mode === "cobrador"
        ? buildCarteraByCollector(loans, payments, clients, collectors, routes)
        : buildCarteraByRoute(loans, payments, clients),
    [mode, loans, payments, clients, collectors, routes],
  );

  const totals = useMemo(
    () => ({
      balance: rows.reduce((s, r) => s + r.balance, 0),
      mora: rows.reduce((s, r) => s + r.moraBalance, 0),
      collected: rows.reduce((s, r) => s + r.collectedMonth, 0),
      loans: rows.reduce((s, r) => s + r.loans, 0),
    }),
    [rows],
  );

  const title = mode === "cobrador" ? "Por cobrador" : "Por ruta";
  const colLabel = mode === "cobrador" ? "Cobrador" : "Ruta";

  return (
    <section className="panel cartera-group-panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{rows.length}</span>
      </div>

      <div className="kpis zone-kpis">
        <Kpi label="Saldo vivo" value={money(totals.balance)} />
        <Kpi label="Mora" value={money(totals.mora)} tone="coral" />
        <Kpi label="Cobrado mes" value={money(totals.collected)} tone="sage" />
        <Kpi label="Créditos" value={String(totals.loans)} />
      </div>

      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              <th>{colLabel}</th>
              <th className="right">Clientes</th>
              <th className="right">Créditos</th>
              <th className="right">Saldo</th>
              <th className="right">Mora</th>
              <th className="right">Cobrado mes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={6}>Sin cartera activa en este agrupado.</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="right">{row.clients}</td>
                  <td className="right">{row.loans}</td>
                  <td className="money right">{money(row.balance)}</td>
                  <td className="money right">{money(row.moraBalance)}</td>
                  <td className="money right">{money(row.collectedMonth)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
