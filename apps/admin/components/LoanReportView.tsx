"use client";

import { useMemo, useState } from "react";
import { useColumnVisibility } from "@/components/ColumnPicker";
import { LoanPaymentsTable } from "@/components/LoanPaymentsTable";
import { LoanReportPdfPreview } from "@/components/LoanReportPdfPreview";
import { buildLoanReport } from "@/lib/loan-report";
import {
  LOAN_REPORT_COLUMNS,
  LOAN_REPORT_COLUMNS_STORAGE_KEY,
  LOAN_REPORT_DEFAULT_COLS,
  militaryTimeLabel,
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
  clientRoute,
  columnVisibility,
}: {
  report: ReturnType<typeof buildLoanReport>;
  payments: PaymentRow[];
  clientRoute?: string;
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

      <section className="loan-report-movements">
        <LoanPaymentsTable
          movements={report.movements}
          payments={payments.filter((row) => row.loanRef === report.loanRef)}
          clientRoute={clientRoute}
          title="Movimientos recaudados"
          emptyMessage="Sin movimientos registrados."
          columnVisibility={columnVisibility}
          columns={LOAN_REPORT_COLUMNS}
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
  const report = useMemo(() => {
    const built = buildLoanReport(loan, client, payments, assignments);
    return {
      ...built,
      movements: built.movements.map((row) => ({ ...row, paidTime: militaryTimeLabel(row.paidTime) })),
    };
  }, [loan, client, payments, assignments]);
  const columnVisibility = useColumnVisibility(LOAN_REPORT_COLUMNS, LOAN_REPORT_DEFAULT_COLS, {
    storageKey: LOAN_REPORT_COLUMNS_STORAGE_KEY,
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
            <button type="button" className="btn primary compact" onClick={() => setPdfPreviewOpen(true)}>
              Vista previa PDF
            </button>
          </div>
        </div>
        <ReportBody
          report={report}
          payments={payments}
          clientRoute={client?.route}
          columnVisibility={columnVisibility}
        />
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
