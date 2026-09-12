/**
 * C2/C3: espejo y lectura de cobros en Supabase.
 * Escritura = dual-write; lectura = fusiona por `ref` en localStorage (aún raíz demo).
 * @see docs/demo-to-backend.md
 * @see docs/operational-money.md
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { PaymentMethod, PaymentRow, StatusKind } from "@/lib/mock-data";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import {
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import type { LoanRow } from "@/lib/mock-data";

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

const STATUS_KINDS = new Set<StatusKind>([
  "paid",
  "pending",
  "partial",
  "overdue",
  "ok",
  "draft",
  "warn",
  "closed",
  "efectivo",
  "nequi",
]);

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

function mapSource(source: string | null | undefined): PaymentRow["source"] {
  if (source === "caja") return "caja";
  return "pwa";
}

function mapMethod(method: string | null | undefined): PaymentMethod {
  return method === "nequi" ? "nequi" : "efectivo";
}

function mapKind(kind: string | null | undefined): StatusKind {
  if (kind && STATUS_KINDS.has(kind as StatusKind)) return kind as StatusKind;
  return "paid";
}

/** DB → PaymentRow (campos UI rellenados lo mejor posible). */
export function mirrorRowToPaymentRow(row: PaymentMirrorRow): PaymentRow | null {
  const ref = (row.ref || "").trim();
  const loanRef = (row.loan_ref || "").trim();
  const paidDate = normalizeHistoryDate(row.paid_date || "") || row.paid_date;
  const amount = Number(row.amount);
  if (!ref || !loanRef || !paidDate || !(amount > 0)) return null;

  const paidTime = (row.paid_time || "").trim() || "00:00";
  return {
    ref,
    loanRef,
    when: `${isoToDispatchLabel(paidDate)} · ${paidTime}`,
    paidDate,
    paidTime,
    dueDate: row.due_date ? normalizeHistoryDate(row.due_date) || row.due_date : undefined,
    chargeLabel: row.charge_label?.trim() || undefined,
    client: "",
    collector: row.collector_name?.trim() || "—",
    collectorRef: row.collector_ref?.trim() || undefined,
    routeRef: row.route_ref?.trim() || undefined,
    amount,
    type: row.payment_type?.trim() || "Cuota",
    kind: mapKind(row.payment_kind),
    method: mapMethod(row.method),
    source: mapSource(row.source),
  };
}

function enrichClientNames(payments: PaymentRow[]): PaymentRow[] {
  const loans = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
  const byLoan = new Map(loans.map((loan) => [loan.ref, loan.client]));
  return payments.map((row) => {
    if (row.client?.trim()) return row;
    const name = row.loanRef ? byLoan.get(row.loanRef) : undefined;
    return name ? { ...row, client: name } : { ...row, client: row.client || "—" };
  });
}

/** Local gana si el `ref` ya existe; solo se agregan remotos nuevos. */
export function mergePaymentsByRef(local: PaymentRow[], remote: PaymentRow[]): {
  merged: PaymentRow[];
  added: number;
} {
  const byRef = new Map<string, PaymentRow>();
  for (const row of local) {
    if (row?.ref) byRef.set(row.ref, row);
  }
  let added = 0;
  for (const row of remote) {
    if (!row?.ref || byRef.has(row.ref)) continue;
    byRef.set(row.ref, row);
    added += 1;
  }
  return { merged: [...byRef.values()], added };
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

export type FetchPaymentsResult =
  | { ok: true; rows: PaymentMirrorRow[] }
  | { ok: true; skipped: true; reason: string; rows: [] }
  | { ok: false; error: string; rows: [] };

/** Lectura C3 desde Supabase (servidor o cliente con anon key). */
export async function fetchPaymentsFromSupabase(): Promise<FetchPaymentsResult> {
  const client = createMirrorClient();
  if (!client) return { ok: true, skipped: true, reason: "supabase_not_configured", rows: [] };

  const { data, error } = await client
    .from("payments")
    .select(
      "ref,loan_ref,client_ref,collector_ref,collector_name,amount,paid_date,paid_time,due_date,charge_label,method,source,payment_type,payment_kind,route_ref,updated_at",
    )
    .order("paid_date", { ascending: false })
    .limit(3000);

  if (error) return { ok: false, error: error.message, rows: [] };
  return { ok: true, rows: (data ?? []) as PaymentMirrorRow[] };
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

export type PullPaymentsResult = {
  ok: boolean;
  added: number;
  skipped?: boolean;
  reason?: string;
};

/**
 * C3: trae cobros remotos, fusiona por `ref` en nexo-demo-payments.
 * Devuelve cuántos refs nuevos entraron (para re-hidratar proyecciones).
 */
export async function pullRemotePaymentsIntoDemo(): Promise<PullPaymentsResult> {
  if (typeof window === "undefined") {
    return { ok: true, added: 0, skipped: true, reason: "ssr" };
  }

  // El pull va por API route (env del servidor). No exigir NEXT_PUBLIC en el bundle
  // del browser: un `npm run dev` viejo o sin reiniciar saltaba el sync a localhost.
  try {
    const res = await fetch("/api/payments", { method: "GET", cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      payments?: PaymentMirrorRow[];
      error?: string;
      skipped?: boolean;
      reason?: string;
    };
    if (!res.ok || !body.ok) {
      return {
        ok: false,
        added: 0,
        reason: body.error || body.reason || `http_${res.status}`,
      };
    }
    if (body.skipped) {
      return { ok: true, added: 0, skipped: true, reason: body.reason };
    }

    const remote = enrichClientNames(
      (body.payments ?? [])
        .map(mirrorRowToPaymentRow)
        .filter((row): row is PaymentRow => Boolean(row)),
    );
    const local = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
    const { merged, added } = mergePaymentsByRef(local, remote);
    if (added > 0) {
      writeDemoJson(DEMO_PAYMENTS_KEY, merged);
    }
    return { ok: true, added };
  } catch (err) {
    const message = err instanceof Error ? err.message : "pull_failed";
    return { ok: false, added: 0, reason: message };
  }
}
