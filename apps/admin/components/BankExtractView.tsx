"use client";

import { useMemo, useState } from "react";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { EditMiniIcon, TrashMiniIcon } from "@/components/icons";
import { BankSortTh, useBankMovementSort } from "@/components/BankSortTh";
import type { BankAccount, BankExpenseCategory, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  addManualExpense,
  bankMovementsWithDisplayBalance,
  currentPeriod,
  expenseCategoryLabel,
  filterMovements,
  formatBankAmount,
  isPeriodClosed,
  isoToDisplay,
  movementDisplayRef,
  openingBalanceForPeriod,
  paymentRefForMovement,
  pendingMovementsForAccount,
  reconcilePeriod,
  summarizeMovements,
  syncPaymentsToMovements,
} from "@/lib/bank";
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
  onBack: () => void;
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
  onBack: _onBack,
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
    { storageKey: "nexo.banco.extracto.columns" },
  );

  const account = accounts.find((row) => row.ref === accountRef) ?? accounts[0];
  const closed = account ? isPeriodClosed(reconciliations, account.ref, period) : false;
  const editingRow = editingRef ? movements.find((row) => row.ref === editingRef) : null;

  const periodRows = useMemo(() => {
    if (!account) return [];
    const base =
      filterMode === "pending"
        ? pendingMovementsForAccount(movements, reconciliations, account.ref, period)
        : filterMovements(movements, account.ref, period, "");
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
  }, [account, movements, reconciliations, period, query, filterMode]);

  const periodOpening = useMemo(() => {
    if (!account) return 0;
    return openingBalanceForPeriod(
      account.ref,
      period,
      account.openingBalance,
      movements,
      reconciliations,
    );
  }, [account, period, movements, reconciliations]);

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
    const next = syncPaymentsToMovements(payments, movements, account.ref, period);
    onMovementsChange(next);
    const added = next.length - movements.length;
    onToast(added > 0 ? `${added} cobro(s) importados al extracto.` : "No hay cobros nuevos para importar.");
  };

  const saveExtract = () => {
    onMovementsChange(
      movements.map((row) =>
        row.accountRef === account.ref && row.period === period ? { ...row, inExtract: true } : row,
      ),
    );
    onToast("Extracto guardado.");
  };

  const handleReconcile = () => {
    if (closed) {
      onToast("Este periodo ya está conciliado.");
      return;
    }
    if (periodRows.length === 0) {
      onToast("No hay movimientos para conciliar.");
      return;
    }
    const { movements: nextMovements, reconciliations: nextReconciliations } = reconcilePeriod(
      movements,
      reconciliations,
      account.ref,
      period,
      account.openingBalance,
    );
    onMovementsChange(nextMovements);
    onReconciliationsChange(nextReconciliations);
    resetForm();
    onToast(`Periodo ${period} conciliado y cerrado.`);
  };

  const toggleExtract = (ref: string) => {
    if (closed) return;
    onMovementsChange(
      movements.map((row) => (row.ref === ref ? { ...row, inExtract: !row.inExtract } : row)),
    );
  };

  const toggleAllExtract = () => {
    if (closed || periodRows.length === 0) return;
    const nextValue = !allInExtract;
    onMovementsChange(
      movements.map((row) =>
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
    if (paymentRef && row.credit > 0) {
      onOpenPaymentFicha(paymentRef);
      return;
    }
    if (row.debit > 0 && onOpenExpense) {
      onOpenExpense(row);
      return;
    }
    if (row.debit > 0) {
      const linked = findMiscPaymentForMovement(row, miscPayments);
      if (linked) {
        onOpenMiscPayment(linked.ref);
        return;
      }
    }
  };

  const renderRefCell = (row: BankMovement) => {
    const paymentRef = paymentRefForMovement(row);
    const isExpense = row.debit > 0;

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
          {movementDisplayRef(row)}
        </button>
      );
    }

    return isExpense ? movementDisplayRef(row) : paymentRef ?? row.ref.slice(-6);
  };

  const handleEdit = (row: BankMovement) => {
    if (closed) return;
    const paymentRef = paymentRefForMovement(row);
    if (paymentRef && row.credit > 0) {
      onOpenPaymentFicha(paymentRef);
      return;
    }
    if (row.debit > 0) {
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
    const target = movements.find((row) => row.ref === ref);
    if (!target) return;
    onMovementsChange(movements.filter((row) => row.ref !== ref));
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
          movements.map((row) =>
            row.ref === editingRef
              ? {
                  ...row,
                  description: expenseForm.description.trim(),
                  thirdParty: expenseForm.thirdParty.trim(),
                  valueDate: expenseForm.valueDate,
                  opDate: expenseForm.valueDate,
                  category: expenseForm.category,
                  debit: amount,
                  credit: 0,
                }
              : row,
          ),
        );
        onToast("Gasto actualizado.");
      } else {
        onMovementsChange(
          movements.map((row) =>
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
    onMovementsChange([...movements, row]);
    resetForm();
    onToast("Gasto registrado.");
  };

  const formOpen = Boolean(editingRef) && !closed;

  return (
    <section className="panel bank-extract-panel">
      <div className="head bank-extract-head">
        {closed ? <span className="bank-closed-badge">Conciliado · solo lectura</span> : null}
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
        <button type="button" className="btn secondary compact" onClick={syncPayments} disabled={closed}>
          Importar cobros
        </button>
        <button type="button" className="btn secondary compact" onClick={saveExtract} disabled={closed}>
          Guardar extracto
        </button>
        <button type="button" className="btn primary compact" onClick={handleReconcile} disabled={closed}>
          Conciliar
        </button>
        <ColumnPicker columns={BANK_EXTRACT_MOVEMENT_COLUMNS} visibleCols={visibleCols} onToggle={toggleColumn} />
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
            <span className="bank-form-note">Valor del cobro: {formatBankAmount(editingRow.credit)}</span>
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
        <table className="data list-grid bank-extract-table">
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
              {isVisible("extract") ? (
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
              {isVisible("actions") ? <th className="center">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {rowsWithBalance.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={Math.max(visibleCols.length, 1)}>No hay movimientos en este extracto.</td>
              </tr>
            ) : (
              rowsWithBalance.map((row) => {
                const isExpense = row.debit > 0;
                return (
                  <tr
                    key={row.ref}
                    className={isExpense ? "bank-row-expense" : "bank-row-income"}
                    onClick={() => openRowTarget(row)}
                    style={{ cursor: "pointer" }}
                  >
                    {isVisible("ref") ? <td className="ref">{renderRefCell(row)}</td> : null}
                    {isVisible("description") ? (
                      <td>
                        {row.description}
                        {row.category ? (
                          <span className="bank-category">{expenseCategoryLabel(row.category)}</span>
                        ) : null}
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
                    {isVisible("extract") ? (
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
                    {isVisible("actions") ? (
                      <td className="center bank-row-actions" onClick={(event) => event.stopPropagation()}>
                        {!closed ? (
                          <>
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
                          </>
                        ) : (
                          <span className="bank-action-lock" title="Periodo conciliado">
                            —
                          </span>
                        )}
                      </td>
                    ) : null}
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
                  Total
                </td>
                {isVisible("debit") ? <td className="right">{formatBankAmount(summary.totalDebit)}</td> : null}
                {isVisible("credit") ? <td className="right">{formatBankAmount(summary.totalCredit)}</td> : null}
                {isVisible("balance") ? (
                  <td className="right money">{formatBankAmount(periodOpening + summary.balance)}</td>
                ) : null}
                {isVisible("extract") ? (
                  <td>
                    {!closed ? (
                      <button type="button" className="bank-reconcile-btn" onClick={handleReconcile}>
                        Conciliar
                      </button>
                    ) : null}
                  </td>
                ) : null}
                {isVisible("actions") ? <td /> : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
