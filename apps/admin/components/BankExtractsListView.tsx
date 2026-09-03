"use client";

import { useMemo, useState } from "react";
import { EditMiniIcon } from "@/components/icons";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import type { BankAccount, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  formatBankAmount,
  listAccountExtracts,
  normalizeBankAccount,
  renameAccountExtractPeriod,
} from "@/lib/bank";
import { BANK_EXTRACT_COLUMNS, BANK_EXTRACT_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  accounts: BankAccount[];
  accountRef: string;
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  onAccountChange: (ref: string) => void;
  onMovementsChange: (rows: BankMovement[]) => void;
  onReconciliationsChange: (rows: BankReconciliation[]) => void;
  onOpenExtract: (accountRef: string, period: string) => void;
  onToast: (message?: string) => void;
};

export function BankExtractsListView({
  accounts,
  accountRef,
  movements,
  reconciliations,
  onAccountChange,
  onMovementsChange,
  onReconciliationsChange,
  onOpenExtract,
  onToast,
}: Props) {
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    BANK_EXTRACT_COLUMNS,
    BANK_EXTRACT_DEFAULT_COLS,
    { storageKey: "nexo.banco.extractos.columns" },
  );

  const activeAccounts = useMemo(
    () => accounts.map(normalizeBankAccount).filter((row) => row.active),
    [accounts],
  );
  const account =
    activeAccounts.find((row) => row.ref === accountRef) ?? activeAccounts[0] ?? null;

  const rows = useMemo(() => {
    if (!account) return [];
    return listAccountExtracts(account.ref, account.openingBalance, movements, reconciliations);
  }, [account, movements, reconciliations]);

  const [editingPeriod, setEditingPeriod] = useState<string | null>(null);
  const [draftPeriod, setDraftPeriod] = useState("");

  const startEdit = (period: string) => {
    setEditingPeriod(period);
    setDraftPeriod(period);
  };

  const cancelEdit = () => {
    setEditingPeriod(null);
    setDraftPeriod("");
  };

  const saveEdit = (fromPeriod: string) => {
    if (!account) return;
    const result = renameAccountExtractPeriod(
      movements,
      reconciliations,
      account.ref,
      fromPeriod,
      draftPeriod,
    );
    if (!result.ok) {
      onToast(result.error);
      return;
    }
    onMovementsChange(result.movements);
    onReconciliationsChange(result.reconciliations);
    onToast(`Referencia actualizada a ${draftPeriod}.`);
    cancelEdit();
  };

  return (
    <section className="panel bank-extracts-panel">
      <div className="head">
        <h1>Extractos</h1>
        <span className="count">{rows.length}</span>
        <div className="grow" />
        {activeAccounts.length > 0 ? (
          <select
            className="bank-extract-select"
            value={account?.ref ?? ""}
            onChange={(event) => onAccountChange(event.target.value)}
            aria-label="Cuenta bancaria"
          >
            {activeAccounts.map((row) => (
              <option key={row.ref} value={row.ref}>
                {row.name} · {row.bankName}
              </option>
            ))}
          </select>
        ) : null}
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table className="data list-grid bank-extracts-table">
          <thead>
            <tr className="col-titles">
              {isVisible("period") ? <th>Ref.</th> : null}
              {isVisible("opening") ? <th className="right">Saldo inicial</th> : null}
              {isVisible("closing") ? <th className="right">Saldo final</th> : null}
              {isVisible("actions") ? <th className="bank-actions-head" aria-label="Acciones" /> : null}
              <ColumnPickerHeadCell>
                <ColumnPicker
                  columns={BANK_EXTRACT_COLUMNS}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </ColumnPickerHeadCell>
            </tr>
          </thead>
          <tbody>
            {!account ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>No hay cuentas activas. Cree una cuenta en Nueva cuenta.</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>
                  No hay extractos conciliados. El mes en curso aparece aquí cuando se concilie.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const editing = editingPeriod === row.period;
                return (
                  <tr
                    key={row.period}
                    className={row.closed ? "bank-extract-row-closed" : "bank-extract-row-open"}
                  >
                    {isVisible("period") ? (
                      <td className="ref">
                        {editing ? (
                          <input
                            className="bank-extract-ref-input"
                            type="month"
                            value={draftPeriod}
                            onChange={(event) => setDraftPeriod(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") saveEdit(row.period);
                              if (event.key === "Escape") cancelEdit();
                            }}
                            onBlur={() => saveEdit(row.period)}
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            className="btn-link bank-extract-ref-link"
                            onClick={() => onOpenExtract(account.ref, row.period)}
                          >
                            {row.period}
                          </button>
                        )}
                      </td>
                    ) : null}
                    {isVisible("opening") ? (
                      <td className="money right bank-extract-money">
                        {formatBankAmount(row.openingBalance)}
                      </td>
                    ) : null}
                    {isVisible("closing") ? (
                      <td className="money right bank-extract-money">
                        {formatBankAmount(row.closingBalance)}
                      </td>
                    ) : null}
                    {isVisible("actions") ? (
                      <td className="bank-row-actions center">
                        {!editing ? (
                          <button
                            type="button"
                            className="bank-icon-btn"
                            title="Modificar referencia del extracto (año-mes)"
                            onClick={() => startEdit(row.period)}
                          >
                            <EditMiniIcon />
                          </button>
                        ) : null}
                      </td>
                    ) : null}
                    <ColumnPickerBodyCell />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
