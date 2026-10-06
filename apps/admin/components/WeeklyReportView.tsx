"use client";

/**
 * Reportes → Informes → Semanal. Vista previa de la hoja (corte sábado) con datos reales.
 * Todas las cifras salen de `buildWeeklyReport`; esta vista solo pinta.
 */
import { useMemo, useState } from "react";
import { businessTodayIso } from "@/lib/business-timezone";
import { isoToDisplay } from "@/lib/loan-preview";
import { money } from "@/lib/mock-data";
import { weekdayLabel } from "@/lib/colombia-holidays";
import {
  buildWeeklyReport,
  recentWeeklyCortes,
  weeklyRangeForSaturday,
  type WeeklyReport,
  type WeeklyReportScope,
  type WeeklyReportSources,
  type WeeklyRouteCartera,
} from "@/lib/weekly-report";

type Props = WeeklyReportSources;

const SCOPES: { id: WeeklyReportScope; label: string }[] = [
  { id: "mtn", label: "M · T · N" },
  { id: "a", label: "A" },
];

const MARK_LEGEND = "N nuevo · R renovación · F terminó · A anexo · NP no pagó en la semana";

function num(value: number | null) {
  return value == null ? "–" : money(value, { symbol: false });
}

function shortDate(iso: string) {
  return isoToDisplay(iso).slice(0, 5);
}

function SectionTitle({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <h3 className="weekly-report-section">
      <span>{n}.</span> {title}
      {note ? <small>{note}</small> : null}
    </h3>
  );
}

function CarteraTable({ cartera }: { cartera: WeeklyRouteCartera[] }) {
  const height = Math.max(0, ...cartera.map((route) => route.rows.length));
  return (
    <table className="weekly-report-table is-cartera">
      <thead>
        <tr>
          {cartera.map((route) => (
            <th key={route.route} colSpan={5} className="is-route">
              Ruta {route.route}
              {route.collectorName ? ` · ${route.collectorName}` : ""}
            </th>
          ))}
        </tr>
        <tr>
          {cartera.map((route) => [
            <th key={`${route.route}-n`} className="is-pos">#</th>,
            <th key={`${route.route}-c`}>Cliente</th>,
            <th key={`${route.route}-d`} className="is-num">Debe al corte</th>,
            <th key={`${route.route}-p`} className="is-num">Pagó semana</th>,
            <th key={`${route.route}-m`} className="is-mark">Marca</th>,
          ])}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: height }, (_, index) => (
          <tr key={index}>
            {cartera.map((route) => {
              const row = route.rows[index];
              if (!row) {
                return [0, 1, 2, 3, 4].map((cell) => <td key={`${route.route}-${cell}`} className="is-blank" />);
              }
              return [
                <td key={`${route.route}-n`} className="is-pos">{row.order || index + 1}</td>,
                <td key={`${route.route}-c`} className="is-name">{row.name}</td>,
                <td key={`${route.route}-d`} className="is-num">{num(row.debt)}</td>,
                <td key={`${route.route}-p`} className="is-num">{row.paidWeek > 0 ? num(row.paidWeek) : "–"}</td>,
                <td key={`${route.route}-m`} className="is-mark">{row.marks.join(" ")}</td>,
              ];
            })}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          {cartera.map((route) => [
            <td key={`${route.route}-t`} colSpan={2}>
              Total · {route.rows.length} clientes · {route.owing} deben
            </td>,
            <td key={`${route.route}-v`} className="is-num">{num(route.total)}</td>,
            <td key={`${route.route}-e`} colSpan={2} />,
          ])}
        </tr>
      </tfoot>
    </table>
  );
}

function ReportSheet({ report }: { report: WeeklyReport }) {
  const { range } = report;
  const multi = report.routes.length > 1;
  return (
    <article className="weekly-report-sheet">
      <header className="weekly-report-head">
        <h2>Informe semanal · {report.scope === "a" ? "Ruta A" : "Rutas M · T · N"}</h2>
        <p>
          Semana {shortDate(range.start)} – {shortDate(range.end)}/{range.end.slice(0, 4)} · corte{" "}
          {weekdayLabel(range.end)} {shortDate(range.end)}
          {range.partial ? " · semana en curso (hasta hoy)" : ""}
          {range.holidays.length
            ? ` · festivo: ${range.holidays.map((day) => `${weekdayLabel(day)} ${shortDate(day)}`).join(", ")}`
            : ""}
        </p>
      </header>

      <SectionTitle n={1} title="Cartera al corte" note="lo que debe cada cliente" />
      <CarteraTable cartera={report.cartera} />
      <p className="weekly-report-legend">
        Marcas: {MARK_LEGEND}
        {multi ? ` · Cartera total M + T + N: ${num(report.carteraTotal)}` : ""}
      </p>

      <div className="weekly-report-grid">
        <section>
          <SectionTitle n={2} title="Caja de la semana" />
          <table className="weekly-report-table">
            <thead>
              <tr>
                <th>Ruta</th>
                <th className="is-num">Inicial</th>
                <th className="is-num">Cobró ef.</th>
                <th className="is-num">Prestó ef.</th>
                <th className="is-num">Gastó</th>
                <th className="is-num">Ajustes / dif.</th>
                <th className="is-num">Saldo final</th>
              </tr>
            </thead>
            <tbody>
              {report.caja.map((row) => (
                <tr key={row.label} className={row.sub ? "is-sub" : undefined}>
                  <td>{row.label}</td>
                  <td className="is-num">{row.sub ? "" : num(row.opening)}</td>
                  <td className="is-num">{num(row.efectivo)}</td>
                  <td className="is-num">{num(row.prestamos)}</td>
                  <td className="is-num">{num(row.gastos)}</td>
                  <td className="is-num">{row.sub || row.ajustes === 0 ? "" : num(row.ajustes)}</td>
                  <td className="is-num">{row.sub ? "" : num(row.closing)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <SectionTitle n={3} title="Cobros" />
          <table className="weekly-report-table">
            <thead>
              <tr>
                <th>Ruta</th>
                <th className="is-num">Efectivo</th>
                <th className="is-num">{report.scope === "a" ? "Nequi" : "Banco"}</th>
                <th className="is-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.cobros.map((row) => (
                <tr key={row.route}>
                  <td>{row.route}</td>
                  <td className="is-num">{num(row.efectivo)}</td>
                  <td className="is-num">{num(row.digital)}</td>
                  <td className="is-num">{num(row.total)}</td>
                </tr>
              ))}
            </tbody>
            {multi ? (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="is-num">{num(report.cobros.reduce((s, r) => s + r.efectivo, 0))}</td>
                  <td className="is-num">{num(report.cobros.reduce((s, r) => s + r.digital, 0))}</td>
                  <td className="is-num">{num(report.cobros.reduce((s, r) => s + r.total, 0))}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </section>

        <section>
          <SectionTitle n={4} title="Préstamos" />
          <table className="weekly-report-table">
            <thead>
              <tr>
                <th>Ruta</th>
                <th className="is-num">Cant.</th>
                <th className="is-num">Capital</th>
                <th className="is-num">Efectivo</th>
                <th className="is-num">{report.scope === "a" ? "Nequi" : "Banco"}</th>
              </tr>
            </thead>
            <tbody>
              {report.prestamos.map((row) => (
                <tr key={row.route}>
                  <td>{row.route}</td>
                  <td className="is-num">{row.count}</td>
                  <td className="is-num">{num(row.capital)}</td>
                  <td className="is-num">{num(row.efectivo)}</td>
                  <td className="is-num">{num(row.digital)}</td>
                </tr>
              ))}
            </tbody>
            {multi ? (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="is-num">{report.prestamos.reduce((s, r) => s + r.count, 0)}</td>
                  <td className="is-num">{num(report.prestamos.reduce((s, r) => s + r.capital, 0))}</td>
                  <td className="is-num">{num(report.prestamos.reduce((s, r) => s + r.efectivo, 0))}</td>
                  <td className="is-num">{num(report.prestamos.reduce((s, r) => s + r.digital, 0))}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </section>

        <section>
          <SectionTitle n={5} title="Gastos" note="solo operativos" />
          <table className="weekly-report-table">
            <thead>
              <tr>
                <th>Tipo</th>
                {report.routes.map((route) => (
                  <th key={route} className="is-num">{route}</th>
                ))}
                {multi ? <th className="is-num">Total</th> : null}
              </tr>
            </thead>
            <tbody>
              {report.gastos.length === 0 ? (
                <tr>
                  <td colSpan={report.routes.length + (multi ? 2 : 1)} className="is-empty">
                    Sin gastos en la semana.
                  </td>
                </tr>
              ) : (
                report.gastos.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {report.routes.map((route) => (
                      <td key={route} className="is-num">{num(row.byRoute[route] ?? 0)}</td>
                    ))}
                    {multi ? <td className="is-num">{num(row.total)}</td> : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <section>
          <SectionTitle n={6} title={report.pool.label} />
          <table className="weekly-report-table">
            <tbody>
              <tr>
                <td>Inicio de semana</td>
                <td className="is-num">{num(report.pool.opening)}</td>
              </tr>
              <tr>
                <td>Entró (cobros)</td>
                <td className="is-num">{num(report.pool.entro)}</td>
              </tr>
              <tr>
                <td>Salió (préstamos)</td>
                <td className="is-num">{num(report.pool.salio)}</td>
              </tr>
              {report.pool.ajustes !== 0 ? (
                <tr>
                  <td>Ajustes / otros</td>
                  <td className="is-num">{num(report.pool.ajustes)}</td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td>Acumulado al corte</td>
                <td className="is-num">{num(report.pool.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h3 className="weekly-report-section">Novedades</h3>
          {report.novedades.length === 0 ? (
            <p className="weekly-report-empty">Sin novedades en la semana.</p>
          ) : (
            <ul className="weekly-report-novedades">
              {report.novedades.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="weekly-report-grid is-final">
        <section>
          <SectionTitle n={7} title="Resumen al corte" />
          <table className="weekly-report-table is-resumen">
            <tbody>
              {report.resumen.map((row, index) =>
                row.kind === "section" ? (
                  <tr key={`s-${row.label}`} className="is-section">
                    <td colSpan={2}>{row.label}</td>
                  </tr>
                ) : (
                  <tr key={`l-${index}`} className={row.tone ? `is-${row.tone}` : undefined}>
                    <td>{row.label}</td>
                    <td className="is-num">{num(row.value)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
        <section>
          <h3 className="weekly-report-section">Movimiento de la semana</h3>
          {report.movimiento.map((move) => (
            <table key={move.kind} className={`weekly-report-table is-move is-${move.kind}`}>
              <thead>
                <tr>
                  <th>{move.label}</th>
                  {report.routes.map((route) => (
                    <th key={route} className="is-num">{route}</th>
                  ))}
                  {multi ? <th className="is-num">Total</th> : null}
                </tr>
              </thead>
              <tbody>
                {move.days.length === 0 ? (
                  <tr>
                    <td colSpan={report.routes.length + (multi ? 2 : 1)} className="is-empty">
                      Sin movimiento.
                    </td>
                  </tr>
                ) : (
                  move.days.map((day) => (
                    <tr key={day.date}>
                      <td>{shortDate(day.date)}</td>
                      {report.routes.map((route) => (
                        <td key={route} className="is-num">{num(day.values[route] ?? 0)}</td>
                      ))}
                      {multi ? <td className="is-num">{num(day.total)}</td> : null}
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Semana</td>
                  {multi ? <td colSpan={report.routes.length} /> : null}
                  <td className="is-num">{num(move.total)}</td>
                </tr>
              </tfoot>
            </table>
          ))}
        </section>
      </div>
    </article>
  );
}

export function WeeklyReportView({
  payments,
  loans,
  clients,
  collectors,
  routes,
  assignments,
  dayCloses,
  dayExpenseDrafts,
  planillaCashCloses,
  monthCloses,
}: Props) {
  const today = businessTodayIso();
  const cortes = useMemo(() => recentWeeklyCortes(today), [today]);
  const [saturday, setSaturday] = useState(() => cortes[cortes[0] > today ? 1 : 0] ?? cortes[0]);
  const [scope, setScope] = useState<WeeklyReportScope>("mtn");
  const range = useMemo(() => weeklyRangeForSaturday(saturday, today), [saturday, today]);
  const report = useMemo(
    () =>
      buildWeeklyReport(
        {
          payments,
          loans,
          clients,
          collectors,
          routes,
          assignments,
          dayCloses,
          dayExpenseDrafts,
          planillaCashCloses,
          monthCloses,
        },
        scope,
        range,
        today,
      ),
    [
      payments,
      loans,
      clients,
      collectors,
      routes,
      assignments,
      dayCloses,
      dayExpenseDrafts,
      planillaCashCloses,
      monthCloses,
      scope,
      range,
      today,
    ],
  );

  return (
    <section className="panel weekly-report">
      <div className="weekly-report-toolbar">
        <label>
          <span>Semana (corte sábado)</span>
          <select value={saturday} onChange={(event) => setSaturday(event.target.value)}>
            {cortes.map((day) => {
              const week = weeklyRangeForSaturday(day, today);
              return (
                <option key={day} value={day}>
                  {shortDate(week.start)} – {isoToDisplay(day)}
                  {week.partial ? " (en curso)" : ""}
                </option>
              );
            })}
          </select>
        </label>
        <div className="weekly-report-scopes" role="tablist">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={scope === item.id}
              className={scope === item.id ? "on" : undefined}
              onClick={() => setScope(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="weekly-report-hint">Vista previa de la hoja. El envío por correo se arma después.</p>
      </div>
      <ReportSheet report={report} />
    </section>
  );
}
