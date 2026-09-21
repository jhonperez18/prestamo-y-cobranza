"use client";

import { useState } from "react";
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
import { paymentHasReceipt, paymentHasSignature, primaryPaymentEvidence } from "@/lib/payment-evidence";
import { money, type LoanRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";
import { isPaymentLive } from "@/lib/live-payments";

type Props = {
  payment: PaymentRow;
  movement: PaymentMovement;
  loan: LoanRow | null;
  route: RouteRow | null;
  clientRef?: string;
  onOpenClient?: (ref: string) => void;
  onOpenLoan?: (ref: string) => void;
  onVoidPayment?: (paymentRef: string, reason: string) => void;
};

export function PaymentFicha({
  payment,
  movement,
  loan,
  route,
  clientRef,
  onOpenClient,
  onOpenLoan,
  onVoidPayment,
}: Props) {
  const method = normalizePaymentMethod(payment.method);
  const evidence = payment.evidence ?? movement.evidence;
  const item = primaryPaymentEvidence(evidence);
  const hasReceipt = paymentHasReceipt(evidence);
  const hasSignature = paymentHasSignature(evidence);
  const evidenceTitle = hasSignature && !hasReceipt ? "Firma del cliente" : "Comprobante de pago";
  const live = isPaymentLive(payment);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  function confirmVoid() {
    const reason = voidReason.trim();
    if (!reason || !onVoidPayment) return;
    onVoidPayment(payment.ref, reason);
    setVoidOpen(false);
    setVoidReason("");
  }

  return (
    <section className="panel payment-ficha">
      <div className="head">
        <h1>Ficha de pago</h1>
        <span className="file-title-ref ref">{payment.ref}</span>
        <PaymentStatusPill payment={payment} loan={loan} />
        <div className="payment-ficha-badges">
          <Pill label={paymentMethodLabel(method)} kind={paymentMethodKind(method)} />
        </div>
        <div className="grow" />
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
          {live && onVoidPayment ? (
            <button type="button" className="btn-bar light" onClick={() => setVoidOpen((v) => !v)}>
              Anular
            </button>
          ) : null}
        </div>
      </div>

      {voidOpen && live && onVoidPayment ? (
        <div className="payment-void-box" style={{ margin: "0 0 12px", display: "grid", gap: 8, maxWidth: 420 }}>
          <label>
            Motivo de anulación
            <input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Ej. cobro duplicado"
              autoFocus
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" disabled={!voidReason.trim()} onClick={confirmVoid}>
              Confirmar anulación
            </button>
            <button type="button" className="btn secondary" onClick={() => setVoidOpen(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {!live ? (
        <p className="ficha-empty" style={{ marginBottom: 10 }}>
          Anulado {payment.voidedAt?.slice(0, 10) || ""} · {payment.voidReason || "—"} ·{" "}
          {payment.voidedBy || "—"}
        </p>
      ) : null}

      <div className="payment-ficha-body">
        <div className="payment-ficha-evidence mini-block">
          <div className="mini-head payment-ficha-evidence-head">
            <h2>{evidenceTitle}</h2>
          </div>
          {item ? (
            <PaymentEvidenceThumb evidence={evidence} variant="panel" emptyLabel="—" />
          ) : (
            <p className="ficha-empty payment-ficha-no-evidence">
              {hasSignature ? "No hay firma registrada." : "No hay comprobante registrado."}
            </p>
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
                label: "Cuota pactada",
                value: movement.cuotaPactada > 0 ? money(movement.cuotaPactada) : "—",
                money: movement.cuotaPactada > 0,
              },
              {
                label: "Cobrado",
                value: money(payment.amount),
                money: true,
              },
              { label: "Fecha recaudo", value: movement.paidDate },
              {
                label: "Forma de pago",
                value: paymentMethodLabel(method),
              },
              { label: "Tipo", value: payment.type },
              {
                label: "Estado",
                value: live
                  ? movement.settlementLabel || (movement.kind === "partial" ? "Parcial" : "Pagada")
                  : "Anulado",
              },
              { label: "Concepto", value: movement.chargeLabel },
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
                label: hasSignature && !hasReceipt ? "Firma" : "Comprobante",
                value: item ? "Adjunto" : hasSignature ? "Sin firma" : "Sin comprobante",
              },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
