"use client";

import { useMemo, useState } from "react";
import { Kpi } from "@/components/ui";
import {
  buildCobranzaPaymentsReport,
  defaultCobranzaReportRange,
} from "@/lib/cobranza-payments-report";
import { livePayments } from "@/lib/live-payments";
import { money, type ClientRow, type LoanRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { monthStartIso, todayIso } from "@/lib/daily-dispatch";

type Props = {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  routes: RouteRow[];
  assignments?: DailyCollectionAssignment[];
  onOpenPaymentsForCollector?: (collectorName: string, fromIso: string, toIso: string) => void;
};

export function CollectorRecaudoReportView({
  payments,
  loans,
  clients,
  routes,
  assignments,
  onOpenPaymentsForCollector,
}: Props) {
  const defaults = defaultCobranzaReportRange();
  const [fromIso, setFromIso] = useState(defaults.fromIso || monthStartIso());
  const [toIso, setToIso] = useState(defaults.toIso || todayIso());

  const report = useMemo(
    () =>
      buildCobranzaPaymentsReport({
        kind: "pagos",
        payments: livePayments(payments),
        loans,
        clients,
        routes,
        assignments,
        fromIso,
        toIso,
      }),
    [payments, loans, clients, routes, assignments, fromIso, toIso],
  );

  const rows = report.summary.byCollector;

  return (
    <section className="panel collector-recaudo-panel">
      <div className="head">
        <h1>Por cobrador</h1>
        <span className="count">{rows.length}</span>
        <div className="grow" />
        <label className="page-size">
          Del{" "}
          <input type="date" value={fromIso} onChange={(e) => setFromIso(e.target.value)} />
        </label>
        <label className="page-size">
          al{" "}
          <input type="date" value={toIso} onChange={(e) => setToIso(e.target.value)} />
        </label>
      </div>

      <div className="kpis zone-kpis">
        <Kpi label="Operaciones" value={String(report.summary.count)} />
        <Kpi label="Total cobrado" value={money(report.summary.total)} tone="sage" />
      </div>

      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              <th>Cobrador</th>
              <th className="right">Ops</th>
              <th className="right">Cobrado</th>
              <th className="right">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={4}>Sin cobros en el rango.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const pct =
                  report.summary.total > 0
                    ? Math.round((row.total / report.summary.total) * 1000) / 10
                    : 0;
                return (
                  <tr
                    key={row.label}
                    className={onOpenPaymentsForCollector ? "clickable" : undefined}
                    onClick={
                      onOpenPaymentsForCollector
                        ? () => onOpenPaymentsForCollector(row.label, fromIso, toIso)
                        : undefined
                    }
                  >
                    <td>{row.label}</td>
                    <td className="right">{row.count}</td>
                    <td className="money right">{money(row.total)}</td>
                    <td className="right">{pct}%</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
