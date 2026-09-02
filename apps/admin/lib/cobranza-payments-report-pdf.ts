import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  COBRANZA_PAYMENT_REPORT_DEFAULT_COLS,
  cobranzaPaymentReportCell,
  orderedVisibleCobranzaPaymentColumns,
} from "@/lib/cobranza-payment-columns";
import type { CobranzaPaymentsReportDocument } from "@/lib/cobranza-payments-report";
import { cobranzaPaymentsReportFileName } from "@/lib/cobranza-payments-report";
import {
  REPORT_PDF_CONTENT_TOP,
  REPORT_PDF_CONTINUATION_TOP,
  REPORT_PDF_FOOTER_RESERVED,
  REPORT_PDF_PAGE_MARGIN,
  REPORT_PDF_THEME,
  drawReportFichaGrid,
  drawReportSectionTitle,
  drawReportSummaryBoxes,
  loadReportLogo,
  reportPdfLastTableY,
  reportPdfTableBodyStyles,
  reportPdfTableHeadStyles,
  stampReportAllFooters,
  stampReportFirstPageHeader,
  type ReportPdfDoc,
} from "@/lib/report-pdf-layout";

export type CobranzaPaymentsReportPdfOptions = {
  visibleCols?: string[];
  logoDataUrl?: string | null;
};

function resolveVisibleColumns(visibleCols?: string[]) {
  const ids = visibleCols?.length ? visibleCols : COBRANZA_PAYMENT_REPORT_DEFAULT_COLS;
  return orderedVisibleCobranzaPaymentColumns(ids);
}

export function buildCobranzaPaymentsReportPdf(
  report: CobranzaPaymentsReportDocument,
  options: CobranzaPaymentsReportPdfOptions = {},
): jsPDF {
  const columns = resolveVisibleColumns(options.visibleCols);
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = REPORT_PDF_CONTENT_TOP;
  y = drawReportSectionTitle(doc, "Resumen", y);
  y = drawReportFichaGrid(doc, report.ficha, y) + 5;
  y = drawReportSectionTitle(doc, `Movimientos (${report.payments.length})`, y);

  const tableHead = [columns.map((col) => col.label)];
  const tableBody =
    report.payments.length > 0
      ? report.payments.map((payment) => {
          const movement = report.movements.find((row) => row.ref === payment.ref)!;
          return columns.map((col) => cobranzaPaymentReportCell(col.id, payment, movement));
        })
      : [["Sin movimientos en este periodo.", ...Array(Math.max(columns.length - 1, 0)).fill("")]];

  autoTable(doc, {
    startY: y,
    margin: {
      left: REPORT_PDF_PAGE_MARGIN,
      right: REPORT_PDF_PAGE_MARGIN,
      top: REPORT_PDF_CONTINUATION_TOP,
      bottom: REPORT_PDF_FOOTER_RESERVED + 4,
    },
    head: tableHead,
    body: tableBody,
    theme: "plain",
    headStyles: reportPdfTableHeadStyles(),
    bodyStyles: reportPdfTableBodyStyles(),
    alternateRowStyles: { fillColor: REPORT_PDF_THEME.rowA },
    didParseCell(data) {
      const column = columns[data.column.index];
      if (data.section !== "body" || !column) return;
      if (column.id === "ref") {
        data.cell.styles.textColor = REPORT_PDF_THEME.brand;
        data.cell.styles.fontStyle = "bold";
      }
      if (column.id === "valor") {
        data.cell.styles.halign = "right";
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = REPORT_PDF_THEME.brandDeep;
      }
    },
  });

  y = reportPdfLastTableY(doc as ReportPdfDoc, y) + 8;
  drawReportSummaryBoxes(doc, "Totales del periodo", report.footer, y);

  stampReportFirstPageHeader(doc, report.subtitle, options.logoDataUrl);
  stampReportAllFooters(doc, report.generatedLabel);
  return doc;
}

export function cobranzaPaymentsReportPdfBlob(
  report: CobranzaPaymentsReportDocument,
  options: CobranzaPaymentsReportPdfOptions = {},
) {
  return buildCobranzaPaymentsReportPdf(report, options).output("blob");
}

export async function cobranzaPaymentsReportPdfBlobAsync(
  report: CobranzaPaymentsReportDocument,
  options: CobranzaPaymentsReportPdfOptions = {},
): Promise<Blob> {
  const logoDataUrl = options.logoDataUrl ?? (await loadReportLogo());
  return cobranzaPaymentsReportPdfBlob(report, { ...options, logoDataUrl });
}

export async function downloadCobranzaPaymentsReportPdfAsync(
  report: CobranzaPaymentsReportDocument,
  options: CobranzaPaymentsReportPdfOptions = {},
) {
  if (typeof window === "undefined") return;
  const logoDataUrl = options.logoDataUrl ?? (await loadReportLogo());
  buildCobranzaPaymentsReportPdf(report, { ...options, logoDataUrl }).save(
    cobranzaPaymentsReportFileName(report),
  );
}
