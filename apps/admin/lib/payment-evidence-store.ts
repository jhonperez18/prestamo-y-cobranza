/**
 * Evidencia de pago (comprobante/firma) aparte del array de pagos.
 * Evita perder la foto cuando el mirror remoto no trae `evidence`.
 */
import {
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  preferRicherEvidence,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";
import type { PaymentRow } from "@/lib/mock-data";

export const DEMO_PAYMENT_EVIDENCE_KEY = "nexo-demo-payment-evidence";

type EvidenceMap = Record<string, PaymentEvidenceRef[]>;

function readMap(): EvidenceMap {
  return readDemoJson<EvidenceMap>(DEMO_PAYMENT_EVIDENCE_KEY, {});
}

function writeMap(map: EvidenceMap) {
  writeDemoJson(DEMO_PAYMENT_EVIDENCE_KEY, map);
}

/** Guarda evidencia por ref de pago (PG-…). No pisa una foto real con metadata sola. */
export function rememberPaymentEvidence(ref: string, evidence?: PaymentEvidenceRef[]) {
  const key = ref.trim();
  if (!key || typeof window === "undefined") return;
  if (!evidence?.length) return;
  const map = readMap();
  const next = preferRicherEvidence(evidence, map[key]);
  if (!next?.length) return;
  map[key] = next;
  writeMap(map);
}

export function storedEvidenceForPayment(ref: string): PaymentEvidenceRef[] | undefined {
  const key = ref.trim();
  if (!key || typeof window === "undefined") return undefined;
  const rows = readMap()[key];
  return rows?.length ? rows : undefined;
}

/** Prefiere la evidencia más rica entre pago y sidecar. */
export function resolvePaymentEvidence(
  payment: Pick<PaymentRow, "ref" | "evidence">,
): PaymentEvidenceRef[] | undefined {
  return preferRicherEvidence(payment.evidence, storedEvidenceForPayment(payment.ref));
}

export function withPaymentEvidence<T extends PaymentRow>(payment: T): T {
  const evidence = resolvePaymentEvidence(payment);
  if (!evidence?.length) return payment;
  if (payment.evidence === evidence) return payment;
  return { ...payment, evidence };
}

/** Indexa evidencias presentes en la lista de pagos (migración suave). */
export function indexPaymentEvidenceFromPayments(payments: PaymentRow[]) {
  if (typeof window === "undefined") return;
  let changed = false;
  const map = readMap();
  for (const row of payments) {
    if (!row.ref || !row.evidence?.length) continue;
    if (!map[row.ref]) {
      map[row.ref] = row.evidence;
      changed = true;
    }
  }
  if (changed) writeMap(map);
}
