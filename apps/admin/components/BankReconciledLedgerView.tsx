"use client";

import { useMemo, useState } from "react";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import type { BankAccount, BankLedgerKind, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  expenseCategoryLabel,
  formatBankAmount,
  isoToDisplay,
  listReconciledMovementsByKind,
  listReconciledPeriods,
  movementDisplayRef,
  normalizeBankMovements,
  paymentRefForMovement,
  periodLabel,
  sortBankMovements,
  summarizeReconciledMovements,
} from "@/lib/bank";
import {
  BANK_LEDGER_EXPENSE_COLUMNS,
  BANK_LEDGER_EXPENSE_DEFAULT_COLS,
  BANK_LEDGER_INCOME_COLUMNS,
  BANK_LEDGER_INCOME_DEFAULT_COLS,
} from "@/lib/table-columns";

type Props = {
  kind: BankLedgerKind;
  accounts: BankAccount[];
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  initialPeriod?: string | null;
  onOpenPaymentFicha?: (paymentRef: string) => void;
  onOpenExpense?: (row: BankMovement) => void;
};

export function BankReconciledLedgerView({
  kind,
  accounts,
  movements,
  reconciliations,
  initialPeriod = null,
  onOpenPaymentFicha,
  onOpenExpense,
}: Props) {
  const isIncome = kind === "income";
  const columns = isIncome ? BANK_LEDGER_INCOME_COLUMNS : BANK_LEDGER_EXPENSE_COLUMNS;
  const defaultCols = isIncome ? BANK_LEDGER_INCOME_DEFAULT_COLS : BANK_LEDGER_EXPENSE_DEFAULT_COLS;
  const storageKey = isIncome ? "nexo.banco.ingresos.columns" : "nexo.banco.gastos.columns";
  const amountColId = isIncome ? "credit" : "debit";

  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(columns, defaultCols, {
    storageKey,
  });

  const periods = useMemo(() => listReconciledPeriods(reconciliations), [reconciliations]);
  const [periodFilter, setPeriodFilter] = useState(initialPeriod ?? "");
  const { sortKey, sortDir, toggleSort } = useBankMovementSort("valueDate");

  const accountMap = useMemo(
    () => new Map(accounts.map((row) => [row.ref, row.name])),
    [accounts],
  );

  const rows = useMemo(() => {
    const normalized = normalizeBankMovements(movements);
    const filtered = listReconciledMovementsByKind(normalized, kind, periodFilter || undefined);
    return sortBankMovements(filtered, sortKey, sortDir);
  }, [movements, kind, periodFilter, sortKey, sortDir]);

  const total = useMemo(() => summarizeReconciledMovements(rows, kind), [rows, kind]);
  const title = isIncome ? "Ingresos" : "Gastos";
  const amountLabel = isIncome ? "Haber" : "Debe";
  const labelColSpan = columns.filter((col) => col.id !== amountColId && isVisible(col.id)).length;

  function renderRefCell(row: BankMovement) {
    const paymentRef = paymentRefForMovement(row);
    const displayRef =
      kind === "expense" ? movementDisplayRef(row) : paymentRef ?? row.ref.slice(-6);

    if (isIncome && paymentRef && onOpenPaymentFicha) {
      return (
        <button
          type="button"
          className="btn-link bank-extract-ref-link"
          onClick={() => onOpenPaymentFicha(paymentRef)}
        >
          {paymentRef}
        </button>
      );
    }

    if (!isIncome && onOpenExpense) {
      return (
        <button
          type="button"
          className="btn-link bank-extract-ref-link"
          onClick={(event) => {
            event.stopPropagation();
            onOpenExpense(row);
          }}
        >
          {displayRef}
        </button>
      );
    }

    return displayRef;
  }

  function renderCell(row: BankMovement, colId: string) {
    const amount = isIncome ? row.credit : row.debit;
    switch (colId) {
      case "ref":
        return renderRefCell(row);
      case "description":
        return row.description;
      case "valueDate":
        return isoToDisplay(row.valueDate);
      case "period":
        return periodLabel(row.period);
      case "account":
        return accountMap.get(row.accountRef) ?? row.accountRef;
      case "thirdParty":
        return row.thirdParty;
      case "category":
        return row.category ? expenseCategoryLabel(row.category) : "—";
      case "credit":
      case "debit":
        return formatBankAmount(amount);
      default:
        return "—";
    }
  }

  return (
    <section className="panel bank-ledger-panel">
      <div className="head">
        <h1>{title}</h1>
        <span className="count">{rows.length}</span>
        <div className="grow" />
        <label className="bank-ledger-filter">
          Mes conciliado{" "}
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
          >
            <option value="">Todos los meses</option>
            {periods.map((period) => (
              <option key={period} value={period}>
                {periodLabel(period)}
              </option>
            ))}
          </select>
        </label>
        <ColumnPicker columns={columns} visibleCols={visibleCols} onToggle={toggleColumn} />
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
              {isVisible("period") ? <th>Periodo</th> : null}
              {isVisible("account") ? <th>Cuenta</th> : null}
              {isVisible("thirdParty") ? <th>Tercero</th> : null}
              {isVisible("category") ? <th>Categoría</th> : null}
              {isVisible(amountColId) ? (
                <BankSortTh
                  label={amountLabel}
                  column={amountColId}
                  activeColumn={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  align="right"
                />
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={Math.max(visibleCols.length, 1)}>
                  {periodFilter
                    ? `No hay ${title.toLowerCase()} conciliados en ${periodLabel(periodFilter)}.`
                    : `Aún no hay ${title.toLowerCase()} conciliados.`}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.ref}
                  className={isIncome ? "bank-row-income" : "bank-row-expense"}
                  onClick={() => {
                    if (isIncome && paymentRefForMovement(row) && onOpenPaymentFicha) {
                      onOpenPaymentFicha(paymentRefForMovement(row)!);
                      return;
                    }
                    if (!isIncome && onOpenExpense) onOpenExpense(row);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {columns.filter((col) => isVisible(col.id)).map((col) => (
                    <td
                      key={col.id}
                      className={
                        col.id === "ref"
                          ? "ref"
                          : col.id === amountColId
                            ? `bank-num ${isIncome ? "bank-credit" : "bank-debit"}`
                            : undefined
                      }
                    >
                      {renderCell(row, col.id)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && isVisible(amountColId) ? (
            <tfoot>
              <tr className="bank-total-row">
                <td colSpan={Math.max(labelColSpan, 1)}>Total</td>
                <td className={`bank-num ${isIncome ? "bank-credit" : "bank-debit"}`}>
                  {formatBankAmount(total)}
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
