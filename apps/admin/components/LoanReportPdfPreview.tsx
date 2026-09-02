"use client";

import { useCallback } from "react";
import {
  downloadLoanReportPdfAsync,
  loanReportPdfBlobAsync,
  loanReportPdfFileName,
} from "@/lib/loan-report-pdf";
import { ReportPdfPreview } from "@/components/ReportPdfPreview";
import type { LoanReportDocument } from "@/lib/loan-report";

type Props = {
  report: LoanReportDocument;
  visibleCols: string[];
  onClose: () => void;
};

export function LoanReportPdfPreview({ report, visibleCols, onClose }: Props) {
  const buildBlob = useCallback(
    () => loanReportPdfBlobAsync(report, { visibleCols }),
    [report, visibleCols],
  );
  const downloadPdf = useCallback(
    () => downloadLoanReportPdfAsync(report, { visibleCols }),
    [report, visibleCols],
  );

  return (
    <ReportPdfPreview
      title="Vista previa del informe"
      subtitle={`${report.clientName} · ${report.loanRef} · columnas seleccionadas en la tabla`}
      fileName={loanReportPdfFileName(report)}
      buildBlob={buildBlob}
      onDownload={downloadPdf}
      onClose={onClose}
    />
  );
}
