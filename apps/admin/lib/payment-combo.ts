/**
 * Cobro combinado: dos PG- del mismo cliente/día (p. ej. efectivo + Nequi),
 * misma fecha/hora, ligados por comboGroupId. Distintivo naranja en UI.
 */
import type { PaymentMethod } from "@/lib/payment-method";
import type { PaymentRow } from "@/lib/mock-data";
import { isPaymentLive } from "@/lib/live-payments";

const COMBO_CHARGE_PREFIX = "CMB:";

export function newComboGroupId() {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `CMB-${Date.now().toString(36)}-${rand}`;
}

/** Persiste el vínculo en charge_label (columna que ya viaja a la nube). */
export function encodeComboChargeLabel(
  chargeLabel: string | undefined,
  comboGroupId: string,
) {
  const id = comboGroupId.trim();
  if (!id) return chargeLabel?.trim() || undefined;
  const base = (chargeLabel || "").trim();
  return `${COMBO_CHARGE_PREFIX}${id}|${base}`;
}

export function parseComboChargeLabel(chargeLabel?: string | null): {
  comboGroupId?: string;
  chargeLabel?: string;
} {
  const raw = (chargeLabel || "").trim();
  if (!raw.startsWith(COMBO_CHARGE_PREFIX)) {
    return { chargeLabel: raw || undefined };
  }
  const rest = raw.slice(COMBO_CHARGE_PREFIX.length);
  const pipe = rest.indexOf("|");
  if (pipe <= 0) return { chargeLabel: raw };
  const comboGroupId = rest.slice(0, pipe).trim();
  const label = rest.slice(pipe + 1).trim();
  return {
    comboGroupId: comboGroupId || undefined,
    chargeLabel: label || undefined,
  };
}

export function paymentComboGroupId(payment: Pick<PaymentRow, "comboGroupId" | "chargeLabel">) {
  const direct = payment.comboGroupId?.trim();
  if (direct) return direct;
  return parseComboChargeLabel(payment.chargeLabel).comboGroupId;
}

/** Visita con cobro combinado (dos tramos vivos mismo grupo). */
export function visitHasCombinedPayment(
  payments: PaymentRow[],
  input: { loanRef?: string; clientRef?: string; dispatchDate: string },
) {
  const day = input.dispatchDate.trim();
  if (!day) return false;
  const live = payments.filter((row) => {
    if (!isPaymentLive(row)) return false;
    if ((row.paidDate || "").trim() !== day) return false;
    if (input.loanRef && row.loanRef && row.loanRef !== input.loanRef) return false;
    return Boolean(paymentComboGroupId(row));
  });
  const groups = new Map<string, number>();
  for (const row of live) {
    const id = paymentComboGroupId(row);
    if (!id) continue;
    groups.set(id, (groups.get(id) ?? 0) + 1);
  }
  for (const count of groups.values()) {
    if (count >= 2) return true;
  }
  return live.some((row) => Boolean(paymentComboGroupId(row)));
}

export function combinedMethodsLabel(methods: PaymentMethod[]) {
  const initials = methods.map((m) => {
    if (m === "nequi") return "N";
    if (m === "banco") return "B";
    return "E";
  });
  return initials.join("+");
}
