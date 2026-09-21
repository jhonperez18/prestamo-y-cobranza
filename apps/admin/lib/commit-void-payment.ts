/**
 * Anulación canónica de un PG-:
 * marca voidedAt + motivo, recalcula préstamo/proyecciones vía pagos vivos.
 * El PG- sigue en la raíz (histórico); deja de sumar a saldos y cobrado.
 */
import { todayIso } from "@/lib/daily-dispatch";
import { syncLoan } from "@/lib/loan-preview";
import { isPaymentLive, livePayments } from "@/lib/live-payments";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";

export type VoidPaymentInput = {
  paymentRef: string;
  reason: string;
  voidedBy: string;
  payments: PaymentRow[];
  loans: LoanRow[];
  now?: Date;
};

export type VoidPaymentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      payment: PaymentRow;
      payments: PaymentRow[];
      loans: LoanRow[];
    };

export function commitVoidPayment(input: VoidPaymentInput): VoidPaymentResult {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Indica el motivo de la anulación." };

  const target = input.payments.find((row) => row.ref === input.paymentRef);
  if (!target) return { ok: false, error: "Pago no encontrado." };
  if (!isPaymentLive(target)) return { ok: false, error: "Este pago ya está anulado." };

  const now = input.now ?? new Date();
  const voidedAt = now.toISOString();
  const voided: PaymentRow = {
    ...target,
    voidedAt,
    voidReason: reason,
    voidedBy: input.voidedBy.trim() || "—",
    type: "Anulado",
  };

  const payments = input.payments.map((row) => (row.ref === voided.ref ? voided : row));
  const live = livePayments(payments);
  const loans = input.loans.map((loan) => {
    if (loan.ref !== target.loanRef) return loan;
    return syncLoan(loan, live) as LoanRow;
  });

  return { ok: true, payment: voided, payments, loans };
}

export function voidStampLabel(payment: PaymentRow) {
  if (!payment.voidedAt) return "";
  const d = payment.voidedAt.slice(0, 10);
  return d === todayIso() ? "Hoy" : d;
}
