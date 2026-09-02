import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportPdfRgb = [number, number, number];

export const REPORT_PDF_THEME = {
  brandDeep: [53, 87, 66] as ReportPdfRgb,
  brand: [66, 102, 80] as ReportPdfRgb,
  teal: [18, 184, 168] as ReportPdfRgb,
  ink: [20, 32, 27] as ReportPdfRgb,
  muted: [91, 114, 104] as ReportPdfRgb,
  border: [213, 226, 219] as ReportPdfRgb,
  rowA: [245, 251, 251] as ReportPdfRgb,
  rowB: [255, 255, 255] as ReportPdfRgb,
  sumNeutralFill: [248, 250, 252] as ReportPdfRgb,
  sumNeutralBorder: [203, 213, 225] as ReportPdfRgb,
  sumCapitalFill: [239, 246, 255] as ReportPdfRgb,
  sumCapitalBorder: [147, 197, 253] as ReportPdfRgb,
  sumRestFill: [219, 234, 254] as ReportPdfRgb,
  sumRestBorder: [96, 165, 250] as ReportPdfRgb,
  tableHeadFill: [232, 244, 239] as ReportPdfRgb,
};

export const REPORT_PDF_PAGE_MARGIN = 14;
export const REPORT_PDF_HEADER_HEIGHT = 26;
export const REPORT_PDF_FOOTER_RESERVED = 14;
export const REPORT_PDF_CONTENT_TOP = REPORT_PDF_HEADER_HEIGHT + 6;
export const REPORT_PDF_CONTINUATION_TOP = REPORT_PDF_PAGE_MARGIN + 4;
export const REPORT_PDF_COMPANY_NAME = "CA préstamo";
export const REPORT_PDF_LOGO_ASPECT = 227 / 54;
export const REPORT_PDF_HEADER_INK: ReportPdfRgb = [11, 16, 20];
export const REPORT_PDF_LOGO_HEIGHT = 9;
export const REPORT_PDF_HEADER_SUBTITLE_FONT = 7.5;
export const REPORT_PDF_FICHA_FONT = 9.5;
export const REPORT_PDF_TABLE_FONT = 9.5;
export const REPORT_PDF_TABLE_HEAD_FONT = 10;
export const REPORT_PDF_TABLE_CELL_PADDING = { top: 1.4, right: 3, bottom: 1.4, left: 3 };

export type ReportPdfDoc = jsPDF & { lastAutoTable?: { finalY: number } };

export type ReportSummaryRow = {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: "capital" | "neutral" | "highlight";
};

export async function loadReportLogo(): Promise<string | null> {
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

export function reportPdfPageWidth(doc: jsPDF) {
  return doc.internal.pageSize.getWidth();
}

export function reportPdfPageHeight(doc: jsPDF) {
  return doc.internal.pageSize.getHeight();
}

export function reportPdfLastTableY(doc: jsPDF, fallback: number) {
  return (doc as ReportPdfDoc).lastAutoTable?.finalY ?? fallback;
}

export function drawReportPageHeader(doc: jsPDF, subtitle: string, logoDataUrl?: string | null) {
  const width = reportPdfPageWidth(doc);
  const logoWidth = REPORT_PDF_LOGO_HEIGHT * REPORT_PDF_LOGO_ASPECT;
  const logoX = (width - logoWidth) / 2;
  const titleBlockHeight = REPORT_PDF_LOGO_HEIGHT + 3.8;
  const logoY = (REPORT_PDF_HEADER_HEIGHT - titleBlockHeight) / 2;

  doc.setFillColor(...REPORT_PDF_HEADER_INK);
  doc.rect(0, 0, width, REPORT_PDF_HEADER_HEIGHT, "F");
  doc.setFillColor(...REPORT_PDF_THEME.teal);
  doc.rect(0, 0, 3, REPORT_PDF_HEADER_HEIGHT, "F");

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoWidth, REPORT_PDF_LOGO_HEIGHT);
    } catch {
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(REPORT_PDF_COMPANY_NAME, width / 2, logoY + 5.5, { align: "center" });
    }
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(REPORT_PDF_COMPANY_NAME, width / 2, logoY + 5.5, { align: "center" });
  }

  doc.setTextColor(210, 228, 220);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(REPORT_PDF_HEADER_SUBTITLE_FONT);
  doc.text(subtitle, width / 2, logoY + REPORT_PDF_LOGO_HEIGHT + 2.8, { align: "center" });

  doc.setDrawColor(...REPORT_PDF_THEME.teal);
  doc.setLineWidth(0.25);
  doc.line(0, REPORT_PDF_HEADER_HEIGHT, width, REPORT_PDF_HEADER_HEIGHT);
}

export function stampReportFirstPageHeader(
  doc: jsPDF,
  subtitle: string,
  logoDataUrl?: string | null,
) {
  doc.setPage(1);
  drawReportPageHeader(doc, subtitle, logoDataUrl);
}

export function drawReportPageFooter(
  doc: jsPDF,
  pageNumber: number,
  pageCount: number,
  generatedLabel: string,
) {
  const width = reportPdfPageWidth(doc);
  const height = reportPdfPageHeight(doc);
  const y = height - REPORT_PDF_FOOTER_RESERVED + 4;

  doc.setDrawColor(...REPORT_PDF_THEME.border);
  doc.setLineWidth(0.25);
  doc.line(REPORT_PDF_PAGE_MARGIN, y - 4, width - REPORT_PDF_PAGE_MARGIN, y - 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...REPORT_PDF_THEME.muted);
  doc.text(
    `${REPORT_PDF_COMPANY_NAME} · Documento confidencial · Generado: ${generatedLabel}`,
    REPORT_PDF_PAGE_MARGIN,
    y,
  );
  doc.text(`Página ${pageNumber} de ${pageCount}`, width - REPORT_PDF_PAGE_MARGIN, y, {
    align: "right",
  });
}

export function stampReportAllFooters(doc: jsPDF, generatedLabel: string) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    drawReportPageFooter(doc, page, total, generatedLabel);
  }
}

export function drawReportSectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...REPORT_PDF_THEME.ink);
  doc.text(title, REPORT_PDF_PAGE_MARGIN, y);
  doc.setDrawColor(...REPORT_PDF_THEME.teal);
  doc.setLineWidth(0.9);
  doc.line(REPORT_PDF_PAGE_MARGIN, y + 1.8, REPORT_PDF_PAGE_MARGIN + 44, y + 1.8);
  return y + 6;
}

export function drawReportFichaGrid(
  doc: jsPDF,
  facts: { label: string; value: string }[],
  startY: number,
) {
  const half = Math.ceil(facts.length / 2);
  const rows: string[][] = [];
  for (let index = 0; index < half; index += 1) {
    const left = facts[index];
    const right = facts[index + half];
    rows.push([left?.label ?? "", left?.value ?? "", right?.label ?? "", right?.value ?? ""]);
  }

  autoTable(doc, {
    startY,
    margin: { left: REPORT_PDF_PAGE_MARGIN, right: REPORT_PDF_PAGE_MARGIN },
    body: rows,
    theme: "plain",
    styles: {
      fontSize: REPORT_PDF_FICHA_FONT,
      cellPadding: { top: 2, right: 4, bottom: 2, left: 4 },
      lineColor: REPORT_PDF_THEME.border,
      lineWidth: 0.15,
      textColor: REPORT_PDF_THEME.ink,
    },
    columnStyles: {
      0: { cellWidth: 40, fontStyle: "bold", textColor: REPORT_PDF_THEME.ink },
      1: { cellWidth: "auto" },
      2: { cellWidth: 40, fontStyle: "bold", textColor: REPORT_PDF_THEME.ink },
      3: { cellWidth: "auto" },
    },
    didParseCell(data) {
      if (data.section !== "body") return;
      data.cell.styles.fillColor =
        data.row.index % 2 === 0 ? REPORT_PDF_THEME.rowA : REPORT_PDF_THEME.rowB;
    },
  });

  return reportPdfLastTableY(doc, startY);
}

export function reportPdfTableHeadStyles() {
  return {
    fillColor: REPORT_PDF_THEME.tableHeadFill,
    textColor: REPORT_PDF_THEME.ink,
    fontStyle: "bold" as const,
    fontSize: REPORT_PDF_TABLE_HEAD_FONT,
    cellPadding: REPORT_PDF_TABLE_CELL_PADDING,
  };
}

export function reportPdfTableBodyStyles() {
  return {
    fontSize: REPORT_PDF_TABLE_FONT,
    textColor: REPORT_PDF_THEME.ink,
    valign: "top" as const,
    cellPadding: REPORT_PDF_TABLE_CELL_PADDING,
    lineColor: REPORT_PDF_THEME.border,
    lineWidth: 0.12,
  };
}

export function drawReportSummaryBoxes(
  doc: jsPDF,
  sectionTitle: string,
  rows: ReportSummaryRow[],
  startY: number,
) {
  const width = reportPdfPageWidth(doc);
  const height = reportPdfPageHeight(doc);
  const gap = 3;
  const boxWidth = (width - REPORT_PDF_PAGE_MARGIN * 2 - gap * 3) / 4;
  const boxHeight = 18;
  const lines = Math.ceil(rows.length / 4);
  const titleHeight = 12;
  const blockHeight = titleHeight + lines * (boxHeight + gap) + 4;

  let y = startY;
  if (y + blockHeight > height - REPORT_PDF_FOOTER_RESERVED - 4) {
    doc.addPage();
    y = REPORT_PDF_CONTINUATION_TOP;
  }

  y = drawReportSectionTitle(doc, sectionTitle, y);

  rows.forEach((row, index) => {
    const col = index % 4;
    const line = Math.floor(index / 4);
    const x = REPORT_PDF_PAGE_MARGIN + col * (boxWidth + gap);
    const boxY = y + line * (boxHeight + gap);

    if (row.highlight || row.tone === "highlight") {
      doc.setFillColor(...REPORT_PDF_THEME.sumRestFill);
      doc.setDrawColor(...REPORT_PDF_THEME.sumRestBorder);
    } else if (row.tone === "capital" || row.label.toLowerCase().includes("capital")) {
      doc.setFillColor(...REPORT_PDF_THEME.sumCapitalFill);
      doc.setDrawColor(...REPORT_PDF_THEME.sumCapitalBorder);
    } else {
      doc.setFillColor(...REPORT_PDF_THEME.sumNeutralFill);
      doc.setDrawColor(...REPORT_PDF_THEME.sumNeutralBorder);
    }

    doc.setLineWidth(0.35);
    doc.roundedRect(x, boxY, boxWidth, boxHeight, 2.5, 2.5, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...REPORT_PDF_THEME.muted);
    doc.text(row.label, x + 3.5, boxY + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(row.highlight ? 11 : 10.2);
    doc.setTextColor(...REPORT_PDF_THEME.ink);
    doc.text(row.value, x + 3.5, boxY + 13.5);
  });

  return y + lines * (boxHeight + gap) + 4;
}
