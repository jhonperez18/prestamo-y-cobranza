"use client";

import { useMemo } from "react";
import type { BankLedgerKind, BankMovement } from "@/lib/bank";
import {
  buildAccountingReport,
  formatBankAmount,
  formatReportCell,
  periodFromReportCell,
} from "@/lib/bank";

type Props = {
  movements: BankMovement[];
  onOpenLedger: (kind: BankLedgerKind, period: string) => void;
};

/** Orden calendario: enero → diciembre */
const CALENDAR_MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function capitalizeLabel(label: string) {
  if (!label) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function ReportAmountCell({
  value,
  kind,
  period,
  onOpenLedger,
}: {
  value: number;
  kind: BankLedgerKind;
  period: string;
  onOpenLedger: (kind: BankLedgerKind, period: string) => void;
}) {
  if (!value) return <>{formatReportCell(0)}</>;
  return (
    <button
      type="button"
      className="btn-link bank-report-cell-link"
      title={`Ver ${kind === "expense" ? "gastos" : "ingresos"} de ${period}`}
      onClick={() => onOpenLedger(kind, period)}
    >
      {formatReportCell(value)}
    </button>
  );
}

export function BankReportView({ movements, onOpenLedger }: Props) {
  const years = useMemo(() => buildAccountingReport(movements), [movements]);

  return (
    <section className="panel bank-report-panel">
      <div className="head">
        <h1>Resultado del ejercicio</h1>
        <p className="bank-history-hint">
          Historial contable del sistema · incluye movimientos pendientes y conciliados.
        </p>
      </div>

      <div className="bank-report-wrap">
        <table className="bank-report-table">
          <thead>
            <tr>
              <th className="bank-report-mes-head" rowSpan={2}>
                Mes
              </th>
              {years.map((year) => (
                <th key={year.key} colSpan={2} className="bank-report-year-head">
                  {year.label}
                </th>
              ))}
            </tr>
            <tr>
              {years.flatMap((year) => [
                <th key={`${year.key}-g`} className="bank-report-sub-head">
                  Gastos
                </th>,
                <th key={`${year.key}-i`} className="bank-report-sub-head">
                  Ingresos
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {CALENDAR_MONTHS.map((label, index) => (
              <tr key={label}>
                <td className="bank-report-mes">{capitalizeLabel(label)}</td>
                {years.flatMap((year) => {
                  const monthData = year.months.find((entry) => entry.month === index + 1);
                  const period = periodFromReportCell(year.key, index + 1);
                  return [
                    <td key={`${year.key}-${label}-g`} className="bank-num">
                      <ReportAmountCell
                        value={monthData?.gastos ?? 0}
                        kind="expense"
                        period={period}
                        onOpenLedger={onOpenLedger}
                      />
                    </td>,
                    <td key={`${year.key}-${label}-i`} className="bank-num">
                      <ReportAmountCell
                        value={monthData?.ingresos ?? 0}
                        kind="income"
                        period={period}
                        onOpenLedger={onOpenLedger}
                      />
                    </td>,
                  ];
                })}
              </tr>
            ))}
            <tr className="bank-report-total">
              <td className="bank-report-mes">Total</td>
              {years.flatMap((year) => [
                <td key={`${year.key}-tg`} className="bank-num">
                  {year.totalGastos ? formatBankAmount(year.totalGastos) : "0"}
                </td>,
                <td key={`${year.key}-ti`} className="bank-num">
                  {year.totalIngresos ? formatBankAmount(year.totalIngresos) : "0"}
                </td>,
              ])}
            </tr>
            <tr className="bank-report-result">
              <td className="bank-report-mes">Resultado contable</td>
              {years.map((year) => (
                <td key={`${year.key}-r`} colSpan={2} className="bank-num">
                  {year.resultado ? formatBankAmount(year.resultado) : "0"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
