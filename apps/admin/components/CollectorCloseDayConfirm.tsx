"use client";

import { cashFloatAfterExpenses, sumExpenseLines, type RouteExpenseLine } from "@/lib/collector-day-close";
import { splitDayExpenses } from "@/lib/collector-history-planilla";
import { money } from "@/lib/mock-data";

type Props = {
  dateLabel: string;
  collected: number;
  efectivo: number;
  nequi: number;
  banco?: number;
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
  banco = 0,
  expenses,
  pendingCount,
  onCancel,
  onConfirm,
}: Props) {
  const split = splitDayExpenses(expenses);
  const expensesTotal = sumExpenseLines(expenses);
  const cashFloat = cashFloatAfterExpenses(efectivo, expensesTotal);

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
        <div className="is-pay-banco">
          <em>Banco</em>
          <b>{money(banco)}</b>
        </div>
        <div className="is-total">
          <em>Total cobrado</em>
          <b>{money(collected)}</b>
        </div>
      </div>

      <div className="collector-close-confirm-block">
        <div className="is-prestamos">
          <em>Préstamos</em>
          <b>{money(split.prestamosTotal)}</b>
        </div>
        <div>
          <em>Gastos</em>
          <b>{money(split.otrosTotal)}</b>
        </div>
        <div className="is-float">
          <em>Caja (efectivo − gastos − préstamos)</em>
          <b>{money(cashFloat)}</b>
        </div>
      </div>

      {split.prestamos.length > 0 ? (
        <ul className="collector-close-confirm-expenses is-prestamos" aria-label="Préstamos del día">
          {split.prestamos.map((line) => (
            <li key={`${line.id}:${line.loanRef || line.label}`} className="is-prestamo">
              <span>{line.label}</span>
              <b>{money(line.amount)}</b>
            </li>
          ))}
        </ul>
      ) : null}

      {split.otros.length > 0 ? (
        <ul className="collector-close-confirm-expenses" aria-label="Gastos del día">
          {split.otros.map((line) => (
            <li key={`${line.id}:${line.label}`}>
              <span>{line.label}</span>
              <b>{money(line.amount)}</b>
            </li>
          ))}
        </ul>
      ) : split.prestamos.length === 0 ? (
        <p className="collector-close-confirm-empty">Sin gastos ni préstamos registrados.</p>
      ) : null}

      {pendingCount > 0 ? (
        <p className="receipt-error" role="alert">
          Quedan {pendingCount} pendiente{pendingCount === 1 ? "" : "s"} → alerta (mora al 4.º
          día hábil sin pago).
        </p>
      ) : null}

      <p className="collector-close-confirm-warn">
        Al confirmar, el día queda cerrado.
      </p>

      <div className="collector-close-actions is-links">
        <button type="button" className="collector-mobile-pay-link is-back" onClick={onCancel}>
          volver
        </button>
        <button type="button" className="collector-mobile-pay-link is-confirm" onClick={onConfirm}>
          confirmar
        </button>
      </div>
    </div>
  );
}
