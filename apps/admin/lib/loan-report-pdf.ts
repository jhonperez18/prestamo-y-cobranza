import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { LoanReportDocument } from "@/lib/loan-report";
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
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);
    const response = await fetch("/logo-ca-prestamo.png", { signal: controller.signal });
    window.clearTimeout(timer);
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

function drawLabeledAmountRight(
  doc: jsPDF,
  label: string,
  value: string,
  rightX: number,
  y: number,
  opts?: { labelSize?: number; valueSize?: number },
) {
  const labelSize = opts?.labelSize ?? 9;
  const valueSize = opts?.valueSize ?? 10.5;
  const gap = 2.2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(valueSize);
  doc.setTextColor(...THEME.ink);
  doc.text(value, rightX, y, { align: "right" });
  const valueW = doc.getTextWidth(value);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(labelSize);
  doc.setTextColor(...THEME.muted);
  doc.text(label, rightX - valueW - gap, y, { align: "right" });
}

function drawSummaryRows(doc: jsPDF, report: LoanReportDocument, startY: number) {
  const width = pageWidth(doc);
  const height = pageHeight(doc);
  const contentW = width - PAGE_MARGIN * 2;
  const midX = PAGE_MARGIN + contentW / 2;
  const rightX = width - PAGE_MARGIN;
  const rowH = 9;
  const topRows = report.footer.filter((row) => !row.highlight);
  const restRow = report.footer.find((row) => row.highlight);
  const titleHeight = 12;
  const blockHeight = titleHeight + rowH + (restRow ? rowH : 0) + 8;

  let y = startY;
  if (y + blockHeight > height - FOOTER_RESERVED - 4) {
    doc.addPage();
    y = CONTINUATION_TOP;
  }

  y = drawSectionTitle(doc, "Resumen financiero", y);
  const left = topRows[0];
  const right = topRows[1];

  // Números en su sitio; títulos pegados a la izquierda de cada número
  if (left) {
    drawLabeledAmountRight(doc, left.label, left.value, midX - 4, y + 4);
  }
  if (right) {
    drawLabeledAmountRight(doc, right.label, right.value, rightX, y + 4);
  }

  doc.setDrawColor(...THEME.border);
  doc.setLineWidth(0.35);
  doc.line(PAGE_MARGIN, y + rowH - 1.2, rightX, y + rowH - 1.2);
  y += rowH;

  if (restRow) {
    drawLabeledAmountRight(doc, restRow.label, restRow.value, rightX, y + 4.2, {
      labelSize: 9.2,
      valueSize: 11,
    });

    doc.setDrawColor(...THEME.border);
    doc.setLineWidth(0.35);
    doc.line(PAGE_MARGIN, y + rowH - 1.2, rightX, y + rowH - 1.2);
    y += rowH;
  }

  return y + 3;
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
  drawSummaryRows(doc, report, y);

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
