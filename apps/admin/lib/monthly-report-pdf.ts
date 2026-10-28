/**
 * PDF del mensual: una hoja por ruta, la tabla entera en esa hoja.
 * Solo pinta un `MonthSheet` ya armado. No calcula caja ni Inicial.
 */
import { jsPDF } from "jspdf";
import { money } from "@/lib/mock-data";
import { monthLabel, sheetMiles, type MonthSheet, type MonthSheetCell } from "@/lib/monthly-route-sheet";
import { REPORT_PDF_THEME } from "@/lib/report-pdf-layout";

const MARGIN = 8;
const TITLE_H = 9;
const HEAD_H = 6;
const ROW_H = 4.4;
const COL_POS = 8;
const COL_NAME = 42;
const COL_SUM = 18;
const COL_DAY = 8;

function tableWidth(days: number) {
  return COL_POS + COL_NAME + COL_SUM + days * COL_DAY + COL_SUM;
}

function pageSize(sheet: MonthSheet) {
  const rows = Math.max(sheet.rows.length, 1);
  return {
    w: MARGIN * 2 + tableWidth(sheet.days.length),
    h: MARGIN * 2 + TITLE_H + HEAD_H + rows * ROW_H,
  };
}

/** jsPDF pone el lado largo según la orientación. Aquí el ancho es el de la tabla. */
function pageOrientation(size: { w: number; h: number }): "portrait" | "landscape" {
  return size.h >= size.w ? "portrait" : "landscape";
}

function pdfText(text: string) {
  return text.replace(/→/g, "->").replace(/[–—]/g, "-");
}

function fit(doc: jsPDF, text: string, width: number) {
  const clean = pdfText(text);
  if (doc.getTextWidth(clean) <= width) return clean;
  let out = clean;
  while (out.length > 1 && doc.getTextWidth(`${out}...`) > width) out = out.slice(0, -1);
  return `${out}...`;
}

function cellText(cell: MonthSheetCell | null) {
  if (!cell) return "-";
  return sheetMiles(cell.amount) || "0";
}

function drawSheet(doc: jsPDF, sheet: MonthSheet) {
  const width = tableWidth(sheet.days.length);
  const left = MARGIN;
  let y = MARGIN + 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...REPORT_PDF_THEME.ink);
  doc.text(pdfText(`Ruta ${sheet.route} · ${monthLabel(sheet.month)}`), left, y);
  const total = sheet.rows.reduce((sum, row) => sum + (Number(row.saldo) || 0), 0);
  doc.setFontSize(9);
  doc.text(money(total, { symbol: false }), left + width, y, { align: "right" });

  y = MARGIN + TITLE_H;
  doc.setFillColor(...REPORT_PDF_THEME.tableHeadFill);
  doc.rect(left, y, width, HEAD_H, "F");
  doc.setDrawColor(...REPORT_PDF_THEME.border);
  doc.setLineWidth(0.15);
  doc.rect(left, y, width, HEAD_H);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  let x = left;
  const headBaseline = y + HEAD_H - 1.8;
  const heads: Array<{ label: string; w: number }> = [
    { label: "#", w: COL_POS },
    { label: "Nombre", w: COL_NAME },
    { label: "Inicial", w: COL_SUM },
    ...sheet.days.map((iso) => ({ label: String(Number(iso.slice(8, 10))), w: COL_DAY })),
    { label: "Saldo", w: COL_SUM },
  ];
  for (const head of heads) {
    doc.text(head.label, x + head.w / 2, headBaseline, { align: "center" });
    x += head.w;
  }

  doc.setFont("helvetica", "normal");
  const rows = sheet.rows.length > 0 ? sheet.rows : [];
  rows.forEach((row, index) => {
    const top = y + HEAD_H + index * ROW_H;
    const baseline = top + ROW_H - 1.3;
    if (index % 2 === 0) {
      doc.setFillColor(...REPORT_PDF_THEME.rowA);
      doc.rect(left, top, width, ROW_H, "F");
    }
    doc.setDrawColor(...REPORT_PDF_THEME.border);
    doc.rect(left, top, width, ROW_H);
    let cx = left;
    const values: Array<{ text: string; w: number; align: "center" | "left" | "right" }> = [
      { text: String(row.order || index + 1), w: COL_POS, align: "center" },
      { text: fit(doc, row.name, COL_NAME - 2), w: COL_NAME, align: "left" },
      { text: money(row.inicial, { symbol: false }), w: COL_SUM, align: "right" },
      ...row.cells.map((cell) => ({ text: cellText(cell), w: COL_DAY, align: "center" as const })),
      { text: money(row.saldo, { symbol: false }), w: COL_SUM, align: "right" },
    ];
    for (const value of values) {
      const tx = value.align === "left" ? cx + 1 : value.align === "right" ? cx + value.w - 1 : cx + value.w / 2;
      doc.text(value.text, tx, baseline, { align: value.align });
      cx += value.w;
    }
  });
  const bodyBottom = y + HEAD_H + rows.length * ROW_H;
  doc.setDrawColor(...REPORT_PDF_THEME.border);
  let lineX = left;
  for (const head of heads) {
    doc.line(lineX, y, lineX, bodyBottom);
    lineX += head.w;
  }
  doc.line(lineX, y, lineX, bodyBottom);
  if (rows.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Sin clientes en esta ruta.", left + 1, y + HEAD_H + ROW_H - 1.2);
  }
}

/** Una página por ruta. La tabla cabe en esa página; no sigue en otra. */
export function buildMonthlySheetsPdf(sheets: MonthSheet[]): ArrayBuffer {
  const first = sheets[0];
  const firstSize = first ? pageSize(first) : { w: 210, h: 297 };
  const doc = new jsPDF({
    unit: "mm",
    format: [firstSize.w, firstSize.h],
    orientation: pageOrientation(firstSize),
  });
  sheets.forEach((sheet, index) => {
    if (index > 0) {
      const size = pageSize(sheet);
      doc.addPage([size.w, size.h], pageOrientation(size));
    }
    drawSheet(doc, sheet);
  });
  return doc.output("arraybuffer");
}
