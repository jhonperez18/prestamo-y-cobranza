"use client";

import { Pill } from "@/components/ui";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { LOAN_FICHA_COLUMNS, loanFichaRow, sortLoansForFicha, syncLoan } from "@/lib/loan-preview";
import { loanStatusPill } from "@/lib/loan-status";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";

type Props = {
  loans: LoanRow[];
  payments: PaymentRow[];
  selectedRef?: string;
  onSelect: (ref: string) => void;
};

function alignClass(align: "left" | "right" | "center") {
  if (align === "right") return "align-right";
  if (align === "center") return "align-center";
  return "align-left";
}

export function LoanFichaGrid({ loans, payments, selectedRef, onSelect }: Props) {
  const ordered = sortLoansForFicha(loans);

  return (
    <div className="loan-ficha-grid mini-block">
      <div className="table-wrap">
        <table className="data mini-grid loan-ficha-table">
          <colgroup>
            {LOAN_FICHA_COLUMNS.map((col) => (
              <col key={col.id} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="col-titles">
              {LOAN_FICHA_COLUMNS.map((col) => (
                <th
                  key={col.id}
                  className={alignClass(col.align)}
                  title={"title" in col ? col.title : undefined}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={LOAN_FICHA_COLUMNS.length}>Este cliente no tiene préstamos registrados.</td>
              </tr>
            ) : (
              ordered.map((loan) => {
                const synced = syncLoan(loan, payments) as LoanRow;
                const financials = computeLoanFinancials(synced, payments);
                const cells = loanFichaRow(synced, money, {
                  paid: financials.paidTotal,
                  pending: financials.balancePending,
                });
                const status = loanStatusPill(synced);
                const selected = loan.ref === selectedRef;
                return (
                  <tr
                    key={loan.ref}
                    className={selected ? "on" : undefined}
                    onClick={() => onSelect(loan.ref)}
                  >
                    {LOAN_FICHA_COLUMNS.map((col) => {
                      const cls = alignClass(col.align);
                      switch (col.id) {
                        case "estado":
                          return (
                            <td key={col.id} className={cls}>
                              <Pill label={status.label} kind={status.kind} />
                            </td>
                          );
                        case "ref":
                          return (
                            <td key={col.id} className={cls}>
                              <span className="ref">{cells.ref}</span>
                            </td>
                          );
                        default:
                          return (
                            <td key={col.id} className={`${cls} money`}>
                              {cells[col.id]}
                            </td>
                          );
                      }
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
