import type { StatusKind } from "@/lib/mock-data";

export type PaymentMethod = "efectivo" | "nequi" | "banco";

export const PAYMENT_METHODS: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: "efectivo", label: "Efectivo", hint: "Dinero en mano · requiere firma" },
  { id: "nequi", label: "Nequi", hint: "Transferencia Nequi · requiere comprobante" },
  { id: "banco", label: "Banco", hint: "Consignación / transferencia · requiere comprobante" },
];

/** Acepta id (`nequi`), etiqueta (`Nequi`) o inicial (`N`/`E`/`B`); nunca infiere desde evidencia. */
export function normalizePaymentMethod(method?: PaymentMethod | string | null): PaymentMethod {
  const raw = String(method ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (raw === "nequi" || raw === "n") return "nequi";
  if (raw === "banco" || raw === "b" || raw === "transferencia" || raw === "consignacion") {
    return "banco";
  }
  if (raw === "efectivo" || raw === "e") return "efectivo";
  return "efectivo";
}

export function paymentMethodLabel(method?: PaymentMethod | string | null) {
  const normalized = normalizePaymentMethod(method);
  if (normalized === "nequi") return "Nequi";
  if (normalized === "banco") return "Banco";
  return "Efectivo";
}

/** Inicial compacta para columnas / pills de listados (N / E / B). */
export function paymentMethodInitial(method?: PaymentMethod | string | null) {
  const normalized = normalizePaymentMethod(method);
  if (normalized === "nequi") return "N";
  if (normalized === "banco") return "B";
  return "E";
}

/** Props seguras para Pill de método en tablas (nunca lanza). */
export function paymentMethodPillProps(method?: PaymentMethod | string | null) {
  const normalized = normalizePaymentMethod(method);
  return {
    label: paymentMethodInitial(normalized),
    kind: paymentMethodKind(normalized),
    title: paymentMethodLabel(normalized),
  };
}

export function paymentMethodKind(method?: PaymentMethod | string | null): StatusKind {
  return normalizePaymentMethod(method);
}

/** Clase CSS para tintar filas / celdas según forma de pago. */
export function paymentMethodToneClass(method?: PaymentMethod | string | null) {
  const normalized = normalizePaymentMethod(method);
  if (normalized === "nequi") return "is-pay-nequi";
  if (normalized === "banco") return "is-pay-banco";
  return "is-pay-efectivo";
}

/** Efectivo entra a caja del cobrador; Nequi/Banco van a cuenta del dueño. */
export function paymentMethodIsCash(method?: PaymentMethod | string | null) {
  return normalizePaymentMethod(method) === "efectivo";
}

/** Nequi o Banco: requieren foto de comprobante (no firma). */
export function paymentMethodRequiresReceipt(method?: PaymentMethod | string | null) {
  const normalized = normalizePaymentMethod(method);
  return normalized === "nequi" || normalized === "banco";
}

export function paymentMethodRequiresSignature(method?: PaymentMethod | string | null) {
  return normalizePaymentMethod(method) === "efectivo";
}

export function paymentMethodEvidenceHint(method?: PaymentMethod | string | null) {
  const normalized = normalizePaymentMethod(method);
  if (normalized === "nequi") return "Requiere comprobante";
  if (normalized === "banco") return "Requiere comprobante";
  return "Requiere firma";
}
