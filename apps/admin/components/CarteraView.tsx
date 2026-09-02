"use client";

import { useCallback, useMemo, useState } from "react";
import { ReportPdfPreview } from "@/components/ReportPdfPreview";
import { DataTable, Kpi, Pill } from "@/components/ui";
import {
  buildCarteraMoraReport,
  buildCarteraMoraRows,
  carteraMoraReportFileName,
} from "@/lib/cartera-mora-report";
import {
  carteraMoraReportPdfBlobAsync,
  downloadCarteraMoraReportPdfAsync,
} from "@/lib/cartera-mora-report-pdf";
import { buildPortfolioStats } from "@/lib/portfolio-stats";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";

type Props = {
  viewId: "resumen" | "mora";
  loans: LoanRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  onOpenClient: (clientRef: string) => void;
  onOpenLoan: (loanRef: string) => void;
};

export function CarteraView({
  viewId,
  loans,
  payments,
  clients,
  onOpenClient,
  onOpenLoan,
}: Props) {
  const [routeFilter, setRouteFilter] = useState("");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);

  const routes = useMemo(
    () => [...new Set(clients.map((client) => client.route).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [clients],
  );

  const moraRows = useMemo(
    () => buildCarteraMoraRows(loans, payments, clients, undefined, routeFilter || undefined),
    [loans, payments, clients, routeFilter],
  );

  const portfolio = useMemo(() => buildPortfolioStats(loans, payments), [loans, payments]);

  const report = useMemo(
    () =>
      buildCarteraMoraReport({
        loans,
        payments,
        clients,
        routeFilter: routeFilter || undefined,
      }),
    [loans, payments, clients, routeFilter],
  );

  const buildPdfBlob = useCallback(() => carteraMoraReportPdfBlobAsync(report), [report]);
  const downloadPdf = useCallback(() => downloadCarteraMoraReportPdfAsync(report), [report]);

  const tableTitle = viewId === "mora" ? "Mora" : "Resumen · exposición en mora";
  const showExport = viewId === "mora";

  return (
    <>
      <div className="kpis tone-kpis">
        <Kpi
          label="Cartera total"
          value={money(portfolio.totalBalance)}
          hint={`${portfolio.activeCount} crédito${portfolio.activeCount === 1 ? "" : "s"}`}
          tone="teal"
        />
        <Kpi
          label="Al día"
          value={money(portfolio.onTimeBalance)}
          hint={`${portfolio.onTimeCount} crédito${portfolio.onTimeCount === 1 ? "" : "s"}`}
          tone="sage"
        />
        <Kpi
          label="En mora"
          value={money(portfolio.moraBalance)}
          hint={`${portfolio.moraCount} crédito${portfolio.moraCount === 1 ? "" : "s"}`}
          tone="coral"
        />
        <Kpi
          label="Cobrado del mes"
          value={money(portfolio.collectedMonth)}
          hint={portfolio.monthLabel}
          tone="amber"
        />
      </div>

      {showExport ? (
        <div className="cartera-mora-toolbar panel">
          <div className="filters cobranza-report-filters cartera-mora-filters">
            <label>
              Ruta
              <select value={routeFilter} onChange={(event) => setRouteFilter(event.target.value)}>
                <option value="">Todas</option>
                {routes.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
            </label>
            <div className="cartera-mora-toolbar-actions">
              <button type="button" className="btn primary" onClick={() => setPdfPreviewOpen(true)}>
                Vista previa PDF
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <DataTable title={tableTitle} count={moraRows.length} headers={[
        { t: "Cliente" },
        { t: "Préstamo" },
        { t: "Días" },
        { t: "Saldo", right: true },
        { t: "Estado" },
      ]}>
        {moraRows.length === 0 ? (
          <tr className="empty-row">
            <td colSpan={5}>No hay préstamos en mora.</td>
          </tr>
        ) : (
          moraRows.map((row) => (
            <tr key={row.loanRef}>
              <td>
                <button
                  type="button"
                  className="btn-link"
                  title="Ver cliente"
                  onClick={() => onOpenClient(row.clientRef)}
                >
                  {row.clientName}
                </button>
              </td>
              <td>
                <button
                  type="button"
                  className="btn-link ref"
                  title="Ver préstamo"
                  onClick={() => onOpenLoan(row.loanRef)}
                >
                  {row.loanRef}
                </button>
              </td>
              <td>{row.days}</td>
              <td className="money right">{money(row.balance)}</td>
              <td>
                <Pill label="Mora" kind="overdue" />
              </td>
            </tr>
          ))
        )}
      </DataTable>

      {pdfPreviewOpen ? (
        <ReportPdfPreview
          title="Vista previa del informe"
          subtitle={`Cartera en mora · ${report.asOfLabel} · ${report.summary.count} crédito${report.summary.count === 1 ? "" : "s"}`}
          fileName={carteraMoraReportFileName(report)}
          buildBlob={buildPdfBlob}
          onDownload={downloadPdf}
          onClose={() => setPdfPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
