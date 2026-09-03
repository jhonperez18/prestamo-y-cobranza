"use client";

import { useMemo } from "react";
import type { BankAccount, BankMovement } from "@/lib/bank";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import {
  bankMovementDescriptionText,
  bankMovementMethodLabel,
  bankMovementsWithDisplayBalance,
  expenseCategoryLabel,
  formatBankAmount,
  isBankExpenseMovement,
  isBankIncomeMovement,
  isoToDisplay,
  normalizeBankMovements,
  paymentRefForMovement,
  bankVisibleRef,
  summarizeMovements,
} from "@/lib/bank";
import { BANK_RECORD_COLUMNS, BANK_RECORD_DEFAULT_COLS } from "@/lib/table-columns";
import { paymentMethodKind } from "@/lib/payment-method";
import { Pill } from "@/components/ui";

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
    { storageKey: "nexo.banco.registros.columns.v3" },
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
    if (paymentRef && isBankIncomeMovement(row) && onOpenPaymentFicha) {
      onOpenPaymentFicha(paymentRef);
      return;
    }
    if (isBankExpenseMovement(row) && onOpenExpense) {
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
      </div>

      <div className="bank-table-wrap bank-records-table-wrap">
        <table className="bank-table bank-records-table">
          <colgroup>
            {isVisible("ref") ? <col className="br-ref" /> : null}
            {isVisible("description") ? <col className="br-desc" /> : null}
            {isVisible("method") ? <col className="br-method" /> : null}
            {isVisible("valueDate") ? <col className="br-date" /> : null}
            {isVisible("account") ? <col className="br-account" /> : null}
            {isVisible("thirdParty") ? <col className="br-third" /> : null}
            {isVisible("debit") ? <col className="br-debit" /> : null}
            {isVisible("credit") ? <col className="br-credit" /> : null}
            {isVisible("balance") ? <col className="br-balance" /> : null}
            {isVisible("extract") ? <col className="br-extract" /> : null}
            <col className="br-picker" />
          </colgroup>
          <thead>
            <tr className="col-titles">
              {isVisible("ref") ? <th>Ref.</th> : null}
              {isVisible("description") ? <th>Descripción</th> : null}
              {isVisible("method") ? <th>Método</th> : null}
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
              {isVisible("extract") ? <th className="center">Extracto</th> : null}
              <ColumnPickerHeadCell>
                <ColumnPicker
                  columns={BANK_RECORD_COLUMNS}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </ColumnPickerHeadCell>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>Aún no hay registros generados.</td>
              </tr>
            ) : (
              history.map((row) => {
                const isExpense = isBankExpenseMovement(row);
                const paymentRef = paymentRefForMovement(row);
                const methodLabel = bankMovementMethodLabel(row.description);
                return (
                  <tr
                    key={row.ref}
                    className={isExpense ? "bank-row-expense" : "bank-row-income"}
                    onClick={() => openRowTarget(row)}
                    style={{ cursor: "pointer" }}
                  >
                    {isVisible("ref") ? (
                      <td className="ref">
                        {paymentRef && isBankIncomeMovement(row) && onOpenPaymentFicha ? (
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
                        ) : isExpense && onOpenExpense ? (
                          <button
                            type="button"
                            className="btn-link bank-extract-ref-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenExpense(row);
                            }}
                          >
                            {bankVisibleRef(row)}
                          </button>
                        ) : (
                          bankVisibleRef(row)
                        )}
                      </td>
                    ) : null}
                    {isVisible("description") ? (
                      <td className="bank-desc">
                        {bankMovementDescriptionText(row.description)}
                        {row.category ? (
                          <span className="bank-category">{expenseCategoryLabel(row.category)}</span>
                        ) : null}
                      </td>
                    ) : null}
                    {isVisible("method") ? (
                      <td>
                        {methodLabel ? (
                          <Pill
                            label={methodLabel}
                            kind={paymentMethodKind(methodLabel === "Nequi" ? "nequi" : "efectivo")}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    {isVisible("valueDate") ? <td>{isoToDisplay(row.valueDate)}</td> : null}
                    {isVisible("account") ? (
                      <td
                        className="bank-account-cell"
                        title={accountMap.get(row.accountRef) ?? row.accountRef}
                      >
                        {accountMap.get(row.accountRef) ?? row.accountRef}
                      </td>
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
                    {isVisible("extract") ? (
                      <td className="center">
                        {row.reconciled ? (
                          <button
                            type="button"
                            className="btn-link bank-extract-ref-link"
                            title="Ver extracto conciliado"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenPeriod(row.accountRef, row.period);
                            }}
                          >
                            {row.period}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    <ColumnPickerBodyCell />
                  </tr>
                );
              })
            )}
          </tbody>
          {history.length > 0 ? (
            <tfoot>
              <tr className="bank-total-row">
                <td colSpan={["ref", "description", "method", "valueDate", "account", "thirdParty"].filter((id) => isVisible(id)).length}>
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
                {isVisible("extract") ? <td /> : null}
                <ColumnPickerBodyCell />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
