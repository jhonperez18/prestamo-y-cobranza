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

type DraftRow = {
  key: string;
  expenseId: RouteExpenseId | "";
  amount: string;
};

type Props = {
  draft: CollectorDayCloseDraft;
  onCancel: () => void;
  /** Guarda gastos sin cerrar el día. */
  onSave: (expenses: RouteExpenseLine[]) => void;
};

function newRow(): DraftRow {
  return {
    key: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    expenseId: "",
    amount: "",
  };
}

function rowsFromExpenses(expenses: RouteExpenseLine[]): DraftRow[] {
  const filled = expenses
    .filter((line) => line.amount > 0)
    .map((line, index) => ({
      key: `saved-${line.id}-${index}`,
      expenseId: line.id as RouteExpenseId,
      amount: formatExpenseAmountInput(line.amount),
    }));
  if (filled.length === 0) return [newRow(), newRow()];
  return [...filled, newRow()];
}

function toExpenseLines(rows: DraftRow[]): RouteExpenseLine[] {
  const lines: RouteExpenseLine[] = [];
  for (const row of rows) {
    const amount = parseExpenseAmount(row.amount);
    if (!row.expenseId || amount <= 0) continue;
    const item = ROUTE_EXPENSE_ITEMS.find((entry) => entry.id === row.expenseId);
    if (!item) continue;
    lines.push({
      id: item.id,
      label: item.label,
      category: item.category,
      amount,
    });
  }
  return lines;
}

export function CollectorCloseDaySheet({ draft, onCancel, onSave }: Props) {
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromExpenses(draft.expenses));
  const lines = useMemo(() => toExpenseLines(rows), [rows]);
  const expensesTotal = sumExpenseLines(lines);

  function ensureExtraRow(nextRows: DraftRow[]) {
    const last = nextRows[nextRows.length - 1];
    const lastFilled =
      Boolean(last?.expenseId) && parseExpenseAmount(last?.amount ?? "") > 0;
    if (lastFilled && nextRows.length < ROUTE_EXPENSE_ITEMS.length) {
      return [...nextRows, newRow()];
    }
    return nextRows;
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((current) => {
      const next = current.map((row) => (row.key === key ? { ...row, ...patch } : row));
      return ensureExtraRow(next);
    });
  }

  function usedExpenseIds(exceptKey?: string) {
    return new Set(
      rows
        .filter((row) => row.key !== exceptKey && row.expenseId)
        .map((row) => row.expenseId as RouteExpenseId),
    );
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
          {rows.map((row, index) => {
            const taken = usedExpenseIds(row.key);
            const options = ROUTE_EXPENSE_ITEMS.filter(
              (item) => !taken.has(item.id) || item.id === row.expenseId,
            );
            return (
              <li key={row.key} className="collector-close-expense-row">
                <label className="sr-only" htmlFor={`close-exp-type-${row.key}`}>
                  Tipo de gasto {index + 1}
                </label>
                <select
                  id={`close-exp-type-${row.key}`}
                  value={row.expenseId}
                  onChange={(event) =>
                    updateRow(row.key, {
                      expenseId: event.target.value as RouteExpenseId | "",
                    })
                  }
                >
                  <option value="">Elegir gasto…</option>
                  {options.map((item) => (
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
              </li>
            );
          })}
        </ul>

        <div className="collector-close-actions is-links">
          <button type="button" className="collector-mobile-pay-link" onClick={onCancel}>
            volver
          </button>
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
