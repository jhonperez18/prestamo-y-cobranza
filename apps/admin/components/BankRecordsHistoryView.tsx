"use client";

import { useMemo, useRef, useState } from "react";
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
  addBalanceAdjustment,
  balanceAdjustmentLabel,
  bankMovementDescriptionText,
  bankMovementPaymentMethodLabel,
  expenseCategoryLabel,
  filterBankHistory,
  findOpenZeroTarget,
  formatBankAmount,
  inspectOpenZeroStatus,
  isBalanceAdjustmentMovement,
  isBankExpenseMovement,
  accountForRole,
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
  sortBankMovements,
  summarizeMovements,
} from "@/lib/bank";
import { BANK_RECORD_COLUMNS, BANK_RECORD_DEFAULT_COLS } from "@/lib/table-columns";
import { paymentMethodPillProps } from "@/lib/payment-method";
import { Pill } from "@/components/ui";
import { downloadDemoSnapshot, importDemoSnapshot } from "@/lib/demo-persist";
import { flushBigDemoStore } from "@/lib/big-demo-store";

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
  initialScope = "open",
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
    { storageKey: "nexo.banco.registros.columns.v5" },
  );
  const importInputRef = useRef<HTMLInputElement>(null);

  const [scope, setScope] = useState<BankHistoryScope>(initialScope);
  const [accountFilter, setAccountFilter] = useState(initialAccountRef ?? "");
  const [periodFilter, setPeriodFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<BankHistoryKindFilter>("all");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  function handleExportBackup() {
    downloadDemoSnapshot();
    onToast?.("Respaldo descargado · guárdalo fuera del navegador.");
  }

  function handleImportFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const result = importDemoSnapshot(text);
      if (!result.ok) {
        onToast?.(result.error);
        return;
      }
      onToast?.("Respaldo restaurado · recargando…");
      void flushBigDemoStore().finally(() => window.location.reload());
    };
    reader.readAsText(file);
  }

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

  const { sortKey, sortDir, toggleSort: toggleBankSort } = useBankMovementSort("valueDate");
  function toggleSort(column: Parameters<typeof toggleBankSort>[0]) {
    toggleBankSort(column);
    setPage(1);
  }

  const history = useMemo(
    () => sortBankMovements(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(history.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => history.slice(pageStart, pageStart + pageSize),
    [history, pageStart, pageSize],
  );
  const summary = useMemo(() => summarizeMovements(filtered), [filtered]);

  function goPage(next: number) {
    setPage(Math.max(1, Math.min(totalPages, next)));
  }

  function changeScope(next: BankHistoryScope) {
    setScope(next);
    setPage(1);
  }

  function changeAccountFilter(value: string) {
    setAccountFilter(value);
    setPage(1);
  }

  function changePeriodFilter(value: string) {
    setPeriodFilter(value);
    setPage(1);
  }

  function changeKindFilter(value: BankHistoryKindFilter) {
    setKindFilter(value);
    setPage(1);
  }

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function changePageSize(value: number) {
    setPageSize(value);
    setPage(1);
  }

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
      accountFilter || accountForRole(accounts, "efectivo")?.ref || "";
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

  /** Mes abierto con Inicial negativo: efectivo, Nequi o Banco (según filtro Cuenta). */
  const openZeroTarget = useMemo(
    () =>
      findOpenZeroTarget(
        accounts,
        normalized,
        reconciliations,
        accountFilter || undefined,
        periodFilter || undefined,
      ),
    [accountFilter, accounts, periodFilter, normalized, reconciliations],
  );
  const openZeroStatus = useMemo(
    () =>
      inspectOpenZeroStatus(
        accounts,
        normalized,
        reconciliations,
        accountFilter || undefined,
        periodFilter || undefined,
      ),
    [accountFilter, accounts, periodFilter, normalized, reconciliations],
  );
  const openZeroHint =
    openZeroStatus?.kind === "blocked"
      ? openZeroStatus.reason === "ya_ajustado"
        ? `${openZeroStatus.account.name} · ${periodLabel(openZeroStatus.period)} ya tiene ajuste de apertura`
        : openZeroStatus.reason === "mes_anterior_abierto"
          ? `${openZeroStatus.account.name} · concilie primero el mes anterior; luego podrá abrir en cero`
          : `${openZeroStatus.account.name} · Inicial ${periodLabel(openZeroStatus.period)}: ${formatBankAmount(openZeroStatus.opening)} · no hace falta ajuste (solo si es negativo)`
      : null;

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
      `Periodo ${periodLabel(period)} conciliado · ${pendingCount} registro(s) pasaron al extracto. Quedan los pendientes en Registros.`,
    );
    // Conciliado → extracto; en Registros solo quedan los pendientes del mes siguiente.
    setScope("open");
    setAccountFilter(account.ref);
    setPeriodFilter("");
    setPage(1);
  }

  function handleOpenMonthAtZero() {
    if (!openZeroTarget) return;
    const { account, period, priorPeriod, amount } = openZeroTarget;
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(
        `¿Abrir ${periodLabel(period)} en cero?\n\n` +
          `Se anota en Registros (mes abierto) el día 1:\n` +
          `«${balanceAdjustmentLabel(priorPeriod)}»\n` +
          `por ${formatBankAmount(amount)}.\n\n` +
          `El extracto ${periodLabel(priorPeriod)} no se modifica.`,
      );
    if (!confirmed) return;
    const row = addBalanceAdjustment({
      accountRef: account.ref,
      period,
      amount,
      priorPeriod,
    });
    onMovementsChange([...normalized, row]);
    setScope("open");
    setAccountFilter(account.ref);
    setPeriodFilter(period);
    setPage(1);
    onToast?.(
      `Ajuste anotado · ${balanceAdjustmentLabel(priorPeriod)} · el mes ${periodLabel(period)} queda en cero tras ese renglón.`,
    );
  }

  return (
    <section className="panel bank-records-panel">
      <div className="head">
        <h1>Registros</h1>
        <span className="count">{history.length}</span>
        <div className="grow" />
        <div className="bank-backup-actions">
          <button type="button" className="btn ghost" onClick={handleExportBackup}>
            Descargar respaldo
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => importInputRef.current?.click()}
          >
            Restaurar respaldo
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              handleImportFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>
        <div className="bank-history-tabs" role="tablist" aria-label="Alcance del historial">
          <button
            type="button"
            role="tab"
            className={scope === "open" ? "is-active" : undefined}
            aria-selected={scope === "open"}
            onClick={() => changeScope("open")}
          >
            Pendientes ({openCount})
          </button>
          <button
            type="button"
            role="tab"
            className={scope === "closed" ? "is-active" : undefined}
            aria-selected={scope === "closed"}
            onClick={() => changeScope("closed")}
          >
            Conciliados ({closedCount})
          </button>
          <button
            type="button"
            role="tab"
            className={scope === "all" ? "is-active" : undefined}
            aria-selected={scope === "all"}
            onClick={() => changeScope("all")}
          >
            Todos ({normalized.length})
          </button>
        </div>
      </div>

      <div className="bank-history-toolbar">
        <label>
          Cuenta{" "}
          <select value={accountFilter} onChange={(e) => changeAccountFilter(e.target.value)}>
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
          <select value={periodFilter} onChange={(e) => changePeriodFilter(e.target.value)}>
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
            onChange={(e) => changeKindFilter(e.target.value as BankHistoryKindFilter)}
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
            onChange={(e) => changeQuery(e.target.value)}
          />
        </label>
        <label className="page-size">
          Ver{" "}
          <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </label>
        {openZeroTarget ? (
          <button
            type="button"
            className="btn compact primary"
            onClick={handleOpenMonthAtZero}
            title={`Anula el Inicial negativo de ${openZeroTarget.account.name} (mes abierto)`}
          >
            Abrir {periodLabel(openZeroTarget.period)} en cero · {openZeroTarget.account.name}
          </button>
        ) : openZeroHint ? (
          <span className="bank-open-zero-hint" title={openZeroHint}>
            {openZeroHint}
          </span>
        ) : null}
        {reconcileTarget ? (
          <button type="button" className="btn compact" onClick={handleReconcile}>
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
        ) : openZeroTarget || reconcileTarget ? (
          <button
            type="button"
            className="btn compact"
            onClick={() => {
              const target = openZeroTarget ?? reconcileTarget;
              if (!target) return;
              onOpenPeriod(target.account.ref, target.period);
            }}
          >
            Ver mes abierto
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
              {isVisible("thirdParty") ? <th className="is-nombre">Tercero</th> : null}
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
                const isAjuste = isBalanceAdjustmentMovement(row);
                const paymentRef = paymentRefForMovement(row);
                const methodLabel = bankMovementPaymentMethodLabel(row);
                return (
                  <tr
                    key={row.ref}
                    className={[
                      isAjuste
                        ? "bank-row-ajuste"
                        : isExpense
                          ? "bank-row-expense"
                          : "bank-row-income",
                      isExpense && row.category === "prestamo_ruta" ? "is-prestamo-ruta" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
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
                          <Pill {...paymentMethodPillProps(methodLabel)} />
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
                    {isVisible("thirdParty") ? (
                      <td className="is-nombre" title={row.thirdParty || undefined}>
                        {row.thirdParty || "—"}
                      </td>
                    ) : null}
                    {isVisible("debit") ? (
                      <td className="bank-num bank-debit right">
                        {row.debit > 0 ? formatBankAmount(row.debit) : "—"}
                      </td>
                    ) : null}
                    {isVisible("credit") ? (
                      <td className="bank-num bank-credit right">
                        {row.credit > 0 ? formatBankAmount(row.credit) : "—"}
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
                    ? ` · ${pageStart + 1}–${pageStart + visibleRows.length} de ${history.length}`
                    : ""}
                </td>
                {isVisible("debit") ? (
                  <td className="bank-num right">{formatBankAmount(summary.totalDebit)}</td>
                ) : null}
                {isVisible("credit") ? (
                  <td className="bank-num right">{formatBankAmount(summary.totalCredit)}</td>
                ) : null}
                <ColumnPickerBodyCell />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {history.length > 0 ? (
        <div className="bank-history-pager" role="navigation" aria-label="Páginas del registro">
          <button
            type="button"
            className="btn compact"
            disabled={safePage <= 1}
            onClick={() => goPage(safePage - 1)}
          >
            Anterior
          </button>
          <span>
            Página {safePage} de {totalPages}
            {history.length > pageSize
              ? ` · ${pageStart + 1}–${Math.min(pageStart + pageSize, history.length)} de ${history.length}`
              : ` · ${history.length} registro(s)`}
          </span>
          <button
            type="button"
            className="btn compact"
            disabled={safePage >= totalPages}
            onClick={() => goPage(safePage + 1)}
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </section>
  );
}
