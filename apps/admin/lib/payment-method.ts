import type { StatusKind } from "@/lib/mock-data";

export type PaymentMethod = "efectivo" | "nequi";

export const PAYMENT_METHODS: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: "efectivo", label: "Efectivo", hint: "Dinero en mano en la visita" },
  { id: "nequi", label: "Nequi", hint: "Transferencia Nequi al recaudar" },
];

/** Acepta id (`nequi`) o etiqueta (`Nequi`); nunca infiere desde evidencia u otros campos. */
export function normalizePaymentMethod(method?: PaymentMethod | string | null): PaymentMethod {
  const raw = String(method ?? "").trim().toLowerCase();
  return raw === "nequi" ? "nequi" : "efectivo";
}

export function paymentMethodLabel(method?: PaymentMethod | string | null) {
  return normalizePaymentMethod(method) === "nequi" ? "Nequi" : "Efectivo";
}

export function paymentMethodKind(method?: PaymentMethod | string | null): StatusKind {
  return normalizePaymentMethod(method) === "nequi" ? "nequi" : "efectivo";
}

/** Clase CSS para tintar filas / celdas según forma de pago. */
export function paymentMethodToneClass(method?: PaymentMethod | string | null) {
  return normalizePaymentMethod(method) === "nequi" ? "is-pay-nequi" : "is-pay-efectivo";
}
