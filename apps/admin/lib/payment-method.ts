import type { StatusKind } from "@/lib/mock-data";

export type PaymentMethod = "efectivo" | "nequi";

export const PAYMENT_METHODS: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: "efectivo", label: "Efectivo", hint: "Dinero en mano en la visita" },
  { id: "nequi", label: "Nequi", hint: "Transferencia Nequi al recaudar" },
];

export function paymentMethodLabel(method?: PaymentMethod | string) {
  if (method === "nequi") return "Nequi";
  return "Efectivo";
}

export function paymentMethodKind(method?: PaymentMethod | string): StatusKind {
  return method === "nequi" ? "partial" : "ok";
}

export function normalizePaymentMethod(method?: PaymentMethod | string): PaymentMethod {
  return method === "nequi" ? "nequi" : "efectivo";
}
