"use client";

import { FileMiniIcon, SearchIcon } from "@/components/icons";
import { Pill } from "@/components/ui";
import { loanStatusPill } from "@/lib/loan-status";
import { money, type LoanRow } from "@/lib/mock-data";

type Props = {
  title: string;
  allLabel: string;
  rows: LoanRow[];
  empty: string;
  amount: "balance" | "capital";
  onOpen: (ref: string) => void;
  onAll: () => void;
};

export function MiniLoanList({ title, allLabel, rows, empty, amount, onOpen, onAll }: Props) {
  return (
    <div className="mini-block">
      <div className="mini-head">
        <h2>{title}</h2>
        <button type="button" className="mini-all" onClick={onAll}>
          {allLabel}
          <span className="mini-badge">{rows.length}</span>
        </button>
      </div>
      <div className="table-wrap">
        <table className="data mini-grid">
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5}>{empty}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.ref} onClick={() => onOpen(row.ref)}>
                  <td>
                    <span className="cell-with-ico">
                      <FileMiniIcon />
                      <span className="ref">{row.ref}</span>
                      <span className="mini-search" title="Abrir">
                        <SearchIcon size={13} />
                      </span>
                    </span>
                  </td>
                  <td>{row.date}</td>
                  <td>{row.due}</td>
                  <td className="money right">{money(row[amount])}</td>
                  <td>
                    <Pill label={loanStatusPill(row).label} kind={loanStatusPill(row).kind} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
