import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { LoanReportDocument } from "@/lib/loan-report";
import { formatLoanReportPendingSummary } from "@/lib/loan-report";
import { money } from "@/lib/mock-data";
import {
  LOAN_PAYMENT_DEFAULT_COLS,
  loanPaymentMovementCell,
  orderedVisibleLoanPaymentColumns,
} from "@/lib/loan-payment-columns";

export type LoanReportPdfOptions = {
  visibleCols?: string[];
  logoDataUrl?: string | null;
};

type Rgb = [number, number, number];

const THEME = {
  brandDeep: [53, 87, 66] as Rgb,
  brand: [66, 102, 80] as Rgb,
  teal: [18, 184, 168] as Rgb,
  tealSoft: [224, 247, 244] as Rgb,
  ink: [20, 32, 27] as Rgb,
  muted: [91, 114, 104] as Rgb,
  paper: [242, 249, 249] as Rgb,
  card: [247, 250, 248] as Rgb,
  border: [213, 226, 219] as Rgb,
  rowA: [245, 251, 251] as Rgb,
  rowB: [255, 255, 255] as Rgb,
  sumNeutralFill: [248, 250, 252] as Rgb,
  sumNeutralBorder: [203, 213, 225] as Rgb,
  sumCapitalFill: [239, 246, 255] as Rgb,
  sumCapitalBorder: [147, 197, 253] as Rgb,
  sumRestFill: [219, 234, 254] as Rgb,
  sumRestBorder: [96, 165, 250] as Rgb,
  tableHeadFill: [232, 244, 239] as Rgb,
};

const PAGE_MARGIN = 14;
const HEADER_HEIGHT = 26;
const FOOTER_RESERVED = 14;
const CONTENT_TOP = HEADER_HEIGHT + 6;
const CONTINUATION_TOP = PAGE_MARGIN + 4;
const COMPANY_NAME = "CA préstamo";
const LOGO_ASPECT = 227 / 54;
const HEADER_INK: Rgb = [11, 16, 20];
const LOGO_HEIGHT = 9;
const HEADER_SUBTITLE_FONT = 7.5;
const PDF_FICHA_FONT = 9.5;
const PDF_TABLE_FONT = 9.5;
const PDF_TABLE_HEAD_FONT = 10;
const PDF_TABLE_CELL_PADDING = { top: 1.4, right: 3, bottom: 1.4, left: 3 };

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

export async function loadLoanReportLogo(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch("/logo-ca-prestamo.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function resolveVisibleColumns(visibleCols?: string[]) {
  const ids = visibleCols?.length ? visibleCols : LOAN_PAYMENT_DEFAULT_COLS;
  return orderedVisibleLoanPaymentColumns(ids);
}

function pageWidth(doc: jsPDF) {
  return doc.internal.pageSize.getWidth();
}

function pageHeight(doc: jsPDF) {
  return doc.internal.pageSize.getHeight();
}

function drawPageHeader(doc: jsPDF, logoDataUrl?: string | null) {
  const width = pageWidth(doc);
  const logoWidth = LOGO_HEIGHT * LOGO_ASPECT;
  const logoX = (width - logoWidth) / 2;
  const titleBlockHeight = LOGO_HEIGHT + 3.8;
  const logoY = (HEADER_HEIGHT - titleBlockHeight) / 2;

  doc.setFillColor(...HEADER_INK);
  doc.rect(0, 0, width, HEADER_HEIGHT, "F");
  doc.setFillColor(...THEME.teal);
  doc.rect(0, 0, 3, HEADER_HEIGHT, "F");

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoWidth, LOGO_HEIGHT);
    } catch {
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(COMPANY_NAME, width / 2, logoY + 5.5, { align: "center" });
    }
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(COMPANY_NAME, width / 2, logoY + 5.5, { align: "center" });
  }

  doc.setTextColor(210, 228, 220);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(HEADER_SUBTITLE_FONT);
  doc.text("Informe de préstamo", width / 2, logoY + LOGO_HEIGHT + 2.8, { align: "center" });

  doc.setDrawColor(...THEME.teal);
  doc.setLineWidth(0.25);
  doc.line(0, HEADER_HEIGHT, width, HEADER_HEIGHT);
}

function stampFirstPageHeader(doc: jsPDF, logoDataUrl?: string | null) {
  doc.setPage(1);
  drawPageHeader(doc, logoDataUrl);
}

function drawPageFooter(
  doc: jsPDF,
  pageNumber: number,
  pageCount: number,
  generatedLabel: string,
) {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  const y = height - FOOTER_RESERVED + 4;

  doc.setDrawColor(...THEME.border);
  doc.setLineWidth(0.25);
  doc.line(PAGE_MARGIN, y - 4, width - PAGE_MARGIN, y - 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...THEME.muted);
  doc.text(
    `${COMPANY_NAME} · Documento confidencial · Generado: ${generatedLabel}`,
    PAGE_MARGIN,
    y,
  );
  doc.text(`Página ${pageNumber} de ${pageCount}`, width - PAGE_MARGIN, y, { align: "right" });
}

function drawSectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...THEME.ink);
  doc.text(title, PAGE_MARGIN, y);
  doc.setDrawColor(...THEME.teal);
  doc.setLineWidth(0.9);
  doc.line(PAGE_MARGIN, y + 1.8, PAGE_MARGIN + 44, y + 1.8);
  return y + 6;
}

function drawClientFicha(doc: jsPDF, report: LoanReportDocument, startY: number) {
  const half = Math.ceil(report.clientFicha.length / 2);
  const rows: string[][] = [];
  for (let index = 0; index < half; index += 1) {
    const left = report.clientFicha[index];
    const right = report.clientFicha[index + half];
    rows.push([
      left?.label ?? "",
      left?.value ?? "",
      right?.label ?? "",
      right?.value ?? "",
    ]);
  }

  autoTable(doc, {
    startY,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    body: rows,
    theme: "plain",
    styles: {
      fontSize: PDF_FICHA_FONT,
      cellPadding: { top: 2, right: 4, bottom: 2, left: 4 },
      lineColor: THEME.border,
      lineWidth: 0.15,
      textColor: THEME.ink,
    },
    columnStyles: {
      0: { cellWidth: 40, fontStyle: "bold", textColor: THEME.ink },
      1: { cellWidth: "auto" },
      2: { cellWidth: 40, fontStyle: "bold", textColor: THEME.ink },
      3: { cellWidth: "auto" },
    },
    didParseCell(data) {
      if (data.section !== "body") return;
      data.cell.styles.fillColor = data.row.index % 2 === 0 ? THEME.rowA : THEME.rowB;
    },
  });

  return (doc as DocWithAutoTable).lastAutoTable?.finalY ?? startY;
}

function drawInstallmentTable(
  doc: jsPDF,
  rows: LoanReportDocument["overdueInstallments"],
  emptyMessage: string,
  startY: number,
  options: { pendingHighlight?: boolean } = {},
) {
  const body =
    rows.length > 0
      ? rows.map((row) => [row.date, row.concept, money(row.amount), money(row.paid), money(row.pending)])
      : [[emptyMessage, "", "", "", ""]];

  autoTable(doc, {
    startY,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    head: [["Fecha cuota", "Concepto", "Valor", "Pagado", "Pendiente"]],
    body,
    theme: "plain",
    headStyles: {
      fillColor: THEME.tableHeadFill,
      textColor: THEME.ink,
      fontStyle: "bold",
      fontSize: PDF_TABLE_HEAD_FONT,
      cellPadding: PDF_TABLE_CELL_PADDING,
    },
    bodyStyles: {
      fontSize: PDF_TABLE_FONT,
      textColor: THEME.ink,
      cellPadding: PDF_TABLE_CELL_PADDING,
      lineColor: THEME.border,
      lineWidth: 0.12,
    },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: {
        halign: "right",
        fontStyle: "bold",
        textColor: options.pendingHighlight ? [180, 52, 52] : THEME.ink,
      },
    },
    alternateRowStyles: { fillColor: THEME.rowA },
  });

  return (doc as DocWithAutoTable).lastAutoTable?.finalY ?? startY;
}

function drawOverdueTable(doc: jsPDF, report: LoanReportDocument, startY: number) {
  return drawInstallmentTable(doc, report.overdueInstallments, "Sin cuotas en mora.", startY, {
    pendingHighlight: true,
  });
}

function drawPendingSummary(doc: jsPDF, report: LoanReportDocument, startY: number) {
  let y = drawSectionTitle(doc, "Cuotas pendientes", startY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(PDF_TABLE_FONT);
  doc.setTextColor(...THEME.ink);
  doc.text(formatLoanReportPendingSummary(report.pendingSummary), PAGE_MARGIN, y + 4);
  return y + 10;
}

function drawSummaryBoxes(doc: jsPDF, report: LoanReportDocument, startY: number) {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  const gap = 3;
  const boxWidth = (width - PAGE_MARGIN * 2 - gap * 3) / 4;
  const boxHeight = 18;
  const lines = Math.ceil(report.footer.length / 4);
  const titleHeight = 12;
  const blockHeight = titleHeight + lines * (boxHeight + gap) + 4;

  let y = startY;
  if (y + blockHeight > height - FOOTER_RESERVED - 4) {
    doc.addPage();
    y = CONTINUATION_TOP;
  }

  y = drawSectionTitle(doc, "Resumen financiero", y);

  report.footer.forEach((row, index) => {
    const col = index % 4;
    const line = Math.floor(index / 4);
    const x = PAGE_MARGIN + col * (boxWidth + gap);
    const boxY = y + line * (boxHeight + gap);

    if (row.highlight) {
      doc.setFillColor(...THEME.sumRestFill);
      doc.setDrawColor(...THEME.sumRestBorder);
    } else if (row.label.toLowerCase().includes("capital")) {
      doc.setFillColor(...THEME.sumCapitalFill);
      doc.setDrawColor(...THEME.sumCapitalBorder);
    } else {
      doc.setFillColor(...THEME.sumNeutralFill);
      doc.setDrawColor(...THEME.sumNeutralBorder);
    }

    doc.setLineWidth(0.35);
    doc.roundedRect(x, boxY, boxWidth, boxHeight, 2.5, 2.5, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...THEME.muted);
    doc.text(row.label, x + 3.5, boxY + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(row.highlight ? 11 : 10.2);
    doc.setTextColor(...THEME.ink);
    doc.text(row.value, x + 3.5, boxY + 13.5);
  });

  return y + lines * (boxHeight + gap) + 4;
}

function stampAllFooters(doc: jsPDF, generatedLabel: string) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    drawPageFooter(doc, page, total, generatedLabel);
  }
}

export function buildLoanReportPdf(report: LoanReportDocument, options: LoanReportPdfOptions = {}): jsPDF {
  const columns = resolveVisibleColumns(options.visibleCols);
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  let y = CONTENT_TOP;
  y = drawSectionTitle(doc, "Ficha", y);
  y = drawClientFicha(doc, report, y) + 5;
  y = drawSectionTitle(doc, `Cuotas en mora (${report.overdueInstallments.length})`, y);
  y = drawOverdueTable(doc, report, y) + 5;
  y = drawPendingSummary(doc, report, y) + 2;
  y = drawSectionTitle(doc, `Movimientos recaudados (${report.movements.length})`, y);

  const tableHead = [columns.map((col) => col.label)];
  const tableBody =
    report.movements.length > 0
      ? report.movements.map((movement) =>
          columns.map((col) => loanPaymentMovementCell(col.id, movement)),
        )
      : [["Sin movimientos registrados.", ...Array(Math.max(columns.length - 1, 0)).fill("")]];

  autoTable(doc, {
    startY: y,
    margin: {
      left: PAGE_MARGIN,
      right: PAGE_MARGIN,
      top: CONTINUATION_TOP,
      bottom: FOOTER_RESERVED + 4,
    },
    head: tableHead,
    body: tableBody,
    theme: "plain",
    headStyles: {
      fillColor: THEME.tableHeadFill,
      textColor: THEME.ink,
      fontStyle: "bold",
      fontSize: PDF_TABLE_HEAD_FONT,
      cellPadding: PDF_TABLE_CELL_PADDING,
    },
    bodyStyles: {
      fontSize: PDF_TABLE_FONT,
      textColor: THEME.ink,
      valign: "top",
      cellPadding: PDF_TABLE_CELL_PADDING,
      lineColor: THEME.border,
      lineWidth: 0.12,
    },
    alternateRowStyles: { fillColor: THEME.rowA },
    didParseCell(data) {
      if (data.section === "body" && columns[data.column.index]?.id === "ref") {
        data.cell.styles.textColor = THEME.brand;
        data.cell.styles.fontStyle = "bold";
      }
      if (data.section === "body" && columns[data.column.index]?.id === "amount") {
        data.cell.styles.halign = "right";
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = THEME.brandDeep;
      }
    },
  });

  y = ((doc as DocWithAutoTable).lastAutoTable?.finalY ?? y) + 8;
  drawSummaryBoxes(doc, report, y);

  stampFirstPageHeader(doc, options.logoDataUrl);
  stampAllFooters(doc, report.generatedLabel);
  return doc;
}

export function loanReportPdfBlob(report: LoanReportDocument, options: LoanReportPdfOptions = {}) {
  return buildLoanReportPdf(report, options).output("blob");
}

export async function loanReportPdfBlobAsync(
  report: LoanReportDocument,
  options: LoanReportPdfOptions = {},
): Promise<Blob> {
  const logoDataUrl = options.logoDataUrl ?? (await loadLoanReportLogo());
  return loanReportPdfBlob(report, { ...options, logoDataUrl });
}

export function loanReportPdfFileName(report: LoanReportDocument) {
  return `informe-${report.loanRef}-${report.generatedAt}.pdf`;
}

export function downloadLoanReportPdf(report: LoanReportDocument, options: LoanReportPdfOptions = {}) {
  if (typeof window === "undefined") return;
  buildLoanReportPdf(report, options).save(loanReportPdfFileName(report));
}

export async function downloadLoanReportPdfAsync(
  report: LoanReportDocument,
  options: LoanReportPdfOptions = {},
) {
  if (typeof window === "undefined") return;
  const logoDataUrl = options.logoDataUrl ?? (await loadLoanReportLogo());
  buildLoanReportPdf(report, { ...options, logoDataUrl }).save(loanReportPdfFileName(report));
}
