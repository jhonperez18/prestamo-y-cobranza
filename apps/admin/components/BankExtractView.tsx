"use client";

import { useMemo, useState } from "react";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { EditMiniIcon, TrashMiniIcon } from "@/components/icons";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import { Pill } from "@/components/ui";
import type { BankAccount, BankExpenseCategory, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  addManualExpense,
  bankMovementDescriptionText,
  bankMovementMethodLabel,
  bankMovementsWithDisplayBalance,
  currentPeriod,
  expenseCategoryLabel,
  filterMovements,
  formatBankAmount,
  isBankExpenseMovement,
  isBankIncomeMovement,
  isPeriodClosed,
  isoToDisplay,
  bankVisibleRef,
  normalizeBankMovements,
  openingBalanceForPeriod,
  paymentRefForMovement,
  pendingMovementsForAccount,
  reconcilePeriod,
  summarizeMovements,
  syncPaymentsToMovements,
} from "@/lib/bank";
import { paymentMethodKind } from "@/lib/payment-method";
import type { MiscPayment } from "@/lib/misc-payments";
import { findMiscPaymentForMovement } from "@/lib/misc-payments";
import type { PaymentRow } from "@/lib/mock-data";
import {
  BANK_EXTRACT_MOVEMENT_COLUMNS,
  BANK_EXTRACT_MOVEMENT_DEFAULT_COLS,
} from "@/lib/table-columns";

type Props = {
  accounts: BankAccount[];
  accountRef: string;
  period: string;
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  payments: PaymentRow[];
  miscPayments: MiscPayment[];
  onAccountChange: (ref: string) => void;
  onPeriodChange: (period: string) => void;
  onMovementsChange: (rows: BankMovement[]) => void;
  onReconciliationsChange: (rows: BankReconciliation[]) => void;
  onOpenMiscPayment: (miscPaymentRef: string) => void;
  onOpenPaymentFicha: (paymentRef: string) => void;
  onOpenExpense?: (row: BankMovement) => void;
  onToast: (message?: string) => void;
  filterMode?: "pending" | "all";
};

type MovementDraft = {
  description: string;
  thirdParty: string;
  amount: string;
  category: BankExpenseCategory;
  valueDate: string;
};

const EMPTY_DRAFT: MovementDraft = {
  description: "",
  thirdParty: "",
  amount: "",
  category: "administracion",
  valueDate: new Date().toISOString().slice(0, 10),
};

export function BankExtractView({
  accounts,
  accountRef,
  period,
  movements,
  reconciliations,
  payments,
  miscPayments,
  onAccountChange,
  onPeriodChange,
  onMovementsChange,
  onReconciliationsChange,
  onOpenMiscPayment,
  onOpenPaymentFicha,
  onOpenExpense,
  onToast,
  filterMode = "all",
}: Props) {
  const [query, setQuery] = useState("");
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [expenseForm, setExpenseForm] = useState<MovementDraft>(EMPTY_DRAFT);
  const { sortKey, sortDir, toggleSort } = useBankMovementSort("valueDate");
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    BANK_EXTRACT_MOVEMENT_COLUMNS,
    BANK_EXTRACT_MOVEMENT_DEFAULT_COLS,
    { storageKey: "nexo.banco.extracto.columns.v2" },
  );

  const account = accounts.find((row) => row.ref === accountRef) ?? accounts[0];
  const closed = account ? isPeriodClosed(reconciliations, account.ref, period) : false;
  const ledgerMovements = useMemo(() => normalizeBankMovements(movements), [movements]);
  const editingRow = editingRef ? ledgerMovements.find((row) => row.ref === editingRef) : null;

  const periodRows = useMemo(() => {
    if (!account) return [];
    const base =
      filterMode === "pending"
        ? pendingMovementsForAccount(ledgerMovements, reconciliations, account.ref)
        : filterMovements(ledgerMovements, account.ref, period, "");
    if (!query.trim()) return base;
    const q = query.trim().toLowerCase();
    return base.filter((row) => {
      const hay = [
        row.ref,
        row.description,
        row.thirdParty,
        row.paymentRef ?? "",
        expenseCategoryLabel(row.category),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [account, ledgerMovements, reconciliations, period, query, filterMode]);

  const periodOpening = useMemo(() => {
    if (!account) return 0;
    const openingPeriod =
      filterMode === "pending" && periodRows.length > 0
        ? [...periodRows].sort((a, b) => a.period.localeCompare(b.period))[0]?.period ?? period
        : period;
    return openingBalanceForPeriod(
      account.ref,
      openingPeriod,
      account.openingBalance,
      ledgerMovements,
      reconciliations,
    );
  }, [account, period, periodRows, ledgerMovements, reconciliations, filterMode]);

  const rowsWithBalance = useMemo(
    () => bankMovementsWithDisplayBalance(periodRows, sortKey, sortDir, periodOpening),
    [periodRows, periodOpening, sortKey, sortDir],
  );

  const summary = useMemo(() => summarizeMovements(periodRows), [periodRows]);

  const visibleRefs = useMemo(() => new Set(periodRows.map((row) => row.ref)), [periodRows]);
  const allInExtract =
    periodRows.length > 0 && periodRows.every((row) => row.inExtract);
  const someInExtract = periodRows.some((row) => row.inExtract) && !allInExtract;

  if (!account) {
    return (
      <div className="bank-empty">
        <p>No hay cuenta bancaria activa.</p>
        <p className="bank-empty-hint">Cree una cuenta en el menú Cuentas.</p>
      </div>
    );
  }

  const resetForm = () => {
    setExpenseForm(EMPTY_DRAFT);
    setEditingRef(null);
  };

  const syncPayments = () => {
    const next = syncPaymentsToMovements(payments, ledgerMovements, account.ref, period);
    onMovementsChange(next);
    const added = next.length - ledgerMovements.length;
    onToast(added > 0 ? `${added} cobro(s) importados al extracto.` : "No hay cobros nuevos para importar.");
  };

  const saveExtract = () => {
    onMovementsChange(
      ledgerMovements.map((row) =>
        row.accountRef === account.ref && row.period === period ? { ...row, inExtract: true } : row,
      ),
    );
    onToast("Extracto guardado.");
  };

  const handleReconcile = () => {
    if (closed && filterMode !== "pending") {
      onToast("Este periodo ya está conciliado.");
      return;
    }
    if (periodRows.length === 0) {
      onToast("No hay movimientos para conciliar.");
      return;
    }
    const periodsToClose = [
      ...new Set(
        filterMode === "pending" ? periodRows.map((row) => row.period) : [period],
      ),
    ];
    let nextMovements = ledgerMovements;
    let nextReconciliations = reconciliations;
    for (const targetPeriod of periodsToClose) {
      if (isPeriodClosed(nextReconciliations, account.ref, targetPeriod)) continue;
      const result = reconcilePeriod(
        nextMovements,
        nextReconciliations,
        account.ref,
        targetPeriod,
        account.openingBalance,
      );
      nextMovements = result.movements;
      nextReconciliations = result.reconciliations;
    }
    onMovementsChange(nextMovements);
    onReconciliationsChange(nextReconciliations);
    resetForm();
    onToast(
      periodsToClose.length === 1
        ? `Periodo ${periodsToClose[0]} conciliado y cerrado.`
        : `${periodsToClose.length} periodos conciliados y cerrados.`,
    );
  };

  const toggleExtract = (ref: string) => {
    if (closed) return;
    onMovementsChange(
      ledgerMovements.map((row) => (row.ref === ref ? { ...row, inExtract: !row.inExtract } : row)),
    );
  };

  const toggleAllExtract = () => {
    if (closed || periodRows.length === 0) return;
    const nextValue = !allInExtract;
    onMovementsChange(
      ledgerMovements.map((row) =>
        visibleRefs.has(row.ref) ? { ...row, inExtract: nextValue } : row,
      ),
    );
  };

  const startEdit = (row: BankMovement) => {
    if (closed) return;
    setEditingRef(row.ref);
    setExpenseForm({
      description: row.description,
      thirdParty: row.thirdParty,
      amount: String(row.debit > 0 ? row.debit : row.credit),
      category: row.category ?? "otro",
      valueDate: row.valueDate,
    });
  };

  const openRowTarget = (row: BankMovement) => {
    const paymentRef = paymentRefForMovement(row);
    if (paymentRef && isBankIncomeMovement(row)) {
      onOpenPaymentFicha(paymentRef);
      return;
    }
    if (isBankExpenseMovement(row) && onOpenExpense) {
      onOpenExpense(row);
      return;
    }
    if (isBankExpenseMovement(row)) {
      const linked = findMiscPaymentForMovement(row, miscPayments);
      if (linked) {
        onOpenMiscPayment(linked.ref);
        return;
      }
    }
  };

  const renderRefCell = (row: BankMovement) => {
    const paymentRef = paymentRefForMovement(row);
    const isExpense = isBankExpenseMovement(row);

    if (!isExpense && paymentRef) {
      return (
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
      );
    }

    if (isExpense && onOpenExpense) {
      return (
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
      );
    }

    return bankVisibleRef(row);
  };

  const handleEdit = (row: BankMovement) => {
    if (closed) return;
    const paymentRef = paymentRefForMovement(row);
    if (paymentRef && isBankIncomeMovement(row)) {
      onOpenPaymentFicha(paymentRef);
      return;
    }
    if (isBankExpenseMovement(row)) {
      const linked = findMiscPaymentForMovement(row, miscPayments);
      if (linked) {
        onOpenMiscPayment(linked.ref);
        return;
      }
      if (onOpenExpense) {
        onOpenExpense(row);
        return;
      }
      onToast("Este gasto no está vinculado a Pagos varios. Regístrelo allí primero.");
      return;
    }
    startEdit(row);
  };

  const removeMovement = (ref: string) => {
    if (closed) return;
    const target = ledgerMovements.find((row) => row.ref === ref);
    if (!target) return;
    onMovementsChange(ledgerMovements.filter((row) => row.ref !== ref));
    if (editingRef === ref) resetForm();
    onToast(target.paymentRef ? "Movimiento quitado del extracto." : "Gasto eliminado.");
  };

  const saveMovement = () => {
    if (!expenseForm.description.trim() || !expenseForm.thirdParty.trim()) {
      onToast("Complete descripción y tercero.");
      return;
    }

    if (editingRef && editingRow) {
      if (editingRow.manual) {
        const amount = Number(expenseForm.amount.replace(/\D/g, ""));
        if (amount <= 0) {
          onToast("Indique un valor válido.");
          return;
        }
        onMovementsChange(
          ledgerMovements.map((row) =>
            row.ref === editingRef
              ? {
                  ...row,
                  description: expenseForm.description.trim(),
                  thirdParty: expenseForm.thirdParty.trim(),
                  valueDate: expenseForm.valueDate,
                  opDate: expenseForm.valueDate,
                  category: expenseForm.category,
                  debit: 0,
                  credit: amount,
                }
              : row,
          ),
        );
        onToast("Gasto actualizado.");
      } else {
        onMovementsChange(
          ledgerMovements.map((row) =>
            row.ref === editingRef
              ? {
                  ...row,
                  description: expenseForm.description.trim(),
                  thirdParty: expenseForm.thirdParty.trim(),
                  valueDate: expenseForm.valueDate,
                  opDate: expenseForm.valueDate,
                }
              : row,
          ),
        );
        onToast("Movimiento actualizado.");
      }
      resetForm();
      return;
    }

    const amount = Number(expenseForm.amount.replace(/\D/g, ""));
    if (amount <= 0) {
      onToast("Complete descripción, tercero y valor del gasto.");
      return;
    }
    const row = addManualExpense({
      accountRef: account.ref,
      period,
      description: expenseForm.description,
      thirdParty: expenseForm.thirdParty,
      amount,
      category: expenseForm.category,
      valueDate: expenseForm.valueDate,
      opDate: expenseForm.valueDate,
    });
    onMovementsChange([...ledgerMovements, row]);
    resetForm();
    onToast("Gasto registrado.");
  };

  const formOpen = Boolean(editingRef) && !closed;
  const showActions = filterMode === "pending" && !closed;
  const showExtractColumn = filterMode === "pending";

  return (
    <section className="panel bank-extract-panel">
      <div className="head bank-extract-head">
        <div className="grow" />
        {filterMode !== "pending" ? (
          <>
            <select
              className="bank-extract-select"
              value={account.ref}
              onChange={(event) => onAccountChange(event.target.value)}
              aria-label="Cuenta"
            >
              {accounts.filter((row) => row.active).map((row) => (
                <option key={row.ref} value={row.ref}>
                  {row.name} · {row.bankName}
                </option>
              ))}
            </select>
            <input
              className="bank-extract-select bank-extract-period"
              type="month"
              value={period}
              onChange={(event) => onPeriodChange(event.target.value || currentPeriod())}
              aria-label="Periodo"
            />
          </>
        ) : null}
        <input
          className="bank-extract-search"
          placeholder="Buscar ref, descripción, tercero…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {filterMode === "pending" ? (
          <>
            <button type="button" className="btn secondary compact" onClick={syncPayments} disabled={closed}>
              Importar cobros
            </button>
            <button type="button" className="btn secondary compact" onClick={saveExtract} disabled={closed}>
              Guardar extracto
            </button>
            <button type="button" className="btn primary compact" onClick={handleReconcile} disabled={closed}>
              Conciliar
            </button>
          </>
        ) : null}
      </div>

      {formOpen ? (
        <div className="bank-expense-form">
          <input
            placeholder="Descripción"
            value={expenseForm.description}
            onChange={(event) => setExpenseForm((prev) => ({ ...prev, description: event.target.value }))}
          />
          <input
            placeholder="Tercero / beneficiario"
            value={expenseForm.thirdParty}
            onChange={(event) => setExpenseForm((prev) => ({ ...prev, thirdParty: event.target.value }))}
          />
          {(!editingRow || editingRow.manual) && (
            <>
              <input
                placeholder="Valor"
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
              <select
                value={expenseForm.category}
                onChange={(event) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    category: event.target.value as BankExpenseCategory,
                  }))
                }
              >
                <option value="nomina">Nómina</option>
                <option value="administracion">Administración</option>
                <option value="domicilio">Domicilio</option>
                <option value="servicios">Servicios</option>
                <option value="otro">Otro</option>
              </select>
            </>
          )}
          {editingRow?.paymentRef ? (
            <span className="bank-form-note">Valor del cobro: {formatBankAmount(editingRow.debit)}</span>
          ) : null}
          <input
            type="date"
            value={expenseForm.valueDate}
            onChange={(event) => setExpenseForm((prev) => ({ ...prev, valueDate: event.target.value }))}
          />
          <button type="button" className="bank-btn bank-btn-primary" onClick={saveMovement}>
            {editingRef ? "Guardar cambios" : "Guardar gasto"}
          </button>
          <button type="button" className="bank-btn bank-btn-secondary" onClick={resetForm}>
            Cancelar
          </button>
        </div>
      ) : null}

      <div className="table-wrap">
        <table
          className={`data list-grid bank-extract-table ${
            showExtractColumn ? "bank-extract-table-pending" : "bank-extract-table-all"
          }`}
        >
          <colgroup>
            {isVisible("ref") ? <col className="be-ref" /> : null}
            {isVisible("description") ? <col className="be-desc" /> : null}
            {isVisible("method") ? <col className="be-method" /> : null}
            {isVisible("valueDate") ? <col className="be-date" /> : null}
            {isVisible("thirdParty") ? <col className="be-third" /> : null}
            {isVisible("debit") ? <col className="be-debit" /> : null}
            {isVisible("credit") ? <col className="be-credit" /> : null}
            {isVisible("balance") ? <col className="be-balance" /> : null}
            {showExtractColumn && isVisible("extract") ? <col className="be-extract" /> : null}
            {showActions ? <col className="be-actions" /> : null}
            <col className="be-picker" />
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
              {isVisible("balance") ? <th className="right">Saldo</th> : null}
              {showExtractColumn && isVisible("extract") ? (
                <th className="center">
                  <label className="bank-extract-all" title="Marcar o desmarcar todos">
                    <input
                      className="check"
                      type="checkbox"
                      checked={allInExtract}
                      ref={(el) => {
                        if (el) el.indeterminate = someInExtract;
                      }}
                      disabled={closed || periodRows.length === 0}
                      onChange={toggleAllExtract}
                      aria-label="Habilitar o deshabilitar todos los registros del extracto"
                    />
                    Extracto
                  </label>
                </th>
              ) : null}
              {showActions ? <th className="center">Acciones</th> : null}
              <th className="col-picker-cell">
                <ColumnPicker
                  columns={BANK_EXTRACT_MOVEMENT_COLUMNS}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {rowsWithBalance.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={Math.max(visibleCols.length, 1) + 1}>No hay movimientos en este extracto.</td>
              </tr>
            ) : (
              rowsWithBalance.map((row) => {
                const isExpense = isBankExpenseMovement(row);
                const methodLabel = bankMovementMethodLabel(row.description);
                const descriptionText =
                  isExpense && row.category
                    ? expenseCategoryLabel(row.category)
                    : bankMovementDescriptionText(row.description);
                return (
                  <tr
                    key={row.ref}
                    className={isExpense ? "bank-row-expense" : "bank-row-income"}
                    onClick={() => openRowTarget(row)}
                    style={{ cursor: "pointer" }}
                  >
                    {isVisible("ref") ? <td className="ref">{renderRefCell(row)}</td> : null}
                    {isVisible("description") ? (
                      <td title={descriptionText}>{descriptionText}</td>
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
                    {isVisible("thirdParty") ? <td>{row.thirdParty}</td> : null}
                    {isVisible("debit") ? (
                      <td className="right bank-debit">
                        {row.debit > 0 ? formatBankAmount(row.debit) : "—"}
                      </td>
                    ) : null}
                    {isVisible("credit") ? (
                      <td className="right bank-credit">
                        {row.credit > 0 ? formatBankAmount(row.credit) : "—"}
                      </td>
                    ) : null}
                    {isVisible("balance") ? (
                      <td className="right money bank-balance">{formatBankAmount(row.runningBalance)}</td>
                    ) : null}
                    {showExtractColumn && isVisible("extract") ? (
                      <td className="center" onClick={(event) => event.stopPropagation()}>
                        <input
                          className="check"
                          type="checkbox"
                          checked={row.inExtract}
                          disabled={closed}
                          onChange={() => toggleExtract(row.ref)}
                        />
                      </td>
                    ) : null}
                    {showActions ? (
                      <td className="center bank-row-actions" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="bank-action-btn"
                          title="Modificar"
                          aria-label="Modificar"
                          onClick={() => handleEdit(row)}
                        >
                          <EditMiniIcon />
                        </button>
                        <button
                          type="button"
                          className="bank-action-btn bank-action-btn-danger"
                          title="Eliminar"
                          aria-label="Eliminar"
                          onClick={() => removeMovement(row.ref)}
                        >
                          <TrashMiniIcon />
                        </button>
                      </td>
                    ) : null}
                    <td className="col-picker-cell" aria-hidden />
                  </tr>
                );
              })
            )}
          </tbody>
          {rowsWithBalance.length > 0 ? (
            <tfoot>
              <tr className="bank-total-row">
                <td
                  colSpan={Math.max(
                    visibleCols.filter(
                      (id) => !["debit", "credit", "balance", "extract", "actions"].includes(id),
                    ).length,
                    1,
                  )}
                >
                  Totales
                </td>
                {isVisible("debit") ? (
                  <td className="right">{formatBankAmount(summary.totalDebit)}</td>
                ) : null}
                {isVisible("credit") ? (
                  <td className="right">{formatBankAmount(summary.totalCredit)}</td>
                ) : null}
                {isVisible("balance") ? (
                  <td className="right money">{formatBankAmount(summary.balance)}</td>
                ) : null}
                {showExtractColumn && isVisible("extract") ? <td /> : null}
                {showActions ? <td /> : null}
                <td className="col-picker-cell" aria-hidden />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
