"use client";

import { Pill } from "@/components/ui";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { money, type PaymentRow } from "@/lib/mock-data";
import {
  normalizePaymentMethod,
  paymentMethodInitial,
  paymentMethodLabel,
  paymentMethodRequiresReceipt,
  paymentMethodToneClass,
  type PaymentMethod,
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
  /** Si viene, el reporte de cobros solo muestra ese medio. */
  methodFilter?: PaymentMethod;
  onBack: () => void;
};

function paymentForVisit(item: DailyCollectionAssignment, payments: PaymentRow[]) {
  if (item.paymentRef) {
    const linked = payments.find((row) => row.ref === item.paymentRef);
    if (linked && !linked.voidedAt?.trim() && linked.type !== "Anulado") return linked;
  }
  const day = (item.dispatchDate || "").trim();
  const loanRef = (item.loanRef || "").trim();
  if (!day || !loanRef) return undefined;
  return payments.find(
    (row) =>
      !row.voidedAt?.trim() &&
      row.type !== "Anulado" &&
      (row.paidDate || "").trim() === day &&
      (row.loanRef || "") === loanRef &&
      (!row.collectorRef || !item.collectorRef || row.collectorRef === item.collectorRef) &&
      (Number(row.amount) || 0) > 0,
  );
}

/** Nombre de quien pagó: planilla primero, si no el PG- denormalizado. */
function payerClientName(item: DailyCollectionAssignment, pay: PaymentRow | undefined) {
  const fromVisit = item.clientName?.trim();
  if (fromVisit && fromVisit !== "—") return fromVisit;
  const fromPay = pay?.client?.trim();
  if (fromPay) return fromPay;
  return "—";
}

export function CollectorClosedDayReview({
  detail,
  dateLabel,
  visits,
  expenses,
  payments,
  cobradoCount,
  visitTotal,
  methodFilter,
  onBack,
}: Props) {
  const cobros = visits.filter((row) => {
    const pay = paymentForVisit(row, payments);
    if (!(row.visitStatus === "cobrado" || row.paymentRef || pay)) return false;
    if (!methodFilter) return true;
    if (!pay) return methodFilter === "efectivo";
    return normalizePaymentMethod(pay.method) === methodFilter;
  });
  const expensesTotal = expenses.reduce((sum, row) => sum + row.amount, 0);
  const cobrosTotal = cobros.reduce((sum, item) => {
    const pay = paymentForVisit(item, payments);
    return sum + (pay?.amount ?? item.amountDue);
  }, 0);

  const title =
    detail === "cobros"
      ? methodFilter === "nequi"
        ? "Cobros Nequi"
        : methodFilter === "banco"
          ? "Cobros banco"
          : methodFilter === "efectivo"
            ? "Cobros en efectivo"
            : "Recaudo del día"
      : detail === "gastos"
        ? "Gastos del día"
        : "Planilla cerrada";

  const subtitle =
    detail === "gastos"
      ? dateLabel
      : detail === "cobros" && methodFilter
        ? `${dateLabel} · ${cobros.length} cobro${cobros.length === 1 ? "" : "s"}`
        : `${dateLabel} · ${cobradoCount}/${visitTotal} cobros`;

  return (
    <section className="collector-closed-review" aria-label={title}>
      <div className="collector-closed-review-head">
        <div className="collector-closed-review-title-row">
          <div className="collector-closed-review-title-text">
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="collector-mobile-pay-link is-back" onClick={onBack}>
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
          <p className="collector-closed-review-empty">
            {methodFilter
              ? `Sin cobros en ${paymentMethodLabel(methodFilter).toLowerCase()}.`
              : "Sin cobros registrados."}
          </p>
        ) : (
          <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-day-ficha">
            {cobros.map((item) => {
              const pay = paymentForVisit(item, payments);
              const method = pay ? normalizePaymentMethod(pay.method) : "efectivo";
              const amount = pay?.amount ?? item.amountDue;
              const loanRef = item.loanRef || "—";
              const when = pay?.paidTime?.trim() || "";
              const clientName = payerClientName(item, pay);
              return (
                <li key={item.itemId}>
                  <strong className="is-name">{clientName}</strong>
                  <span className="is-when">{when || "—"}</span>
                  <span className="is-loan">{loanRef}</span>
                  <em
                    className={`is-method ${paymentMethodToneClass(method)}`}
                    title={paymentMethodLabel(method)}
                  >
                    {paymentMethodInitial(method)}
                  </em>
                  <span className="is-evidence">
                    {method && paymentMethodRequiresReceipt(method) ? (
                      <PaymentEvidenceThumb evidence={pay?.evidence} size={28} />
                    ) : (
                      <span className="payment-evidence-empty">—</span>
                    )}
                  </span>
                  <b className="is-cobro">{money(amount, { symbol: false })}</b>
                </li>
              );
            })}
            <li className="is-total">
              <span>
                Total{" "}
                {methodFilter ? paymentMethodLabel(methodFilter).toLowerCase() : "cobrado"}
              </span>
              <b>{money(cobrosTotal)}</b>
            </li>
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
