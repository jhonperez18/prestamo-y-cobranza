import type { PayKind } from "@/lib/loan-pay";
import type { PaymentMethod } from "@/lib/payment-method";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";

/**
 * Payload de cobro desde CollectorPayForm.
 * El shell agrega loanRef / collector al llamar la API nube.
 */
export type CollectorPaySubmit = {
  amount: number;
  kind: PayKind;
  method: PaymentMethod;
  evidence: PaymentEvidenceRef[];
  idempotencyKey: string;
  /** Cobro en dos métodos (efectivo + nequi/banco, etc.). */
  combined?: {
    comboGroupId: string;
    paidTime: string;
    parts: [
      {
        amount: number;
        method: PaymentMethod;
        evidence: PaymentEvidenceRef[];
        idempotencyKey: string;
      },
      {
        amount: number;
        method: PaymentMethod;
        evidence: PaymentEvidenceRef[];
        idempotencyKey: string;
      },
    ];
  };
};

/** CollectorPaySubmit + contexto del préstamo para POST /api/loans[/pay]. */
export type CollectorPayApiBody = CollectorPaySubmit & {
  loanRef: string;
  clientName?: string;
  collectorRef?: string;
  collectorName?: string;
  paidDate?: string;
  paidTime?: string;
  routeRef?: string;
  chargeLabel?: string;
  paymentRef?: string;
  paymentRefs?: [string, string];
};
