"use client";

import { Pill } from "@/components/ui";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { cuotaAmountForPayment, paymentSettlementStatus } from "@/lib/payment-detail";

type Props = {
  payment: PaymentRow;
  loan?: LoanRow | null;
};

export function PaymentStatusPill({ payment, loan }: Props) {
  if (payment.voidedAt?.trim()) {
    return <Pill label="Anulado" kind="warn" title={payment.voidReason || "Pago anulado"} />;
  }
  const status = paymentSettlementStatus(payment, cuotaAmountForPayment(payment, loan));
  return <Pill label={status.label} kind={status.kind} />;
}
