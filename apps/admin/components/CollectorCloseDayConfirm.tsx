"use client";

import { cashFloatAfterExpenses, sumExpenseLines, type RouteExpenseLine } from "@/lib/collector-day-close";
import { money } from "@/lib/mock-data";

type Props = {
  dateLabel: string;
  collected: number;
  efectivo: number;
  nequi: number;
  expenses: RouteExpenseLine[];
  pendingCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CollectorCloseDayConfirm({
  dateLabel,
  collected,
  efectivo,
  nequi,
  expenses,
  pendingCount,
  onCancel,
  onConfirm,
}: Props) {
  const expensesTotal = sumExpenseLines(expenses);
  const cashFloat = cashFloatAfterExpenses(collected, expensesTotal);

  return (
    <div
      className="collector-close-confirm"
      role="dialog"
      aria-labelledby="collector-close-confirm-title"
    >
      <h2 id="collector-close-confirm-title">Revisar cierre</h2>
      <p className="collector-close-confirm-sub">{dateLabel}</p>

      <div className="collector-mobile-cuadre-grid collector-close-confirm-grid">
        <div className="is-pay-efectivo">
          <em>Efectivo</em>
          <b>{money(efectivo)}</b>
        </div>
        <div className="is-pay-nequi">
          <em>Nequi</em>
          <b>{money(nequi)}</b>
        </div>
        <div className="is-total">
          <em>Total cobrado</em>
          <b>{money(collected)}</b>
        </div>
      </div>

      <div className="collector-close-confirm-block">
        <div>
          <em>Gastos</em>
          <b>{money(expensesTotal)}</b>
        </div>
        <div className="is-float">
          <em>Caja / saldo</em>
          <b>{money(cashFloat)}</b>
        </div>
      </div>

      {expenses.length > 0 ? (
        <ul className="collector-close-confirm-expenses">
          {expenses.map((line) => (
            <li key={line.id}>
              <span>{line.label}</span>
              <b>{money(line.amount)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="collector-close-confirm-empty">Sin gastos registrados.</p>
      )}

      {pendingCount > 0 ? (
        <p className="receipt-error" role="alert">
          Quedan {pendingCount} pendiente{pendingCount === 1 ? "" : "s"} → alerta (mora solo al 5.º
          sin pago).
        </p>
      ) : null}

      <p className="collector-close-confirm-warn">
        Al confirmar, el día queda cerrado.
      </p>

      <div className="collector-close-actions is-links">
        <button type="button" className="collector-mobile-pay-link" onClick={onCancel}>
          volver
        </button>
        <button type="button" className="collector-mobile-pay-link is-confirm" onClick={onConfirm}>
          confirmar
        </button>
      </div>
    </div>
  );
}
