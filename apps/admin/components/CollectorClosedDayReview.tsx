"use client";

import { Pill } from "@/components/ui";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { money, type PaymentRow } from "@/lib/mock-data";
import {
  normalizePaymentMethod,
  paymentMethodLabel,
} from "@/lib/payment-method";
import { visitStatusKind, visitStatusLabel } from "@/lib/collector-mobile";

export type ClosedDayDetail = "cobros" | "gastos" | "planilla";

type Props = {
  detail: ClosedDayDetail;
  dateLabel: string;
  visits: DailyCollectionAssignment[];
  expenses: RouteExpenseLine[];
  payments: PaymentRow[];
  cobradoCount: number;
  visitTotal: number;
  onBack: () => void;
};

function paymentForVisit(item: DailyCollectionAssignment, payments: PaymentRow[]) {
  if (!item.paymentRef) return undefined;
  return payments.find((row) => row.ref === item.paymentRef);
}

export function CollectorClosedDayReview({
  detail,
  dateLabel,
  visits,
  expenses,
  payments,
  cobradoCount,
  visitTotal,
  onBack,
}: Props) {
  const cobros = visits.filter(
    (row) => row.visitStatus === "cobrado" || Boolean(row.paymentRef),
  );
  const expensesTotal = expenses.reduce((sum, row) => sum + row.amount, 0);

  const title =
    detail === "cobros"
      ? "Recaudo del día"
      : detail === "gastos"
        ? "Gastos del día"
        : "Planilla cerrada";

  const subtitle =
    detail === "gastos"
      ? dateLabel
      : `${dateLabel} · ${cobradoCount}/${visitTotal} cobros`;

  return (
    <section className="collector-closed-review" aria-label={title}>
      <div className="collector-closed-review-head">
        <div className="collector-closed-review-title-row">
          <div className="collector-closed-review-title-text">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="collector-mobile-pay-link" onClick={onBack}>
            volver
          </button>
        </div>
      </div>

      {detail === "gastos" ? (
        expenses.length === 0 ? (
          <p className="collector-closed-review-empty">Sin gastos registrados.</p>
        ) : (
          <ul className="collector-closed-review-list">
            {expenses.map((line) => (
              <li key={line.id}>
                <div className="collector-closed-review-line">
                  <strong>{line.label}</strong>
                </div>
                <b className="is-gasto">{money(line.amount)}</b>
              </li>
            ))}
            <li className="is-total">
              <span>Total gastos</span>
              <b>{money(expensesTotal)}</b>
            </li>
          </ul>
        )
      ) : null}

      {detail === "cobros" ? (
        cobros.length === 0 ? (
          <p className="collector-closed-review-empty">Sin cobros registrados.</p>
        ) : (
          <ul className="collector-closed-review-list">
            {cobros.map((item) => {
              const pay = paymentForVisit(item, payments);
              const method = pay ? normalizePaymentMethod(pay.method) : null;
              const amount = pay?.amount ?? item.amountDue;
              const loanRef = item.loanRef || "—";
              const methodLabel = method ? paymentMethodLabel(method).toLowerCase() : "";
              return (
                <li key={item.itemId}>
                  <div className="collector-closed-review-line">
                    <strong>{item.clientName}</strong>
                    <span>
                      {loanRef}
                      {methodLabel ? ` en ${methodLabel}` : ""}
                    </span>
                  </div>
                  <b className="is-cobro">{money(amount)}</b>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {detail === "planilla" ? (
        <>
          <h3 className="collector-closed-review-section">Visitas</h3>
          {visits.length === 0 ? (
            <p className="collector-closed-review-empty">Sin visitas en planilla.</p>
          ) : (
            <ul className="collector-closed-review-list">
              {visits.map((item) => {
                const pay = paymentForVisit(item, payments);
                const method = pay ? normalizePaymentMethod(pay.method) : null;
                const amount = pay?.amount ?? (item.amountDue > 0 ? item.amountDue : 0);
                const status = item.visitStatus ?? "pendiente";
                const loanRef = item.loanRef || (item.awaitingLoan ? "Completar" : "—");
                const methodLabel = method ? paymentMethodLabel(method).toLowerCase() : "";
                return (
                  <li key={item.itemId}>
                    <div className="collector-closed-review-line">
                      <strong>{item.clientName}</strong>
                      <span>
                        {loanRef}
                        {methodLabel ? ` en ${methodLabel}` : ""}
                      </span>
                    </div>
                    <div className="collector-closed-review-meta">
                      <Pill label={visitStatusLabel(status)} kind={visitStatusKind(status)} />
                      {amount > 0 && status === "cobrado" ? (
                        <b className="is-cobro">{money(amount)}</b>
                      ) : amount > 0 ? (
                        <b>{money(amount)}</b>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="collector-closed-review-section">Gastos</h3>
          {expenses.length === 0 ? (
            <p className="collector-closed-review-empty">Sin gastos registrados.</p>
          ) : (
            <ul className="collector-closed-review-list">
              {expenses.map((line) => (
                <li key={line.id}>
                  <div className="collector-closed-review-line">
                    <strong>{line.label}</strong>
                  </div>
                  <b className="is-gasto">{money(line.amount)}</b>
                </li>
              ))}
              <li className="is-total">
                <span>Total gastos</span>
                <b>{money(expensesTotal)}</b>
              </li>
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}
