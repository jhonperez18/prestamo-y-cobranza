"use client";

import { useMemo, useState } from "react";
import type {
  BankAccount,
  BankHistoryKindFilter,
  BankHistoryScope,
  BankMovement,
  BankReconciliation,
} from "@/lib/bank";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import {
  bankMovementDescriptionText,
  bankMovementMethodLabel,
  bankMovementsWithDisplayBalance,
  expenseCategoryLabel,
  filterBankHistory,
  formatBankAmount,
  isBankExpenseMovement,
  isBankIncomeMovement,
  isPeriodClosed,
  isoToDisplay,
  normalizeBankMovements,
  normalizeBankPeriod,
  openPeriodsForAccount,
  paymentRefForMovement,
  periodLabel,
  bankVisibleRef,
  reconcilePeriod,
  summarizeMovements,
} from "@/lib/bank";
import { BANK_RECORD_COLUMNS, BANK_RECORD_DEFAULT_COLS } from "@/lib/table-columns";
import { paymentMethodKind } from "@/lib/payment-method";
import { Pill } from "@/components/ui";

type Props = {
  accounts: BankAccount[];
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  initialAccountRef?: string | null;
  initialScope?: BankHistoryScope;
  onOpenPeriod: (accountRef: string, period: string) => void;
  onMovementsChange: (rows: BankMovement[]) => void;
  onReconciliationsChange: (rows: BankReconciliation[]) => void;
  onOpenPaymentFicha?: (paymentRef: string) => void;
  onOpenExpense?: (row: BankMovement) => void;
  onToast?: (message?: string) => void;
};

export function BankRecordsHistoryView({
  accounts,
  movements,
  reconciliations,
  initialAccountRef = null,
  initialScope = "all",
  onOpenPeriod,
  onMovementsChange,
  onReconciliationsChange,
  onOpenPaymentFicha,
  onOpenExpense,
  onToast,
}: Props) {
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    BANK_RECORD_COLUMNS,
    BANK_RECORD_DEFAULT_COLS,
    { storageKey: "nexo.banco.registros.columns.v4" },
  );

  const [scope, setScope] = useState<BankHistoryScope>(initialScope);
  const [accountFilter, setAccountFilter] = useState(initialAccountRef ?? "");
  const [periodFilter, setPeriodFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<BankHistoryKindFilter>("all");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);

  const accountMap = useMemo(
    () => new Map(accounts.map((row) => [row.ref, row.name])),
    [accounts],
  );

  const normalized = useMemo(() => normalizeBankMovements(movements), [movements]);

  const periods = useMemo(() => {
    const list = normalized
      .filter((row) => !accountFilter || row.accountRef === accountFilter)
      .map((row) => normalizeBankPeriod(row.period));
    return [...new Set(list)].sort((a, b) => b.localeCompare(a));
  }, [normalized, accountFilter]);

  const filtered = useMemo(
    () =>
      filterBankHistory(normalized, {
        scope,
        accountRef: accountFilter || undefined,
        period: periodFilter || undefined,
        kind: kindFilter,
        query,
      }),
    [normalized, scope, accountFilter, periodFilter, kindFilter, query],
  );

  const openingForBalance = useMemo(() => {
    if (accountFilter) {
      const account = accounts.find((row) => row.ref === accountFilter);
      return account?.openingBalance ?? 0;
    }
    return accounts.reduce((sum, row) => sum + row.openingBalance, 0);
  }, [accounts, accountFilter]);

  const { sortKey, sortDir, toggleSort } = useBankMovementSort("valueDate");

  const history = useMemo(
    () => bankMovementsWithDisplayBalance(filtered, sortKey, sortDir, openingForBalance),
    [filtered, openingForBalance, sortKey, sortDir],
  );

  const visibleRows = useMemo(() => history.slice(0, pageSize), [history, pageSize]);
  const summary = useMemo(() => summarizeMovements(filtered), [filtered]);

  const openCount = useMemo(
    () => filterBankHistory(normalized, { scope: "open", accountRef: accountFilter || undefined }).length,
    [normalized, accountFilter],
  );
  const closedCount = useMemo(
    () =>
      filterBankHistory(normalized, { scope: "closed", accountRef: accountFilter || undefined }).length,
    [normalized, accountFilter],
  );

  const reconcileTarget = useMemo(() => {
    const accountRef =
      accountFilter ||
      accounts.find((row) => row.active)?.ref ||
      accounts[0]?.ref ||
      "";
    if (!accountRef) return null;
    const account = accounts.find((row) => row.ref === accountRef);
    if (!account) return null;
    const period =
      periodFilter ||
      openPeriodsForAccount(normalized, reconciliations, accountRef)[0] ||
      "";
    if (!period) return null;
    if (isPeriodClosed(reconciliations, accountRef, period)) return null;
    const pending = filterBankHistory(normalized, {
      scope: "open",
      accountRef,
      period,
    });
    if (pending.length === 0) return null;
    return { account, period, pendingCount: pending.length };
  }, [accountFilter, accounts, periodFilter, normalized, reconciliations]);

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

  function handleReconcile() {
    if (!reconcileTarget) return;
    const { account, period, pendingCount } = reconcileTarget;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(
        `¿Conciliar ${periodLabel(period)} en ${account.name}?\n` +
          `${pendingCount} movimiento(s) pasarán al historial cerrado.`,
      );
    if (!confirmed) return;
    const result = reconcilePeriod(
      normalized,
      reconciliations,
      account.ref,
      period,
      account.openingBalance,
    );
    onMovementsChange(result.movements);
    onReconciliationsChange(result.reconciliations);
    onToast?.(
      `Periodo ${periodLabel(period)} conciliado · ${pendingCount} registro(s) en historial.`,
    );
    setScope("closed");
    setAccountFilter(account.ref);
    setPeriodFilter(period);
  }

  return (
    <section className="panel bank-records-panel">
      <div className="head">
        <h1>Registros</h1>
        <span className="count">{history.length}</span>
        <p className="bank-history-hint">
          Historial del sistema · los cobros y gastos permanecen hasta conciliar el periodo.
        </p>
        <div className="grow" />
        <div className="bank-history-tabs" role="tablist" aria-label="Alcance del historial">
          <button
            type="button"
            role="tab"
            className={scope === "open" ? "is-active" : undefined}
            aria-selected={scope === "open"}
            onClick={() => setScope("open")}
          >
            Pendientes ({openCount})
          </button>
          <button
            type="button"
            role="tab"
            className={scope === "closed" ? "is-active" : undefined}
            aria-selected={scope === "closed"}
            onClick={() => setScope("closed")}
          >
            Conciliados ({closedCount})
          </button>
          <button
            type="button"
            role="tab"
            className={scope === "all" ? "is-active" : undefined}
            aria-selected={scope === "all"}
            onClick={() => setScope("all")}
          >
            Todos ({normalized.length})
          </button>
        </div>
      </div>

      <div className="bank-history-toolbar">
        <label>
          Cuenta{" "}
          <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
            <option value="">Todas</option>
            {accounts.map((row) => (
              <option key={row.ref} value={row.ref}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Periodo{" "}
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
            <option value="">Todos</option>
            {periods.map((period) => (
              <option key={period} value={period}>
                {periodLabel(period)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo{" "}
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as BankHistoryKindFilter)}
          >
            <option value="all">Todos</option>
            <option value="income">Ingresos</option>
            <option value="expense">Gastos</option>
          </select>
        </label>
        <label className="bank-history-search">
          Buscar{" "}
          <input
            type="search"
            value={query}
            placeholder="PG-, cliente, cobrador…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="page-size">
          Ver{" "}
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </label>
        {reconcileTarget ? (
          <button type="button" className="btn compact primary" onClick={handleReconcile}>
            Conciliar {periodLabel(reconcileTarget.period)}
          </button>
        ) : null}
        {accountFilter && periodFilter ? (
          <button
            type="button"
            className="btn compact"
            onClick={() => onOpenPeriod(accountFilter, periodFilter)}
          >
            Ver extracto
          </button>
        ) : null}
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
              {isVisible("extract") ? <th className="center">Estado</th> : null}
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
            {visibleRows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>
                  {scope === "open"
                    ? "No hay movimientos pendientes de conciliar."
                    : scope === "closed"
                      ? "Aún no hay periodos conciliados en el historial."
                      : "Aún no hay registros en el banco."}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
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
                        {isExpense && row.category
                          ? expenseCategoryLabel(row.category)
                          : bankMovementDescriptionText(row.description)}
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
                      <td className="bank-num bank-balance">
                        {formatBankAmount(row.runningBalance)}
                      </td>
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
                            {periodLabel(row.period)}
                          </button>
                        ) : (
                          <Pill label="Pendiente" kind="pending" />
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
                <td
                  colSpan={
                    ["ref", "description", "method", "valueDate", "account", "thirdParty"].filter(
                      (id) => isVisible(id),
                    ).length
                  }
                >
                  Total
                  {history.length > visibleRows.length
                    ? ` · mostrando ${visibleRows.length} de ${history.length}`
                    : ""}
                </td>
                {isVisible("debit") ? (
                  <td className="bank-num">{formatBankAmount(summary.totalDebit)}</td>
                ) : null}
                {isVisible("credit") ? (
                  <td className="bank-num">{formatBankAmount(summary.totalCredit)}</td>
                ) : null}
                {isVisible("balance") ? (
                  <td className="bank-num">
                    {formatBankAmount(openingForBalance + summary.balance)}
                  </td>
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
