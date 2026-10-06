/**
 * PDF del informe semanal (una hoja por alcance: M · T · N o A).
 * Solo pinta un `WeeklyReport` ya armado por `buildWeeklyReport`; no calcula cifras.
 * Corre en servidor (cron) y en navegador.
 */
import { jsPDF } from "jspdf";
import autoTable, { type CellHookData, type RowInput } from "jspdf-autotable";
import { weekdayLabel } from "@/lib/colombia-holidays";
import { isoToDisplay } from "@/lib/loan-preview";
import { money } from "@/lib/mock-data";
import {
  REPORT_PDF_CONTENT_TOP,
  REPORT_PDF_CONTINUATION_TOP,
  REPORT_PDF_FOOTER_RESERVED,
  REPORT_PDF_PAGE_MARGIN,
  REPORT_PDF_THEME,
  drawReportSectionTitle,
  reportPdfLastTableY,
  reportPdfPageHeight,
  reportPdfPageWidth,
  stampReportAllFooters,
  stampReportFirstPageHeader,
} from "@/lib/report-pdf-layout";
import type { WeeklyRange, WeeklyReport, WeeklyRouteCartera } from "@/lib/weekly-report";

const BLOCK_LINE: [number, number, number] = [20, 32, 27];
const GAP = 8;
const SMALL_FONT = 7.4;

/** Helvetica estándar no trae flechas ni guiones largos. */
function pdfText(text: string) {
  return text.replace(/→/g, "->").replace(/[–—]/g, "-");
}

function num(value: number | null) {
  return value == null ? "-" : money(value, { symbol: false });
}

function shortDate(iso: string) {
  return isoToDisplay(iso).slice(0, 5);
}

export function weeklyRangeLabel(range: WeeklyRange) {
  const parts = [
    `Semana ${shortDate(range.start)} - ${shortDate(range.end)}/${range.end.slice(0, 4)}`,
    `corte ${weekdayLabel(range.end)} ${shortDate(range.end)}${range.monthEnd ? " (fin de mes)" : ""}`,
  ];
  if (range.partial) parts.push("semana en curso (hasta hoy)");
  if (range.holidays.length) {
    parts.push(`festivo: ${range.holidays.map((day) => `${weekdayLabel(day)} ${shortDate(day)}`).join(", ")}`);
  }
  return parts.join(" · ");
}

export function weeklyScopeTitle(report: WeeklyReport) {
  return report.scope === "a" ? "Ruta A" : "Rutas M · T · N";
}

function tableStyles() {
  return {
    theme: "grid" as const,
    styles: {
      fontSize: SMALL_FONT,
      textColor: REPORT_PDF_THEME.ink,
      lineColor: REPORT_PDF_THEME.border,
      lineWidth: 0.12,
      cellPadding: { top: 0.9, right: 1.6, bottom: 0.9, left: 1.6 },
    },
    headStyles: {
      fillColor: REPORT_PDF_THEME.tableHeadFill,
      textColor: REPORT_PDF_THEME.ink,
      fontStyle: "bold" as const,
    },
    footStyles: {
      fillColor: REPORT_PDF_THEME.tableHeadFill,
      textColor: REPORT_PDF_THEME.ink,
      fontStyle: "bold" as const,
    },
  };
}

function ensureSpace(doc: jsPDF, y: number, needed: number) {
  if (y + needed <= reportPdfPageHeight(doc) - REPORT_PDF_FOOTER_RESERVED - 2) return y;
  doc.addPage();
  return REPORT_PDF_CONTINUATION_TOP;
}

function drawCartera(doc: jsPDF, cartera: WeeklyRouteCartera[], startY: number) {
  const width = reportPdfPageWidth(doc) - REPORT_PDF_PAGE_MARGIN * 2;
  const block = width / cartera.length;
  const numWidth = Math.min(20, block * 0.24);
  const posWidth = 9;
  const height = Math.max(0, ...cartera.map((route) => route.rows.length));

  const head: RowInput[] = [
    cartera.map((route) => ({
      content: `Ruta ${route.route}${route.collectorName ? ` · ${route.collectorName}` : ""}`,
      colSpan: 4,
      styles: { halign: "center" as const },
    })),
    cartera.flatMap(() => ["#", "Cliente", "Debe al corte", "Pagó semana"]),
  ];
  const body: RowInput[] = Array.from({ length: height }, (_, index) =>
    cartera.flatMap((route) => {
      const row = route.rows[index];
      if (!row) return ["", "", "", ""];
      return [String(row.order || index + 1), row.name, num(row.debt), row.paidWeek > 0 ? num(row.paidWeek) : "-"];
    }),
  );
  const foot: RowInput[] = [
    cartera.flatMap((route) => [
      { content: `Total · ${route.rows.length} clientes · ${route.owing} deben`, colSpan: 2 },
      num(route.total),
      "",
    ]),
  ];

  const columnStyles: Record<number, { cellWidth: number; halign?: "right" | "left" }> = {};
  cartera.forEach((_, blockIndex) => {
    const base = blockIndex * 4;
    columnStyles[base] = { cellWidth: posWidth, halign: "right" };
    columnStyles[base + 1] = { cellWidth: block - posWidth - numWidth * 2 };
    columnStyles[base + 2] = { cellWidth: numWidth, halign: "right" };
    columnStyles[base + 3] = { cellWidth: numWidth, halign: "right" };
  });

  autoTable(doc, {
    ...tableStyles(),
    startY,
    margin: {
      top: REPORT_PDF_CONTINUATION_TOP,
      left: REPORT_PDF_PAGE_MARGIN,
      right: REPORT_PDF_PAGE_MARGIN,
      bottom: REPORT_PDF_FOOTER_RESERVED + 2,
    },
    head,
    body,
    foot,
    showHead: "everyPage",
    showFoot: "lastPage",
    columnStyles,
    styles: { ...tableStyles().styles, overflow: "ellipsize" },
    didParseCell(data: CellHookData) {
      const col = data.column.index;
      const colSpan = data.cell.colSpan || 1;
      const startsBlock = col % 4 === 0;
      const endsBlock = (col + colSpan) % 4 === 0;
      if (startsBlock || endsBlock) {
        data.cell.styles.lineWidth = {
          top: 0.12,
          bottom: 0.12,
          left: startsBlock ? 0.8 : 0.12,
          right: endsBlock ? 0.8 : 0.12,
        };
      }
      if (startsBlock || endsBlock) data.cell.styles.lineColor = BLOCK_LINE;
      if (data.section === "body" && col % 4 === 2 && data.cell.raw !== "-" && data.cell.raw !== "") {
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  return reportPdfLastTableY(doc, startY);
}

type SideTable = {
  title: string;
  head?: RowInput[];
  body: RowInput[];
  foot?: RowInput[];
  numericFrom?: number;
};

function drawTitleAt(doc: jsPDF, title: string, x: number, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...REPORT_PDF_THEME.ink);
  doc.text(title, x, y);
  doc.setDrawColor(...REPORT_PDF_THEME.teal);
  doc.setLineWidth(0.9);
  doc.line(x, y + 1.8, x + 44, y + 1.8);
  return y + 6;
}

function drawSideTable(doc: jsPDF, table: SideTable, x: number, width: number, startY: number) {
  const y = table.title ? drawTitleAt(doc, pdfText(table.title), x, startY + 5) : startY + 2;
  const numericFrom = table.numericFrom ?? 1;
  autoTable(doc, {
    ...tableStyles(),
    startY: y,
    margin: {
      top: REPORT_PDF_CONTINUATION_TOP,
      left: x,
      right: reportPdfPageWidth(doc) - x - width,
      bottom: REPORT_PDF_FOOTER_RESERVED + 2,
    },
    tableWidth: width,
    head: table.head,
    body: table.body,
    foot: table.foot,
    didParseCell(data: CellHookData) {
      if (data.column.index >= numericFrom) data.cell.styles.halign = "right";
    },
  });
  return reportPdfLastTableY(doc, y);
}

/** Dos columnas: la de la derecha arranca a la misma altura que la izquierda. */
function drawPair(doc: jsPDF, left: SideTable[], right: SideTable[], startY: number) {
  const width = (reportPdfPageWidth(doc) - REPORT_PDF_PAGE_MARGIN * 2 - GAP) / 2;
  const rows = Math.max(
    left.reduce((sum, t) => sum + t.body.length + 3, 0),
    right.reduce((sum, t) => sum + t.body.length + 3, 0),
  );
  let y = ensureSpace(doc, startY, Math.min(rows * 4 + 12, 120));
  const page = doc.getNumberOfPages();
  let leftY = y;
  for (const table of left) leftY = drawSideTable(doc, table, REPORT_PDF_PAGE_MARGIN, width, leftY);
  const leftPage = doc.getNumberOfPages();
  doc.setPage(page);
  let rightY = y;
  for (const table of right) {
    rightY = drawSideTable(doc, table, REPORT_PDF_PAGE_MARGIN + width + GAP, width, rightY);
  }
  const rightPage = doc.getNumberOfPages();
  const lastPage = Math.max(leftPage, rightPage);
  doc.setPage(lastPage);
  if (leftPage === rightPage) y = Math.max(leftY, rightY);
  else y = leftPage > rightPage ? leftY : rightY;
  return y + 2;
}

function routeTotalsFoot(multi: boolean, cells: string[]): RowInput[] | undefined {
  return multi ? [["Total", ...cells]] : undefined;
}

function sumOf<Row>(rows: Row[], pick: (row: Row) => number) {
  return rows.reduce((sum, row) => sum + pick(row), 0);
}

function drawSheet(doc: jsPDF, report: WeeklyReport, startY: number) {
  const multi = report.routes.length > 1;
  const digital = report.scope === "a" ? "Nequi" : "Banco";

  let y = drawReportSectionTitle(doc, `Informe semanal · ${weeklyScopeTitle(report)}`, startY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...REPORT_PDF_THEME.muted);
  doc.text(pdfText(weeklyRangeLabel(report.range)), REPORT_PDF_PAGE_MARGIN, y);
  y += 5;

  y = drawReportSectionTitle(doc, "1. Cartera al corte", y + 2);
  y = drawCartera(doc, report.cartera, y);
  if (multi) {
    y = ensureSpace(doc, y, 8);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...REPORT_PDF_THEME.ink);
    doc.text(`Cartera total M + T + N: ${num(report.carteraTotal)}`, REPORT_PDF_PAGE_MARGIN, y + 5);
    y += 8;
  }

  const caja: SideTable = {
    title: "2. Caja de la semana",
    head: [["Ruta", "Inicial", "Cobró ef.", "Prestó ef.", "Gastó", "Ajustes / dif.", "Saldo final"]],
    body: report.caja.map((row) => [
      row.sub ? `   ${row.label}` : row.label,
      row.sub ? "" : num(row.opening),
      num(row.efectivo),
      num(row.prestamos),
      num(row.gastos),
      row.sub || row.ajustes === 0 ? "" : num(row.ajustes),
      row.sub ? "" : num(row.closing),
    ]),
  };
  const cobros: SideTable = {
    title: "3. Cobros",
    head: [["Ruta", "Efectivo", digital, "Total"]],
    body: report.cobros.map((row) => [row.route, num(row.efectivo), num(row.digital), num(row.total)]),
    foot: routeTotalsFoot(multi, [
      num(sumOf(report.cobros, (r) => r.efectivo)),
      num(sumOf(report.cobros, (r) => r.digital)),
      num(sumOf(report.cobros, (r) => r.total)),
    ]),
  };
  const prestamos: SideTable = {
    title: "4. Préstamos",
    head: [["Ruta", "Cant.", "Capital", "Efectivo", digital]],
    body: report.prestamos.map((row) => [
      row.route,
      String(row.count),
      num(row.capital),
      num(row.efectivo),
      num(row.digital),
    ]),
    foot: routeTotalsFoot(multi, [
      String(sumOf(report.prestamos, (r) => r.count)),
      num(sumOf(report.prestamos, (r) => r.capital)),
      num(sumOf(report.prestamos, (r) => r.efectivo)),
      num(sumOf(report.prestamos, (r) => r.digital)),
    ]),
  };
  const gastos: SideTable = {
    title: "5. Gastos (solo operativos)",
    head: [["Tipo", ...report.routes, ...(multi ? ["Total"] : [])]],
    body: report.gastos.length
      ? report.gastos.map((row) => [
          row.label,
          ...report.routes.map((route) => num(row.byRoute[route] ?? 0)),
          ...(multi ? [num(row.total)] : []),
        ])
      : [[{ content: "Sin gastos en la semana.", colSpan: report.routes.length + (multi ? 2 : 1) }]],
  };
  const pool: SideTable = {
    title: `6. ${report.pool.label}`,
    body: [
      ["Inicio de semana", num(report.pool.opening)],
      ["Entró (cobros)", num(report.pool.entro)],
      ["Salió (préstamos)", num(report.pool.salio)],
      ...(report.pool.ajustes !== 0 ? [["Ajustes / otros", num(report.pool.ajustes)]] : []),
    ],
    foot: [["Acumulado al corte", num(report.pool.closing)]],
  };
  const novedades: SideTable = {
    title: "Novedades",
    body: report.novedades.length
      ? report.novedades.map((line) => [pdfText(line)])
      : [["Sin novedades en la semana."]],
    numericFrom: 99,
  };
  const resumen: SideTable = {
    title: "7. Resumen al corte",
    body: report.resumen.map((row) =>
      row.kind === "section"
        ? [{ content: row.label.toUpperCase(), colSpan: 2, styles: { fontStyle: "bold", fillColor: REPORT_PDF_THEME.rowA } }]
        : [
            { content: row.label, styles: { fontStyle: row.tone === "sub" ? "normal" : "bold" } },
            { content: num(row.value), styles: { fontStyle: row.tone === "sub" ? "normal" : "bold" } },
          ],
    ),
  };
  const movimiento: SideTable[] = report.movimiento.map((move, index) => ({
    title: index === 0 ? "Movimiento de la semana" : "",
    head: [[move.label, ...report.routes, ...(multi ? ["Total"] : [])]],
    body: move.days.length
      ? move.days.map((day) => [
          shortDate(day.date),
          ...report.routes.map((route) => num(day.values[route] ?? 0)),
          ...(multi ? [num(day.total)] : []),
        ])
      : [[{ content: "Sin movimiento.", colSpan: report.routes.length + (multi ? 2 : 1) }]],
    foot: [["Semana", ...(multi ? report.routes.map(() => "") : []), num(move.total)]],
  }));

  y = drawPair(doc, [caja], [cobros], y);
  y = drawPair(doc, [prestamos], [gastos], y);
  y = drawPair(doc, [pool], [novedades], y);
  y = drawPair(doc, [resumen], movimiento, y);
  return y;
}

export type WeeklyReportPdfOptions = {
  logoDataUrl?: string | null;
  generatedLabel: string;
};

/** Una hoja horizontal por informe; devuelve los bytes del PDF. */
export function buildWeeklyReportPdf(report: WeeklyReport, options: WeeklyReportPdfOptions): ArrayBuffer {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const subtitle = pdfText(`Informe semanal · ${weeklyScopeTitle(report)} · ${weeklyRangeLabel(report.range)}`);
  drawSheet(doc, report, REPORT_PDF_CONTENT_TOP);
  stampReportFirstPageHeader(doc, subtitle, options.logoDataUrl);
  stampReportAllFooters(doc, options.generatedLabel);
  return doc.output("arraybuffer");
}
