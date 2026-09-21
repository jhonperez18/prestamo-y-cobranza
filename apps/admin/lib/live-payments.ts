import type { PaymentRow } from "@/lib/mock-data";

/** Pago vivo: cuenta para saldos, planilla y cobrado. */
export function isPaymentLive(row: PaymentRow) {
  return !row.voidedAt?.trim();
}

/** Solo PG- vigentes (excluye anulados). */
export function livePayments(rows: PaymentRow[]) {
  return rows.filter(isPaymentLive);
}

/** Solo PG- anulados (vista Anulaciones). */
export function voidedPayments(rows: PaymentRow[]) {
  return rows.filter((row) => Boolean(row.voidedAt?.trim()));
}
