/**
 * C2: espejo de cobros hacia Supabase (dual-write).
 * No sustituye localStorage; si falla o no hay env, el demo sigue.
 * @see docs/demo-to-backend.md
 * @see docs/operational-money.md
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { PaymentRow } from "@/lib/mock-data";
import { normalizeHistoryDate } from "@/lib/collector-day-close";

export type PaymentMirrorRow = {
  ref: string;
  loan_ref: string;
  client_ref: string | null;
  collector_ref: string | null;
  collector_name: string | null;
  amount: number;
  paid_date: string;
  paid_time: string | null;
  due_date: string | null;
  charge_label: string | null;
  method: string;
  source: string;
  payment_type: string | null;
  payment_kind: string | null;
  route_ref: string | null;
  updated_at: string;
};

export function paymentRowToMirror(payment: PaymentRow): PaymentMirrorRow | null {
  const loanRef = (payment.loanRef || "").trim();
  const paidDate = normalizeHistoryDate(payment.paidDate || "") || payment.paidDate;
  if (!loanRef || !paidDate || !(Number(payment.amount) > 0)) return null;
  return {
    ref: payment.ref,
    loan_ref: loanRef,
    client_ref: null,
    collector_ref: payment.collectorRef?.trim() || null,
    collector_name: payment.collector?.trim() || null,
    amount: Number(payment.amount),
    paid_date: paidDate,
    paid_time: payment.paidTime?.trim() || null,
    due_date: normalizeHistoryDate(payment.dueDate || "") || payment.dueDate || null,
    charge_label: payment.chargeLabel?.trim() || null,
    method: payment.method || "efectivo",
    source: payment.source || "ruta",
    payment_type: payment.type || null,
    payment_kind: payment.kind || null,
    route_ref: payment.routeRef?.trim() || null,
    updated_at: new Date().toISOString(),
  };
}

function createMirrorClient(): SupabaseClient | null {
  const { url, anonKey, configured } = getSupabasePublicEnv();
  if (!configured) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type MirrorPaymentResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

/** Upsert un cobro en public.payments. Seguro llamar tras commit local. */
export async function mirrorPaymentToSupabase(
  payment: PaymentRow,
): Promise<MirrorPaymentResult> {
  const row = paymentRowToMirror(payment);
  if (!row) return { ok: true, skipped: true, reason: "invalid_payment" };

  const client = createMirrorClient();
  if (!client) return { ok: true, skipped: true, reason: "supabase_not_configured" };

  const { error } = await client.from("payments").upsert(row, { onConflict: "ref" });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Disparo fire-and-forget desde el browser (no bloquea la UX del cobro). */
export function queuePaymentMirror(payment: PaymentRow) {
  if (typeof window === "undefined") return;
  const { configured } = getSupabasePublicEnv();
  if (!configured) return;
  void fetch("/api/payments/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payment }),
    keepalive: true,
  }).catch(() => {
    /* el demo local ya guardó; el espejo es best-effort */
  });
}
