"use client";

import { QuadDetailTable } from "@/components/QuadDetailTable";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { Pill } from "@/components/ui";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import type { PaymentMovement } from "@/lib/payment-detail";
import {
  normalizePaymentMethod,
  paymentMethodKind,
  paymentMethodLabel,
} from "@/lib/payment-method";
import { paymentHasReceipt } from "@/lib/payment-evidence";
import { money, type LoanRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";

type Props = {
  payment: PaymentRow;
  movement: PaymentMovement;
  loan: LoanRow | null;
  route: RouteRow | null;
  clientRef?: string;
  onOpenClient?: (ref: string) => void;
  onOpenLoan?: (ref: string) => void;
};

export function PaymentFicha({
  payment,
  movement,
  loan,
  route,
  clientRef,
  onOpenClient,
  onOpenLoan,
}: Props) {
  const method = normalizePaymentMethod(payment.method);
  const evidence = payment.evidence ?? movement.evidence;
  const hasReceipt = paymentHasReceipt(evidence);

  return (
    <section className="panel payment-ficha">
      <div className="head">
        <h1>Ficha de pago</h1>
        <span className="file-title-ref ref">{payment.ref}</span>
        <PaymentStatusPill payment={payment} loan={loan} />
        <div className="payment-ficha-badges">
          <Pill label={paymentMethodLabel(method)} kind={paymentMethodKind(method)} />
        </div>
      </div>

      <div className="payment-ficha-body">
        <div className="payment-ficha-evidence mini-block">
          <div className="mini-head payment-ficha-evidence-head">
            <h2>Comprobante de pago</h2>
            <div className="payment-ficha-head-actions">
              {loan && onOpenLoan ? (
                <button type="button" className="btn-bar light" onClick={() => onOpenLoan(loan.ref)}>
                  Ver préstamo {loan.ref}
                </button>
              ) : null}
              {clientRef && onOpenClient ? (
                <button type="button" className="btn-bar light" onClick={() => onOpenClient(clientRef)}>
                  Ver cliente
                </button>
              ) : null}
            </div>
          </div>
          {hasReceipt ? (
            <PaymentEvidenceThumb evidence={evidence} variant="panel" emptyLabel="—" />
          ) : (
            <p className="ficha-empty payment-ficha-no-evidence">No hay comprobante registrado.</p>
          )}
        </div>

        <div className="payment-ficha-details">
          <QuadDetailTable
            fields={[
              { label: "Cliente", value: payment.client },
              { label: "Referencia", value: payment.ref },
              { label: "Cobrador", value: movement.collector },
              { label: "Hora", value: movement.paidTime },
              {
                label: "Valor",
                value: money(payment.amount),
                money: true,
              },
              { label: "Fecha recaudo", value: movement.paidDate },
              {
                label: "Forma de pago",
                value: paymentMethodLabel(method),
              },
              { label: "Tipo", value: payment.type },
              { label: "Estado", value: movement.kind === "partial" ? "Parcial" : "Pagada" },
              { label: "Concepto", value: movement.chargeLabel },
              { label: "Fecha cuota", value: movement.dueDate },
              {
                label: "Préstamo",
                value: payment.loanRef ?? "—",
              },
              {
                label: "Cobrador asignado",
                value: movement.assignedCollector ?? "—",
              },
              {
                label: "Coincide asignación",
                value: movement.assignedCollector
                  ? movement.collectorMatch
                    ? "Sí"
                    : "No"
                  : "—",
              },
              { label: "Origen", value: movement.source },
              {
                label: "Ruta",
                value: route ? `${route.zone} · ${route.ref}` : payment.routeRef ?? "—",
              },
              {
                label: "GPS",
                value: payment.gps ? "Registrado" : "No",
              },
              {
                label: "Comprobante",
                value: hasReceipt ? "Adjunto" : "Sin comprobante",
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
