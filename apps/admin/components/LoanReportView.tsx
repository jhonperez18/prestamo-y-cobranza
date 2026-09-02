"use client";

import { useMemo, useState } from "react";
import { useColumnVisibility } from "@/components/ColumnPicker";
import { LoanPaymentsTable } from "@/components/LoanPaymentsTable";
import { LoanReportPdfPreview } from "@/components/LoanReportPdfPreview";
import { buildLoanReport, formatLoanReportPendingSummary } from "@/lib/loan-report";
import { money } from "@/lib/mock-data";
import {
  LOAN_PAYMENT_COLUMNS,
  LOAN_PAYMENT_COLUMNS_STORAGE_KEY,
  LOAN_PAYMENT_DEFAULT_COLS,
} from "@/lib/loan-payment-columns";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

type Props = {
  loan: LoanRow;
  client: ClientRow | null;
  payments: PaymentRow[];
  assignments?: DailyCollectionAssignment[];
  onBack: () => void;
};

function ReportBody({
  report,
  payments,
  columnVisibility,
}: {
  report: ReturnType<typeof buildLoanReport>;
  payments: PaymentRow[];
  columnVisibility: ReturnType<typeof useColumnVisibility>;
}) {
  return (
    <article className="loan-report-sheet-body">
      <section className="mini-block loan-report-client-ficha">
        <div className="mini-head">
          <h2>Ficha</h2>
        </div>
        <dl className="loan-report-facts loan-report-ficha-grid">
          {report.clientFicha.map((fact) => (
            <div key={fact.label} className="loan-report-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mini-block loan-report-overdue">
        <div className="mini-head">
          <h2>Cuotas en mora</h2>
          <span className="mini-badge">{report.overdueInstallments.length}</span>
        </div>
        <div className="table-wrap">
          <table className="data mini-grid">
            <thead>
              <tr className="col-titles">
                <th>Fecha cuota</th>
                <th>Concepto</th>
                <th className="right">Valor</th>
                <th className="right">Pagado</th>
                <th className="right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {report.overdueInstallments.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={5}>Sin cuotas en mora.</td>
                </tr>
              ) : (
                report.overdueInstallments.map((row) => (
                  <tr key={`${row.date}-${row.concept}`}>
                    <td>{row.date}</td>
                    <td>{row.concept}</td>
                    <td className="money right">{money(row.amount)}</td>
                    <td className="money right">{money(row.paid)}</td>
                    <td className="money right">{money(row.pending)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mini-block loan-report-pending">
        <div className="mini-head">
          <h2>Cuotas pendientes</h2>
        </div>
        <p className="loan-report-pending-line">{formatLoanReportPendingSummary(report.pendingSummary)}</p>
      </section>

      <section className="loan-report-movements">
        <LoanPaymentsTable
          movements={report.movements}
          payments={payments.filter((row) => row.loanRef === report.loanRef)}
          title="Movimientos recaudados"
          emptyMessage="Sin movimientos registrados."
          columnVisibility={columnVisibility}
        />
      </section>

      <footer className="pay-sum loan-report-footer">
        {report.footer.map((row) => (
          <div key={row.label} className={row.highlight ? "rest" : undefined}>
            <span>{row.label}</span>
            <b>{row.value}</b>
          </div>
        ))}
      </footer>
      <p className="loan-report-footnote">Informe generado el {report.generatedLabel}</p>
    </article>
  );
}

export function LoanReportView({ loan, client, payments, assignments = [], onBack }: Props) {
  const report = useMemo(
    () => buildLoanReport(loan, client, payments, assignments),
    [loan, client, payments, assignments],
  );
  const columnVisibility = useColumnVisibility(LOAN_PAYMENT_COLUMNS, LOAN_PAYMENT_DEFAULT_COLS, {
    storageKey: LOAN_PAYMENT_COLUMNS_STORAGE_KEY,
  });
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);

  return (
    <div className="loan-report">
      <div className="loan-report-page">
        <div className="loan-report-toolbar">
          <div className="loan-report-actions">
            <button type="button" className="btn ghost" onClick={onBack}>
              Volver
            </button>
            <button type="button" className="btn primary" onClick={() => setPdfPreviewOpen(true)}>
              Vista previa PDF
            </button>
          </div>
        </div>
        <ReportBody report={report} payments={payments} columnVisibility={columnVisibility} />
      </div>
      {pdfPreviewOpen ? (
        <LoanReportPdfPreview
          report={report}
          visibleCols={columnVisibility.visibleCols}
          onClose={() => setPdfPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
