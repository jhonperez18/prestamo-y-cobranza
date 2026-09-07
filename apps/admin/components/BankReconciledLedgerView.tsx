"use client";

import { useMemo, useState } from "react";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import { Pill } from "@/components/ui";
import type { BankAccount, BankLedgerKind, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  bankMovementDescriptionText,
  bankMovementMethodLabel,
  expenseCategoryLabel,
  filterBankHistory,
  formatBankAmount,
  isoToDisplay,
  listReconciledMovementsByKind,
  listReconciledPeriods,
  bankVisibleRef,
  normalizeBankMovements,
  normalizeBankPeriod,
  paymentRefForMovement,
  periodLabel,
  sortBankMovements,
  summarizeReconciledMovements,
  type BankHistoryScope,
} from "@/lib/bank";
import { paymentMethodKind } from "@/lib/payment-method";
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
  const storageKey = isIncome ? "nexo.banco.ingresos.columns.v4" : "nexo.banco.gastos.columns.v3";
  const amountColId = isIncome ? "debit" : "credit";

  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(columns, defaultCols, {
    storageKey,
  });

  const periods = useMemo(() => {
    const fromRecon = listReconciledPeriods(reconciliations);
    const fromRows = movements.map((row) => normalizeBankPeriod(row.period)).filter(Boolean);
    return [...new Set([...fromRecon, ...fromRows])].sort((a, b) => b.localeCompare(a));
  }, [reconciliations, movements]);
  const [periodFilter, setPeriodFilter] = useState(initialPeriod ?? "");
  const [accountFilter, setAccountFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<BankHistoryScope>("all");
  const { sortKey, sortDir, toggleSort } = useBankMovementSort("valueDate");

  const accountMap = useMemo(
    () => new Map(accounts.map((row) => [row.ref, row.name])),
    [accounts],
  );

  const rows = useMemo(() => {
    const normalized = normalizeBankMovements(movements);
    const byKind = listReconciledMovementsByKind(normalized, kind, periodFilter || undefined);
    const filtered = filterBankHistory(byKind, {
      scope: statusFilter,
      accountRef: accountFilter || undefined,
    });
    return sortBankMovements(filtered, sortKey, sortDir);
  }, [movements, kind, periodFilter, accountFilter, statusFilter, sortKey, sortDir]);

  const total = useMemo(() => summarizeReconciledMovements(rows, kind), [rows, kind]);
  const title = isIncome ? "Ingresos" : "Gastos";
  const amountLabel = isIncome ? "Debe" : "Haber";
  const labelColSpan = columns.filter((col) => col.id !== amountColId && isVisible(col.id)).length;

  function renderRefCell(row: BankMovement) {
    const paymentRef = paymentRefForMovement(row);
    const displayRef = bankVisibleRef(row);

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
    const amount = isIncome ? row.debit : row.credit;
    switch (colId) {
      case "ref":
        return renderRefCell(row);
      case "description":
        return bankMovementDescriptionText(row.description);
      case "method": {
        const methodLabel = bankMovementMethodLabel(row.description);
        if (!methodLabel) return "—";
        return (
          <Pill
            label={methodLabel}
            kind={paymentMethodKind(methodLabel === "Nequi" ? "nequi" : "efectivo")}
          />
        );
      }
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
      case "status":
        return row.reconciled ? (
          <Pill label="Conciliado" kind="ok" />
        ) : (
          <Pill label="Pendiente" kind="pending" />
        );
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
        <p className="bank-history-hint">
          Libro permanente · cobros y egresos del banco (abiertos y conciliados).
        </p>
        <div className="grow" />
        <label className="bank-ledger-filter">
          Estado{" "}
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as BankHistoryScope)}
          >
            <option value="all">Todos</option>
            <option value="open">Pendientes</option>
            <option value="closed">Conciliados</option>
          </select>
        </label>
        <label className="bank-ledger-filter">
          Cuenta{" "}
          <select
            value={accountFilter}
            onChange={(event) => setAccountFilter(event.target.value)}
          >
            <option value="">Todas</option>
            {accounts.map((row) => (
              <option key={row.ref} value={row.ref}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="bank-ledger-filter">
          Periodo{" "}
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
          >
            <option value="">Todos</option>
            {periods.map((period) => (
              <option key={period} value={period}>
                {periodLabel(period)}
              </option>
            ))}
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
            {isVisible("period") ? <col className="br-period" /> : null}
            {isVisible("account") ? <col className="br-account" /> : null}
            {isVisible("thirdParty") ? <col className="br-third" /> : null}
            {isVisible("category") ? <col className="br-category" /> : null}
            {isVisible("status") ? <col className="br-extract" /> : null}
            {isVisible(amountColId) ? <col className="br-amount" /> : null}
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
              {isVisible("period") ? <th>Periodo</th> : null}
              {isVisible("account") ? <th>Cuenta</th> : null}
              {isVisible("thirdParty") ? <th>Tercero</th> : null}
              {isVisible("category") ? <th>Categoría</th> : null}
              {isVisible("status") ? <th className="center">Estado</th> : null}
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
              <th className="col-picker-cell">
                <ColumnPicker columns={columns} visibleCols={visibleCols} onToggle={toggleColumn} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={Math.max(visibleCols.length, 1) + 1}>
                  {periodFilter || accountFilter || statusFilter !== "all"
                    ? `No hay ${title.toLowerCase()} con estos filtros.`
                    : `Aún no hay ${title.toLowerCase()} en el banco.`}
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
                  {columns.filter((col) => isVisible(col.id)).map((col) => {
                    const cellText =
                      col.id === "account"
                        ? String(renderCell(row, col.id) ?? "")
                        : undefined;
                    return (
                      <td
                        key={col.id}
                        className={
                          col.id === "ref"
                            ? "ref"
                            : col.id === "account"
                              ? "bank-account-cell"
                              : col.id === amountColId
                                ? `bank-num ${isIncome ? "bank-debit" : "bank-credit"}`
                                : undefined
                        }
                        title={col.id === "account" ? cellText : undefined}
                      >
                        {col.id === "account" ? cellText : renderCell(row, col.id)}
                      </td>
                    );
                  })}
                  <td className="col-picker-cell" aria-hidden />
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && isVisible(amountColId) ? (
            <tfoot>
              <tr className="bank-total-row">
                <td colSpan={Math.max(labelColSpan, 1)}>Total</td>
                <td className={`bank-num ${isIncome ? "bank-debit" : "bank-credit"}`}>
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
