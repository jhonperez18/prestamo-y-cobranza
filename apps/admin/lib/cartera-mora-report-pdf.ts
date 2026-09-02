import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  carteraMoraReportFileName,
  type CarteraMoraReportDocument,
} from "@/lib/cartera-mora-report";
import { money } from "@/lib/mock-data";
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

export type CarteraMoraReportPdfOptions = {
  logoDataUrl?: string | null;
};

const TABLE_HEAD = ["Cliente", "Préstamo", "Ruta", "Días", "Cuotas", "Saldo", "Estado"];

function moraTableBody(report: CarteraMoraReportDocument) {
  if (report.rows.length === 0) {
    return [["Sin créditos en mora.", "", "", "", "", "", ""]];
  }
  return report.rows.map((row) => [
    row.clientName,
    row.loanRef,
    row.route,
    String(row.days),
    String(row.overdueInstallments),
    money(row.balance),
    row.statusLabel,
  ]);
}

export function buildCarteraMoraReportPdf(
  report: CarteraMoraReportDocument,
  options: CarteraMoraReportPdfOptions = {},
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = REPORT_PDF_CONTENT_TOP;
  y = drawReportSectionTitle(doc, "Resumen", y);
  y = drawReportFichaGrid(doc, report.ficha, y) + 5;
  y = drawReportSectionTitle(doc, `Créditos en mora (${report.rows.length})`, y);

  autoTable(doc, {
    startY: y,
    margin: {
      left: REPORT_PDF_PAGE_MARGIN,
      right: REPORT_PDF_PAGE_MARGIN,
      top: REPORT_PDF_CONTINUATION_TOP,
      bottom: REPORT_PDF_FOOTER_RESERVED + 4,
    },
    head: [TABLE_HEAD],
    body: moraTableBody(report),
    theme: "plain",
    headStyles: reportPdfTableHeadStyles(),
    bodyStyles: reportPdfTableBodyStyles(),
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right", fontStyle: "bold", textColor: [180, 52, 52] },
    },
    alternateRowStyles: { fillColor: REPORT_PDF_THEME.rowA },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 1) {
        data.cell.styles.textColor = REPORT_PDF_THEME.brand;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  y = reportPdfLastTableY(doc as ReportPdfDoc, y) + 8;
  drawReportSummaryBoxes(doc, "Totales por ruta", report.footer, y);

  stampReportFirstPageHeader(doc, "Cartera en mora", options.logoDataUrl);
  stampReportAllFooters(doc, report.generatedLabel);
  return doc;
}

export function carteraMoraReportPdfBlob(
  report: CarteraMoraReportDocument,
  options: CarteraMoraReportPdfOptions = {},
) {
  return buildCarteraMoraReportPdf(report, options).output("blob");
}

export async function carteraMoraReportPdfBlobAsync(
  report: CarteraMoraReportDocument,
  options: CarteraMoraReportPdfOptions = {},
): Promise<Blob> {
  const logoDataUrl = options.logoDataUrl ?? (await loadReportLogo());
  return carteraMoraReportPdfBlob(report, { ...options, logoDataUrl });
}

export async function downloadCarteraMoraReportPdfAsync(
  report: CarteraMoraReportDocument,
  options: CarteraMoraReportPdfOptions = {},
) {
  if (typeof window === "undefined") return;
  const logoDataUrl = options.logoDataUrl ?? (await loadReportLogo());
  buildCarteraMoraReportPdf(report, { ...options, logoDataUrl }).save(
    carteraMoraReportFileName(report),
  );
}

export { carteraMoraReportFileName };
