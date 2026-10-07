import type { PaymentRow } from "@/lib/mock-data";

/** Pago vivo: cuenta para saldos, planilla, cobrado y registro Banco. */
export function isPaymentLive(row: PaymentRow) {
  if (row.voidedAt?.trim()) return false;
  return (row.type || "").trim().toLowerCase() !== "anulado";
}

/** Solo PG- vigentes (excluye anulados). */
export function livePayments(rows: PaymentRow[]) {
  return rows.filter(isPaymentLive);
}

/** Solo PG- anulados (vista Anulaciones). */
export function voidedPayments(rows: PaymentRow[]) {
  return rows.filter((row) => !isPaymentLive(row));
}
