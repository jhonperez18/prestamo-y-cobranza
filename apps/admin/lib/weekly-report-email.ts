/**
 * Cuerpo del correo del informe semanal: el resumen de cada hoja.
 * El detalle completo va en los PDF adjuntos. Solo lee `WeeklyReport`.
 */
import { money } from "@/lib/mock-data";
import { weeklyRangeLabel, weeklyScopeTitle } from "@/lib/weekly-report-pdf";
import type { WeeklyReport } from "@/lib/weekly-report";

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function row(label: string, value: string, strong = false) {
  const weight = strong ? "font-weight:700;" : "";
  return `<tr><td style="padding:3px 10px 3px 0;${weight}">${escapeHtml(label)}</td><td style="padding:3px 0;text-align:right;${weight}">${escapeHtml(value)}</td></tr>`;
}

function sheetHtml(report: WeeklyReport) {
  const cobrado = report.cobros.reduce((sum, r) => sum + r.total, 0);
  const prestado = report.prestamos.reduce((sum, r) => sum + r.capital, 0);
  const prestamos = report.prestamos.reduce((sum, r) => sum + r.count, 0);
  const gastado = report.gastos.reduce((sum, r) => sum + r.total, 0);
  const resumen = report.resumen
    .map((line) =>
      line.kind === "section"
        ? `<tr><td colspan="2" style="padding:8px 0 2px;color:#5b7268;font-size:12px;text-transform:uppercase">${escapeHtml(line.label)}</td></tr>`
        : row(line.label, `$ ${money(line.value)}`, line.tone !== "sub"),
    )
    .join("");
  const novedades = report.novedades.length
    ? `<ul style="margin:4px 0 0;padding-left:18px">${report.novedades.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : `<p style="margin:4px 0 0;color:#5b7268">Sin novedades en la semana.</p>`;
  return `
<h2 style="margin:22px 0 4px;font-size:17px;color:#14201b">${escapeHtml(weeklyScopeTitle(report))}</h2>
<table style="border-collapse:collapse;font-size:14px;min-width:300px">
${row("Cobrado en la semana", `$ ${money(cobrado)}`)}
${row(`Préstamos (${prestamos})`, `$ ${money(prestado)}`)}
${row("Gastos operativos", `$ ${money(gastado)}`)}
${resumen}
</table>
<h3 style="margin:14px 0 0;font-size:14px;color:#14201b">Novedades</h3>
${novedades}`;
}

export function weeklyReportEmailSubject(reports: WeeklyReport[], test: boolean) {
  const range = reports[0]?.range;
  const label = range ? weeklyRangeLabel(range).split(" · ").slice(0, 2).join(" · ") : "";
  return `${test ? "[Prueba] " : ""}Informe semanal · ${label}`;
}

export function weeklyReportEmailHtml(reports: WeeklyReport[]) {
  const range = reports[0]?.range;
  return `<!doctype html>
<html><body style="margin:0;padding:20px;background:#f2f9f9;font-family:Arial,Helvetica,sans-serif;color:#14201b">
<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #d5e2db;border-radius:10px;padding:22px">
<h1 style="margin:0;font-size:20px">CA préstamo · Informe semanal</h1>
<p style="margin:6px 0 0;color:#5b7268;font-size:13px">${range ? escapeHtml(weeklyRangeLabel(range)) : ""}</p>
${reports.map(sheetHtml).join("")}
<p style="margin:22px 0 0;color:#5b7268;font-size:12px">La hoja completa (cartera por cliente, caja, cobros, préstamos, gastos y movimiento diario) va en los PDF adjuntos.</p>
</div>
</body></html>`;
}
