"use client";

import { useCallback, useMemo, useState } from "react";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { ReportPdfPreview } from "@/components/ReportPdfPreview";
import { Kpi, Pill } from "@/components/ui";
import {
  buildCarteraCollectedMonthRows,
  buildCarteraPortfolioLoanRows,
  carteraResumenDrillTitle,
  type CarteraResumenDrill,
} from "@/lib/cartera-portfolio-rows";
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
import type { ModuleId } from "@/lib/navigation";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import {
  CARTERA_MORA_COLUMNS,
  CARTERA_MORA_DEFAULT_COLS,
  CARTERA_RESUMEN_LOAN_COLUMNS,
  CARTERA_RESUMEN_LOAN_DEFAULT_COLS,
  CARTERA_RESUMEN_PAYMENT_COLUMNS,
  CARTERA_RESUMEN_PAYMENT_DEFAULT_COLS,
} from "@/lib/table-columns";

type Props = {
  viewId: "resumen" | "mora";
  loans: LoanRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  onOpenClient: (clientRef: string) => void;
  onOpenLoan: (loanRef: string) => void;
  onGo?: (moduleId: ModuleId, viewId?: string) => void;
};

function statusPillKind(kind: string) {
  if (kind === "overdue") return "overdue" as const;
  if (kind === "paid") return "paid" as const;
  if (kind === "ok") return "ok" as const;
  return "pending" as const;
}

export function CarteraView({
  viewId,
  loans,
  payments,
  clients,
  onOpenClient,
  onOpenLoan,
  onGo,
}: Props) {
  const isResumen = viewId === "resumen";
  const [routeFilter, setRouteFilter] = useState("");
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [resumenDrill, setResumenDrill] = useState<CarteraResumenDrill | null>(null);

  const moraColumns = useColumnVisibility(CARTERA_MORA_COLUMNS, CARTERA_MORA_DEFAULT_COLS, {
    storageKey: "nexo.cartera.mora.columns",
  });
  const resumenLoanColumns = useColumnVisibility(
    CARTERA_RESUMEN_LOAN_COLUMNS,
    CARTERA_RESUMEN_LOAN_DEFAULT_COLS,
    { storageKey: "nexo.cartera.resumen.loan.columns" },
  );
  const resumenPaymentColumns = useColumnVisibility(
    CARTERA_RESUMEN_PAYMENT_COLUMNS,
    CARTERA_RESUMEN_PAYMENT_DEFAULT_COLS,
    { storageKey: "nexo.cartera.resumen.payment.columns" },
  );

  const routes = useMemo(
    () =>
      [...new Set(clients.map((client) => client.route).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    [clients],
  );

  const portfolio = useMemo(() => buildPortfolioStats(loans, payments), [loans, payments]);

  const moraRows = useMemo(
    () => buildCarteraMoraRows(loans, payments, clients, undefined, routeFilter || undefined),
    [loans, payments, clients, routeFilter],
  );

  const totalRows = useMemo(
    () => buildCarteraPortfolioLoanRows(loans, payments, clients, "all"),
    [loans, payments, clients],
  );

  const onTimeRows = useMemo(
    () => buildCarteraPortfolioLoanRows(loans, payments, clients, "on-time"),
    [loans, payments, clients],
  );

  const collectedRows = useMemo(() => buildCarteraCollectedMonthRows(payments), [payments]);

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

  function toggleResumenDrill(next: CarteraResumenDrill) {
    setResumenDrill((current) => (current === next ? null : next));
  }

  const moraVisibleCount = CARTERA_MORA_COLUMNS.filter((col) => moraColumns.isVisible(col.id)).length;
  const resumenLoanVisibleCount = CARTERA_RESUMEN_LOAN_COLUMNS.filter((col) =>
    resumenLoanColumns.isVisible(col.id),
  ).length;
  const resumenPaymentVisibleCount = CARTERA_RESUMEN_PAYMENT_COLUMNS.filter((col) =>
    resumenPaymentColumns.isVisible(col.id),
  ).length;

  return (
    <>
      {isResumen ? (
        <div className="kpis tone-kpis">
          <Kpi
            label="Cartera total"
            value={money(portfolio.totalBalance)}
            hint={`${portfolio.activeCount} crédito${portfolio.activeCount === 1 ? "" : "s"}`}
            tone="teal"
            active={resumenDrill === "total"}
            onClick={() => toggleResumenDrill("total")}
          />
          <Kpi
            label="Al día"
            value={money(portfolio.onTimeBalance)}
            hint={`${portfolio.onTimeCount} crédito${portfolio.onTimeCount === 1 ? "" : "s"}`}
            tone="sage"
            active={resumenDrill === "al-dia"}
            onClick={() => toggleResumenDrill("al-dia")}
          />
          <Kpi
            label="En mora"
            value={money(portfolio.moraBalance)}
            hint={`${portfolio.moraCount} crédito${portfolio.moraCount === 1 ? "" : "s"}`}
            tone="coral"
            onClick={() => onGo?.("cartera", "mora")}
          />
          <Kpi
            label="Cobrado del mes"
            value={money(portfolio.collectedMonth)}
            hint={portfolio.monthLabel}
            tone="amber"
            active={resumenDrill === "cobrado"}
            onClick={() => toggleResumenDrill("cobrado")}
          />
        </div>
      ) : null}

      {isResumen ? (
        resumenDrill ? (
          <section className="panel cartera-resumen-drill">
            <div className="head">
              <h1>{carteraResumenDrillTitle(resumenDrill, portfolio.monthLabel)}</h1>
              <span className="count">
                {resumenDrill === "cobrado" ? collectedRows.length : resumenDrill === "al-dia" ? onTimeRows.length : totalRows.length}
              </span>
            </div>

            {resumenDrill === "cobrado" ? (
              <div className="table-wrap">
                <table className="data list-grid cartera-resumen-table">
                  <thead>
                    <tr className="col-titles">
                      {resumenPaymentColumns.isVisible("ref") ? <th>Ref.</th> : null}
                      {resumenPaymentColumns.isVisible("fecha") ? <th>Fecha</th> : null}
                      {resumenPaymentColumns.isVisible("client") ? <th>Cliente</th> : null}
                      {resumenPaymentColumns.isVisible("collector") ? <th>Cobrador</th> : null}
                      {resumenPaymentColumns.isVisible("amount") ? <th className="right">Valor</th> : null}
                      {resumenPaymentColumns.isVisible("type") ? <th>Tipo</th> : null}
                      <ColumnPickerHeadCell>
                        <ColumnPicker
                          columns={CARTERA_RESUMEN_PAYMENT_COLUMNS}
                          visibleCols={resumenPaymentColumns.visibleCols}
                          onToggle={resumenPaymentColumns.toggleColumn}
                        />
                      </ColumnPickerHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {collectedRows.length === 0 ? (
                      <tr className="empty-row">
                        <td colSpan={resumenPaymentVisibleCount + 1}>
                          Sin cobros registrados en {portfolio.monthLabel}.
                        </td>
                      </tr>
                    ) : (
                      collectedRows.map((row) => (
                        <tr key={row.ref}>
                          {resumenPaymentColumns.isVisible("ref") ? <td className="ref">{row.ref}</td> : null}
                          {resumenPaymentColumns.isVisible("fecha") ? <td>{row.when}</td> : null}
                          {resumenPaymentColumns.isVisible("client") ? <td>{row.client}</td> : null}
                          {resumenPaymentColumns.isVisible("collector") ? <td>{row.collector}</td> : null}
                          {resumenPaymentColumns.isVisible("amount") ? (
                            <td className="money right">{money(row.amount)}</td>
                          ) : null}
                          {resumenPaymentColumns.isVisible("type") ? <td>{row.type}</td> : null}
                          <ColumnPickerBodyCell />
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data list-grid cartera-resumen-table">
                  <thead>
                    <tr className="col-titles">
                      {resumenLoanColumns.isVisible("client") ? <th>Cliente</th> : null}
                      {resumenLoanColumns.isVisible("loan") ? <th>Préstamo</th> : null}
                      {resumenLoanColumns.isVisible("route") ? <th>Ruta</th> : null}
                      {resumenLoanColumns.isVisible("balance") ? <th className="right">Saldo</th> : null}
                      {resumenLoanColumns.isVisible("status") ? <th>Estado</th> : null}
                      <ColumnPickerHeadCell>
                        <ColumnPicker
                          columns={CARTERA_RESUMEN_LOAN_COLUMNS}
                          visibleCols={resumenLoanColumns.visibleCols}
                          onToggle={resumenLoanColumns.toggleColumn}
                        />
                      </ColumnPickerHeadCell>
                    </tr>
                  </thead>
                  <tbody>
                    {(resumenDrill === "al-dia" ? onTimeRows : totalRows).length === 0 ? (
                      <tr className="empty-row">
                        <td colSpan={resumenLoanVisibleCount + 1}>
                          {resumenDrill === "al-dia"
                            ? "No hay créditos al día en este momento."
                            : "No hay créditos vigentes."}
                        </td>
                      </tr>
                    ) : (
                      (resumenDrill === "al-dia" ? onTimeRows : totalRows).map((row) => (
                        <tr key={row.loanRef}>
                          {resumenLoanColumns.isVisible("client") ? (
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
                          ) : null}
                          {resumenLoanColumns.isVisible("loan") ? (
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
                          ) : null}
                          {resumenLoanColumns.isVisible("route") ? <td>{row.route}</td> : null}
                          {resumenLoanColumns.isVisible("balance") ? (
                            <td className="money right">{money(row.balance)}</td>
                          ) : null}
                          {resumenLoanColumns.isVisible("status") ? (
                            <td>
                              <Pill label={row.statusLabel} kind={statusPillKind(row.statusKind)} />
                            </td>
                          ) : null}
                          <ColumnPickerBodyCell />
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="panel cartera-resumen-hint">
            <p className="ficha-empty">
              Pulse un indicador para ver el detalle: cartera vigente, créditos al día o cobros del mes.
              Para mora detallada con PDF, use la pestaña <strong>Mora</strong>.
            </p>
          </section>
        )
      ) : (
        <>
          <div className="cartera-mora-toolbar panel">
            <div className="filters cobranza-report-filters cartera-mora-filters">
              <select
                className="cartera-mora-route-filter"
                value={routeFilter}
                aria-label="Filtrar por ruta"
                onChange={(event) => setRouteFilter(event.target.value)}
              >
                <option value="">Todas las rutas</option>
                {routes.map((route) => (
                  <option key={route} value={route}>
                    {route}
                  </option>
                ))}
              </select>
              <div className="cartera-mora-toolbar-actions">
                <button type="button" className="btn primary" onClick={() => setPdfPreviewOpen(true)}>
                  Vista previa PDF
                </button>
              </div>
            </div>
          </div>

          <section className="panel">
            <div className="head">
              <h1>Mora</h1>
              <span className="count">{moraRows.length}</span>
            </div>

            <div className="table-wrap">
              <table className="data list-grid cartera-mora-table">
                <colgroup>
                  {moraColumns.isVisible("client") ? <col className="col-mora-client" /> : null}
                  {moraColumns.isVisible("loan") ? <col className="col-mora-loan" /> : null}
                  {moraColumns.isVisible("route") ? <col className="col-mora-route" /> : null}
                  {moraColumns.isVisible("days") ? <col className="col-mora-days" /> : null}
                  {moraColumns.isVisible("cuotas") ? <col className="col-mora-cuotas" /> : null}
                  {moraColumns.isVisible("balance") ? <col className="col-mora-balance" /> : null}
                  {moraColumns.isVisible("status") ? <col className="col-mora-status" /> : null}
                  <col className="col-mora-picker" />
                </colgroup>
                <thead>
                  <tr className="col-titles">
                    {moraColumns.isVisible("client") ? <th>Cliente</th> : null}
                    {moraColumns.isVisible("loan") ? <th>Préstamo</th> : null}
                    {moraColumns.isVisible("route") ? <th>Ruta</th> : null}
                    {moraColumns.isVisible("days") ? <th className="col-mora-days">Días</th> : null}
                    {moraColumns.isVisible("cuotas") ? <th className="col-mora-cuotas">Cuotas</th> : null}
                    {moraColumns.isVisible("balance") ? <th className="right col-mora-balance">Saldo</th> : null}
                    {moraColumns.isVisible("status") ? <th className="col-mora-status">Estado</th> : null}
                    <ColumnPickerHeadCell>
                      <ColumnPicker
                        columns={CARTERA_MORA_COLUMNS}
                        visibleCols={moraColumns.visibleCols}
                        onToggle={moraColumns.toggleColumn}
                      />
                    </ColumnPickerHeadCell>
                  </tr>
                </thead>
                <tbody>
                  {moraRows.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={moraVisibleCount + 1}>No hay préstamos en mora.</td>
                    </tr>
                  ) : (
                    moraRows.map((row) => (
                      <tr key={row.loanRef}>
                        {moraColumns.isVisible("client") ? (
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
                        ) : null}
                        {moraColumns.isVisible("loan") ? (
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
                        ) : null}
                        {moraColumns.isVisible("route") ? <td>{row.route}</td> : null}
                        {moraColumns.isVisible("days") ? <td className="col-mora-days">{row.days}</td> : null}
                        {moraColumns.isVisible("cuotas") ? (
                          <td className="col-mora-cuotas">{row.overdueInstallments}</td>
                        ) : null}
                        {moraColumns.isVisible("balance") ? (
                          <td className="money right cartera-mora-balance">{money(row.balance)}</td>
                        ) : null}
                        {moraColumns.isVisible("status") ? (
                          <td className="col-mora-status">
                            <Pill label={row.statusLabel} kind="overdue" />
                          </td>
                        ) : null}
                        <ColumnPickerBodyCell />
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

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
