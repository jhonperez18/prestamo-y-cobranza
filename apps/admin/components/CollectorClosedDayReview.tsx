"use client";

import { Pill } from "@/components/ui";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { operativeExpenseLines } from "@/lib/expense-lines";
import { money, type ClientRow, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { paymentVisitDate } from "@/lib/late-payment";
import { routeBlockStarts } from "@/lib/client-route-order";
import {
  paymentCatalogClientName,
  paymentDisplayMethod,
  paymentMethodForRoute,
  paymentMethodInitial,
  paymentMethodLabel,
  paymentMethodToneClass,
  type PaymentMethod,
} from "@/lib/payment-method";
import { withPaymentEvidence } from "@/lib/payment-evidence-store";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
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
  /**
   * Lista canónica de PG- del Total Cobrado hoy (ruta). Si viene, COBROS lista y suma
   * estos pagos — misma cifra que el Total. Sin esto, cae a visitas (legado).
   */
  cobroPayments?: PaymentRow[];
  loans?: LoanRow[];
  clients?: ClientRow[];
  /** Adjuntar comprobante (Nequi/Banco) desde el recaudo. */
  onAttachPaymentEvidence?: (paymentRef: string, evidence: PaymentEvidenceRef[]) => void;
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
      paymentVisitDate(row) === day &&
      (row.loanRef || "") === loanRef &&
      (!row.collectorRef || !item.collectorRef || row.collectorRef === item.collectorRef) &&
      (Number(row.amount) || 0) > 0,
  );
}

/**
 * Efectivo pagado en el panel con destino «Solo sistema»: cubre la visita, pero esa plata no está
 * en la caja del cobrador. Banco / Nequi sí van al acumulado de la ruta.
 */
function isOfficeCash(pay: PaymentRow | undefined, clientRoute: string | undefined) {
  if (!pay || pay.collectorRef?.trim()) return false;
  return paymentMethodForRoute(pay.method, clientRoute) === "efectivo";
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
  cobroPayments,
  loans = [],
  clients = [],
  onAttachPaymentEvidence,
  onBack,
}: Props) {
  const useCanonList = detail === "cobros" && Array.isArray(cobroPayments);
  const canonPays = useCanonList
    ? cobroPayments.filter((pay) => {
        if (!methodFilter) return true;
        return paymentDisplayMethod(pay, loans, clients) === methodFilter;
      })
    : [];
  const cobros = useCanonList
    ? []
    : visits.filter((row) => {
        const pay = paymentForVisit(row, payments);
        if (!(row.visitStatus === "cobrado" || row.paymentRef || pay)) return false;
        if (!methodFilter) return true;
        if (!pay) return methodFilter === "efectivo";
        return paymentMethodForRoute(pay.method, row.clientRoute) === methodFilter;
      });
  const gastoLines = operativeExpenseLines(expenses);
  const expensesTotal = gastoLines.reduce((sum, row) => sum + row.amount, 0);
  const cobrosTotal = useCanonList
    ? canonPays.reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0)
    : cobros.reduce((sum, item) => {
        const pay = paymentForVisit(item, payments);
        if (isOfficeCash(pay, item.clientRoute)) return sum;
        return sum + (pay?.amount ?? item.amountDue);
      }, 0);
  const cobrosCountShown = useCanonList ? canonPays.length : cobros.length;

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
      : detail === "cobros"
        ? `${dateLabel} · ${cobrosCountShown} cobro${cobrosCountShown === 1 ? "" : "s"}`
        : `${dateLabel} · ${cobradoCount}/${visitTotal} cobros`;

  /** Raya verde entre Ruta 1 y Ruta 1.1 en la planilla cerrada. */
  const visitRouteStarts = routeBlockStarts(visits, (row) => row.clientRoute);

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
        gastoLines.length === 0 ? (
          <p className="collector-closed-review-empty">Sin gastos registrados.</p>
        ) : (
          <ul className="collector-closed-review-list">
            {gastoLines.map((line, index) => (
              <li key={`${line.id}:${line.label}:${index}`}>
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

      {detail === "cobros" && useCanonList ? (
        canonPays.length === 0 ? (
          <p className="collector-closed-review-empty">
            {methodFilter
              ? `Sin cobros en ${paymentMethodLabel(methodFilter).toLowerCase()}.`
              : "Sin cobros registrados."}
          </p>
        ) : (
          <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-day-ficha">
            {canonPays.map((payRaw) => {
              const pay = withPaymentEvidence(payRaw);
              const method = paymentDisplayMethod(pay, loans, clients);
              const office = !pay.collectorRef?.trim() && method === "efectivo";
              return (
                <li key={pay.ref}>
                  <strong className="is-name">{paymentCatalogClientName(pay, loans, clients)}</strong>
                  <span
                    className="is-when"
                    title={office ? "Pagado en oficina: no está en la caja del cobrador" : undefined}
                  >
                    {pay.paidTime?.trim() || "—"}
                    {office ? " · oficina" : ""}
                  </span>
                  <span className="is-loan">{pay.loanRef || "—"}</span>
                  <em
                    className={`is-method ${paymentMethodToneClass(method)}`}
                    title={paymentMethodLabel(method)}
                  >
                    {paymentMethodInitial(method)}
                  </em>
                  <span className="is-evidence">
                    <PaymentEvidenceThumb
                      evidence={pay.evidence}
                      size={28}
                      onAttach={
                        onAttachPaymentEvidence
                          ? (piece) => onAttachPaymentEvidence(pay.ref, [piece])
                          : undefined
                      }
                    />
                  </span>
                  <b className="is-cobro">{money(pay.amount, { symbol: false })}</b>
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

      {detail === "cobros" && !useCanonList ? (
        cobros.length === 0 ? (
          <p className="collector-closed-review-empty">
            {methodFilter
              ? `Sin cobros en ${paymentMethodLabel(methodFilter).toLowerCase()}.`
              : "Sin cobros registrados."}
          </p>
        ) : (
          <ul className="collector-closed-review-list is-cobros-cols has-evidence is-nequi-day-ficha">
            {cobros.map((item) => {
              const payRaw = paymentForVisit(item, payments);
              const pay = payRaw ? withPaymentEvidence(payRaw) : undefined;
              const method = pay ? paymentMethodForRoute(pay.method, item.clientRoute) : "efectivo";
              const amount = pay?.amount ?? item.amountDue;
              const loanRef = item.loanRef || "—";
              const when = pay?.paidTime?.trim() || "";
              const clientName = payerClientName(item, pay);
              const office = isOfficeCash(pay, item.clientRoute);
              return (
                <li key={item.itemId}>
                  <strong className="is-name">{clientName}</strong>
                  <span
                    className="is-when"
                    title={office ? "Pagado en oficina: no está en la caja del cobrador" : undefined}
                  >
                    {when || "—"}
                    {office ? " · oficina" : ""}
                  </span>
                  <span className="is-loan">{loanRef}</span>
                  <em
                    className={`is-method ${paymentMethodToneClass(method)}`}
                    title={paymentMethodLabel(method)}
                  >
                    {paymentMethodInitial(method)}
                  </em>
                  <span className="is-evidence">
                    <PaymentEvidenceThumb
                      evidence={pay?.evidence}
                      size={28}
                      onAttach={
                        pay?.ref && onAttachPaymentEvidence
                          ? (piece) => onAttachPaymentEvidence(pay.ref, [piece])
                          : undefined
                      }
                    />
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
              {visits.map((item, index) => {
                const pay = paymentForVisit(item, payments);
                const method = pay ? paymentMethodForRoute(pay.method, item.clientRoute) : null;
                const amount = pay?.amount ?? (item.amountDue > 0 ? item.amountDue : 0);
                const status = item.visitStatus ?? "pendiente";
                const loanRef = item.loanRef || (item.awaitingLoan ? "Completar" : "—");
                const methodLabel = method ? paymentMethodLabel(method).toLowerCase() : "";
                return (
                  <li
                    key={item.itemId}
                    className={visitRouteStarts[index] ? "is-route-start" : undefined}
                  >
                    <div className="collector-closed-review-line">
                      <strong>{payerClientName(item, pay)}</strong>
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
              {expenses.map((line, index) => (
                <li key={`${line.id}:${line.lineKey || line.loanRef || line.label}:${index}`}>
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
