"use client";

import { money } from "@/lib/mock-data";
import { chargeLabel, isoToDisplay, type ChargeKind } from "@/lib/loan-preview";

export type LoanScheduleLine = {
  date: string;
  amount: number;
  kind?: ChargeKind;
};

type Props = {
  schedule: LoanScheduleLine[];
  title?: string;
  compact?: boolean;
};

export function LoanScheduleTable({ schedule, title = "Fechas de cobro", compact }: Props) {
  if (schedule.length === 0) return null;

  return (
    <div className={`mini-block loan-schedule-block${compact ? " loan-schedule-compact" : ""}`}>
      <h2 className="detail-plain-title loan-schedule-title">{title}</h2>
      <div className="table-wrap pay-dates">
        <table className="data mini-grid">
          <thead>
            <tr className="col-titles">
              <th>N.º</th>
              <th>Fecha</th>
              <th>Concepto</th>
              <th className="right">A cobrar</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((line, index) => (
              <tr key={`${line.kind ?? "pago"}-${line.date}-${index}`}>
                <td>{index + 1}</td>
                <td>{isoToDisplay(line.date)}</td>
                <td>{chargeLabel(line.kind)}</td>
                <td className="money right">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
