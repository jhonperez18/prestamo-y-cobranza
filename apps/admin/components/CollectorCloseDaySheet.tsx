"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  ROUTE_EXPENSE_ITEMS,
  formatExpenseAmountInput,
  parseExpenseAmount,
  sumExpenseLines,
  type CollectorDayCloseDraft,
  type RouteExpenseId,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import { money } from "@/lib/mock-data";

const OTHER_EXPENSE_ID: RouteExpenseId = "otros";

/** Sugerencias del gasto: se pueden repetir; el préstamo va por su botón, no aquí. */
const EXPENSE_SUGGESTIONS = ROUTE_EXPENSE_ITEMS.filter((item) => item.category !== "prestamo_ruta");

type DraftRow = {
  key: string;
  expenseId: RouteExpenseId | "";
  /** Texto libre cuando el gasto es «Otros». */
  customLabel: string;
  amount: string;
  /** Renglón que ya estaba guardado (conserva su referencia de banco). */
  fromSaved: boolean;
  lineKey?: string;
};

type Props = {
  draft: CollectorDayCloseDraft;
  /** Guarda gastos sin cerrar el día. */
  onSave: (expenses: RouteExpenseLine[]) => void;
};

function newRow(): DraftRow {
  return {
    key: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    expenseId: "",
    customLabel: "",
    amount: "",
    fromSaved: false,
  };
}

function rowsFromExpenses(expenses: RouteExpenseLine[]): DraftRow[] {
  const filled = expenses
    .filter((line) => line.amount > 0)
    .map((line, index) => {
      const item = ROUTE_EXPENSE_ITEMS.find((entry) => entry.id === line.id);
      return {
        key: `saved-${line.id}-${index}`,
        expenseId: line.id,
        customLabel: line.id === OTHER_EXPENSE_ID && line.label !== item?.label ? line.label : "",
        amount: formatExpenseAmountInput(line.amount),
        fromSaved: true,
        lineKey: line.lineKey,
      };
    });
  if (filled.length === 0) return [newRow(), newRow()];
  return [...filled, newRow()];
}

function toExpenseLines(rows: DraftRow[]): RouteExpenseLine[] {
  // Un solo renglón por tipo usa la referencia de banco sin marca: el que ya estaba guardado.
  const plainTaken = new Set<string>(
    rows.filter((row) => row.fromSaved && !row.lineKey && row.expenseId).map((row) => row.expenseId),
  );
  const lines: RouteExpenseLine[] = [];
  for (const row of rows) {
    const amount = parseExpenseAmount(row.amount);
    if (!row.expenseId || amount <= 0) continue;
    const item = ROUTE_EXPENSE_ITEMS.find((entry) => entry.id === row.expenseId);
    if (!item) continue;
    let lineKey = row.lineKey;
    if (!lineKey && !row.fromSaved) {
      if (plainTaken.has(item.id)) lineKey = row.key;
      else plainTaken.add(item.id);
    }
    const custom = item.id === OTHER_EXPENSE_ID ? row.customLabel.trim() : "";
    lines.push({
      id: item.id,
      label: custom || item.label,
      category: item.category,
      amount,
      ...(lineKey ? { lineKey } : {}),
    });
  }
  return lines;
}

export function CollectorCloseDaySheet({ draft, onSave }: Props) {
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromExpenses(draft.expenses));
  const lines = useMemo(() => toExpenseLines(rows), [rows]);
  const expensesTotal = sumExpenseLines(lines);

  function ensureExtraRow(nextRows: DraftRow[]) {
    const last = nextRows[nextRows.length - 1];
    const lastFilled =
      Boolean(last?.expenseId) && parseExpenseAmount(last?.amount ?? "") > 0;
    return lastFilled ? [...nextRows, newRow()] : nextRows;
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((current) => {
      const next = current.map((row) => (row.key === key ? { ...row, ...patch } : row));
      return ensureExtraRow(next);
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSave(lines);
  }

  return (
    <div className="collector-close-sheet" role="dialog" aria-labelledby="collector-close-title">
      <h2 id="collector-close-title" className="sr-only">
        Gastos de ruta
      </h2>

      <form className="collector-close-form" onSubmit={handleSubmit}>
        <div className="collector-close-list-head">
          <span>Gasto</span>
          <span>Monto</span>
        </div>
        <ul className="collector-close-expense-list" aria-label="Gastos de ruta">
          {rows.map((row, index) => (
            <li key={row.key} className="collector-close-expense-row">
              <label className="sr-only" htmlFor={`close-exp-type-${row.key}`}>
                Tipo de gasto {index + 1}
              </label>
              <select
                id={`close-exp-type-${row.key}`}
                value={row.expenseId}
                onChange={(event) => {
                  const expenseId = event.target.value as RouteExpenseId | "";
                  if (expenseId === row.expenseId) return;
                  updateRow(row.key, { expenseId, fromSaved: false, lineKey: undefined });
                }}
              >
                <option value="">Elegir gasto…</option>
                {EXPENSE_SUGGESTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`close-exp-amt-${row.key}`}>
                Monto {index + 1}
              </label>
              <input
                id={`close-exp-amt-${row.key}`}
                inputMode="numeric"
                placeholder="0"
                value={row.amount}
                onChange={(event) =>
                  updateRow(row.key, {
                    amount: formatExpenseAmountInput(event.target.value),
                  })
                }
              />
              {row.expenseId === OTHER_EXPENSE_ID ? (
                <>
                  <label className="sr-only" htmlFor={`close-exp-other-${row.key}`}>
                    Detalle del gasto {index + 1}
                  </label>
                  <input
                    id={`close-exp-other-${row.key}`}
                    className="collector-close-expense-other"
                    autoComplete="off"
                    placeholder="¿Cuál gasto? (escríbelo)"
                    value={row.customLabel}
                    onChange={(event) => updateRow(row.key, { customLabel: event.target.value })}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="collector-close-actions is-links">
          <button type="submit" className="collector-mobile-pay-link">
            guardar
          </button>
        </div>
      </form>

      {expensesTotal > 0 ? (
        <p className="collector-close-saved-hint">Total: {money(expensesTotal)}</p>
      ) : null}

      {expensesTotal > draft.collected && draft.collected > 0 ? (
        <p className="receipt-error" role="alert">
          Los gastos ({money(expensesTotal)}) superan el recaudo ({money(draft.collected)}).
        </p>
      ) : null}
    </div>
  );
}
