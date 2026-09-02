"use client";

import { useMemo } from "react";
import type { BankAccount, BankMovement } from "@/lib/bank";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import {
  bankMovementsWithDisplayBalance,
  expenseCategoryLabel,
  formatBankAmount,
  isoToDisplay,
  normalizeBankMovements,
  paymentRefForMovement,
  movementDisplayRef,
  summarizeMovements,
} from "@/lib/bank";
import { BANK_RECORD_COLUMNS, BANK_RECORD_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  accounts: BankAccount[];
  movements: BankMovement[];
  onOpenPeriod: (accountRef: string, period: string) => void;
  onOpenPaymentFicha?: (paymentRef: string) => void;
  onOpenExpense?: (row: BankMovement) => void;
};

export function BankRecordsHistoryView({
  accounts,
  movements,
  onOpenPeriod,
  onOpenPaymentFicha,
  onOpenExpense,
}: Props) {
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    BANK_RECORD_COLUMNS,
    BANK_RECORD_DEFAULT_COLS,
    { storageKey: "nexo.banco.registros.columns" },
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((row) => [row.ref, row.name])),
    [accounts],
  );

  const openingTotal = useMemo(
    () => accounts.reduce((sum, row) => sum + row.openingBalance, 0),
    [accounts],
  );

  const allRows = useMemo(() => normalizeBankMovements(movements), [movements]);
  const { sortKey, sortDir, toggleSort } = useBankMovementSort("valueDate");

  const history = useMemo(
    () => bankMovementsWithDisplayBalance(allRows, sortKey, sortDir, openingTotal),
    [allRows, openingTotal, sortKey, sortDir],
  );

  const summary = useMemo(() => summarizeMovements(allRows), [allRows]);

  function openRowTarget(row: (typeof history)[number]) {
    const paymentRef = paymentRefForMovement(row);
    if (paymentRef && row.credit > 0 && onOpenPaymentFicha) {
      onOpenPaymentFicha(paymentRef);
      return;
    }
    if (row.debit > 0 && onOpenExpense) {
      onOpenExpense(row);
      return;
    }
    onOpenPeriod(row.accountRef, row.period);
  }

  return (
    <section className="panel bank-records-panel">
      <div className="head">
        <h1>Registros</h1>
        <span className="count">{history.length}</span>
        <div className="grow" />
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        <ColumnPicker
          columns={BANK_RECORD_COLUMNS}
          visibleCols={visibleCols}
          onToggle={toggleColumn}
        />
      </div>

      <div className="bank-table-wrap bank-records-table-wrap">
        <table className="bank-table bank-records-table">
          <thead>
            <tr className="col-titles">
              {isVisible("ref") ? <th>Ref.</th> : null}
              {isVisible("description") ? <th>Descripción</th> : null}
              {isVisible("valueDate") ? (
                <BankSortTh
                  label="Fecha valor"
                  column="valueDate"
                  activeColumn={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                />
              ) : null}
              {isVisible("account") ? <th>Cuenta</th> : null}
              {isVisible("thirdParty") ? <th>Tercero</th> : null}
              {isVisible("debit") ? (
                <BankSortTh
                  label="Debe"
                  column="debit"
                  activeColumn={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
              ) : null}
              {isVisible("credit") ? (
                <BankSortTh
                  label="Haber"
                  column="credit"
                  activeColumn={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
              ) : null}
              {isVisible("balance") ? <th className="bank-num">Saldo</th> : null}
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length}>Aún no hay registros generados.</td>
              </tr>
            ) : (
              history.map((row) => {
                const isExpense = row.debit > 0;
                const paymentRef = paymentRefForMovement(row);
                return (
                  <tr
                    key={row.ref}
                    className={isExpense ? "bank-row-expense" : "bank-row-income"}
                    onClick={() => openRowTarget(row)}
                    style={{ cursor: "pointer" }}
                  >
                    {isVisible("ref") ? (
                      <td className="ref">
                        {paymentRef && row.credit > 0 && onOpenPaymentFicha ? (
                          <button
                            type="button"
                            className="btn-link bank-extract-ref-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenPaymentFicha(paymentRef);
                            }}
                          >
                            {paymentRef}
                          </button>
                        ) : row.debit > 0 && onOpenExpense ? (
                          <button
                            type="button"
                            className="btn-link bank-extract-ref-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenExpense(row);
                            }}
                          >
                            {movementDisplayRef(row)}
                          </button>
                        ) : row.debit > 0 ? (
                          movementDisplayRef(row)
                        ) : (
                          paymentRef ?? row.ref.slice(-6)
                        )}
                      </td>
                    ) : null}
                    {isVisible("description") ? (
                      <td>
                        {row.description}
                        {row.category ? (
                          <span className="bank-category">{expenseCategoryLabel(row.category)}</span>
                        ) : null}
                      </td>
                    ) : null}
                    {isVisible("valueDate") ? <td>{isoToDisplay(row.valueDate)}</td> : null}
                    {isVisible("account") ? (
                      <td>{accountMap.get(row.accountRef) ?? row.accountRef}</td>
                    ) : null}
                    {isVisible("thirdParty") ? <td>{row.thirdParty}</td> : null}
                    {isVisible("debit") ? (
                      <td className="bank-num bank-debit">
                        {row.debit > 0 ? formatBankAmount(row.debit) : "—"}
                      </td>
                    ) : null}
                    {isVisible("credit") ? (
                      <td className="bank-num bank-credit">
                        {row.credit > 0 ? formatBankAmount(row.credit) : "—"}
                      </td>
                    ) : null}
                    {isVisible("balance") ? (
                      <td className="bank-num bank-balance">{formatBankAmount(row.runningBalance)}</td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
          {history.length > 0 ? (
            <tfoot>
              <tr className="bank-total-row">
                <td colSpan={["ref", "description", "valueDate", "account", "thirdParty"].filter((id) => isVisible(id)).length}>
                  Total
                </td>
                {isVisible("debit") ? (
                  <td className="bank-num">{formatBankAmount(summary.totalDebit)}</td>
                ) : null}
                {isVisible("credit") ? (
                  <td className="bank-num">{formatBankAmount(summary.totalCredit)}</td>
                ) : null}
                {isVisible("balance") ? (
                  <td className="bank-num">{formatBankAmount(openingTotal + summary.balance)}</td>
                ) : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
