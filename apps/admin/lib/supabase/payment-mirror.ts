/**
 * C2–C4: pagos compartidos en Supabase.
 * C4: Postgres es la raíz de `PG-`; localStorage es caché + cola offline.
 * @see docs/demo-to-backend.md
 * @see docs/operational-money.md
 */
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { LoanRow, PaymentRow, StatusKind } from "@/lib/mock-data";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import {
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  isVirginRemoteHoldActive,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import { evidenceForMirror, evidenceHasPreview } from "@/lib/payment-evidence";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import {
  rememberPaymentEvidence,
  resolvePaymentEvidence,
  withPaymentEvidence,
} from "@/lib/payment-evidence-store";
import { normalizePaymentMethod, type PaymentMethod } from "@/lib/payment-method";
import { parseComboChargeLabel } from "@/lib/payment-combo";
import { isDeletedRef } from "@/lib/deleted-ids";

export type PaymentMirrorRow = {
  id?: string;
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
  evidence: PaymentEvidenceRef[] | null;
  updated_at: string;
};

/** Cola de cobros locales pendientes de subir a Supabase (offline / fallo de red). */
export const DEMO_PAYMENT_MIRROR_QUEUE_KEY = "nexo-demo-payment-mirror-queue";

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
  "banco",
]);

export function paymentRowToMirror(payment: PaymentRow): PaymentMirrorRow | null {
  const loanRef = (payment.loanRef || "").trim();
  const paidDate = normalizeHistoryDate(payment.paidDate || "") || payment.paidDate;
  if (!loanRef || !paidDate || !(Number(payment.amount) > 0)) return null;

  let clientRef: string | null = null;
  if (typeof window !== "undefined") {
    const loans = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
    clientRef = loans.find((loan) => loan.ref === loanRef)?.clientRef?.trim() || null;
  }

  return {
    ref: payment.ref,
    loan_ref: loanRef,
    client_ref: clientRef,
    collector_ref: payment.collectorRef?.trim() || null,
    collector_name: payment.collector?.trim() || null,
    amount: Number(payment.amount),
    paid_date: paidDate,
    paid_time: payment.paidTime?.trim() || null,
    due_date: normalizeHistoryDate(payment.dueDate || "") || payment.dueDate || null,
    charge_label: payment.voidedAt
      ? `ANULADO: ${payment.voidReason || "—"} · ${payment.voidedBy || "—"} · ${payment.voidedAt}`
      : payment.chargeLabel?.trim() || null,
    method: normalizePaymentMethod(payment.method),
    source: payment.source || "ruta",
    payment_type: payment.voidedAt ? "Anulado" : payment.type || null,
    payment_kind: payment.kind || null,
    route_ref: payment.routeRef?.trim() || null,
    evidence: evidenceForMirror(payment.evidence) ?? null,
    updated_at: new Date().toISOString(),
  };
}

function mapSource(source: string | null | undefined): PaymentRow["source"] {
  if (source === "caja") return "caja";
  return "pwa";
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
  const evidence = Array.isArray(row.evidence) && row.evidence.length ? row.evidence : undefined;
  if (evidence?.length) rememberPaymentEvidence(ref, evidence);

  const paymentType = row.payment_type?.trim() || "Cuota";
  const isVoided = paymentType === "Anulado" || (row.charge_label || "").startsWith("ANULADO:");
  let voidReason: string | undefined;
  let voidedBy: string | undefined;
  let voidedAt: string | undefined;
  if (isVoided && row.charge_label?.startsWith("ANULADO:")) {
    const parts = row.charge_label.slice("ANULADO:".length).split(" · ").map((p) => p.trim());
    voidReason = parts[0] || undefined;
    voidedBy = parts[1] || undefined;
    voidedAt = parts[2] || row.updated_at || undefined;
  } else if (isVoided) {
    voidedAt = row.updated_at || new Date().toISOString();
    voidReason = "Anulado";
  }

  const comboParsed = isVoided
    ? { chargeLabel: undefined as string | undefined, comboGroupId: undefined as string | undefined }
    : parseComboChargeLabel(row.charge_label);

  return {
    id: row.id?.trim() || undefined,
    ref,
    loanRef,
    when: `${isoToDispatchLabel(paidDate)} · ${paidTime}`,
    paidDate,
    paidTime,
    dueDate: row.due_date ? normalizeHistoryDate(row.due_date) || row.due_date : undefined,
    chargeLabel: isVoided ? undefined : comboParsed.chargeLabel,
    comboGroupId: comboParsed.comboGroupId,
    client: "",
    collector: row.collector_name?.trim() || "—",
    collectorRef: row.collector_ref?.trim() || undefined,
    routeRef: row.route_ref?.trim() || undefined,
    amount,
    type: isVoided ? "Anulado" : paymentType,
    kind: mapKind(row.payment_kind),
    method: normalizePaymentMethod(row.method),
    evidence,
    source: mapSource(row.source),
    updatedAt: row.updated_at || undefined,
    voidedAt,
    voidReason,
    voidedBy,
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

function moneySignature(row: PaymentRow) {
  return [
    row.ref,
    row.loanRef ?? "",
    Number(row.amount),
    row.paidDate ?? "",
    row.paidTime ?? "",
    row.method ?? "",
    row.collectorRef ?? "",
    row.source ?? "",
  ].join("|");
}

function preferDisplay(remote: string | undefined, local: string | undefined) {
  const r = (remote || "").trim();
  if (r && r !== "—") return r;
  const l = (local || "").trim();
  return l || "—";
}

function paymentIsVoided(row: PaymentRow) {
  return Boolean(row.voidedAt?.trim()) || row.type === "Anulado";
}

function paymentUuid(row: PaymentRow) {
  return (row.id || "").trim();
}

/** Misma fila si comparte UUID o la misma ref PG-. */
function samePaymentIdentity(a: PaymentRow, b: PaymentRow) {
  const aId = paymentUuid(a);
  const bId = paymentUuid(b);
  if (aId && bId && aId === bId) return true;
  return Boolean(a.ref && b.ref && a.ref === b.ref);
}

/**
 * Merge de cobros. La cola local (pendingSync) y una anulación de este PC
 * ganan sobre un remoto viejo. Un PG- que solo existe aquí no se borra.
 * Un pago que solo está en Supabase (otro id / UUID) se integra: no se pisa.
 * Un anulado no vuelve a vivo porque la nube todavía no se enteró.
 */
export function mergePaymentsByRef(
  local: PaymentRow[],
  remote: PaymentRow[],
  pending: PaymentRow[] = [],
): {
  merged: PaymentRow[];
  added: number;
  changed: boolean;
} {
  const localByRef = new Map<string, PaymentRow>();
  for (const row of local) {
    if (row?.ref) localByRef.set(row.ref, row);
  }
  const pendingByRef = new Map<string, PaymentRow>();
  for (const row of pending) {
    if (row?.ref) pendingByRef.set(row.ref, row);
  }

  const merged: PaymentRow[] = [];
  let added = 0;
  let changed = false;

  for (const remoteRow of remote) {
    if (!remoteRow?.ref) continue;
    if (isDeletedRef(remoteRow.ref)) {
      if (localByRef.delete(remoteRow.ref)) changed = true;
      pendingByRef.delete(remoteRow.ref);
      continue;
    }
    const queued =
      pendingByRef.get(remoteRow.ref) ??
      [...pendingByRef.values()].find((row) => samePaymentIdentity(row, remoteRow));
    const localRow =
      localByRef.get(remoteRow.ref) ??
      [...localByRef.values()].find((row) => samePaymentIdentity(row, remoteRow));
    if (queued) {
      if (!localRow || moneySignature(queued) !== moneySignature(localRow)) changed = true;
      if (moneySignature(queued) !== moneySignature(remoteRow)) changed = true;
      merged.push(queued.id ? queued : { ...queued, id: remoteRow.id });
      if (localRow?.ref) localByRef.delete(localRow.ref);
      localByRef.delete(remoteRow.ref);
      if (queued.ref) pendingByRef.delete(queued.ref);
      pendingByRef.delete(remoteRow.ref);
      continue;
    }
    if (!localRow) {
      merged.push(remoteRow);
      added += 1;
      changed = true;
      continue;
    }
    if (paymentIsVoided(localRow) && !paymentIsVoided(remoteRow)) {
      merged.push(localRow.id ? localRow : { ...localRow, id: remoteRow.id });
      if (localRow.ref) localByRef.delete(localRow.ref);
      localByRef.delete(remoteRow.ref);
      continue;
    }
    const next: PaymentRow = {
      ...remoteRow,
      id: localRow.id || remoteRow.id,
      method: normalizePaymentMethod(remoteRow.method ?? localRow.method),
      client: preferDisplay(remoteRow.client, localRow.client),
      collector: preferDisplay(remoteRow.collector, localRow.collector),
      evidence:
        resolvePaymentEvidence(localRow) ??
        resolvePaymentEvidence(remoteRow) ??
        remoteRow.evidence ??
        localRow.evidence,
      gps: localRow.gps ?? remoteRow.gps,
      idempotencyKey: localRow.idempotencyKey ?? remoteRow.idempotencyKey,
      voidedAt: paymentIsVoided(remoteRow) ? remoteRow.voidedAt ?? localRow.voidedAt : localRow.voidedAt,
      voidReason: paymentIsVoided(remoteRow) ? remoteRow.voidReason ?? localRow.voidReason : localRow.voidReason,
      voidedBy: paymentIsVoided(remoteRow) ? remoteRow.voidedBy ?? localRow.voidedBy : localRow.voidedBy,
    };
    if (paymentIsVoided(next)) next.type = "Anulado";
    if (next.evidence?.length) rememberPaymentEvidence(next.ref, next.evidence);
    if (moneySignature(localRow) !== moneySignature(next)) changed = true;
    if (evidenceHasPreview(next.evidence) && !evidenceHasPreview(remoteRow.evidence)) {
      changed = true;
    }
    merged.push(next);
    if (localRow.ref) localByRef.delete(localRow.ref);
    localByRef.delete(remoteRow.ref);
  }

  for (const row of localByRef.values()) {
    if (isDeletedRef(row.ref)) continue;
    merged.push(row);
  }
  for (const row of pendingByRef.values()) {
    if (isDeletedRef(row.ref) || merged.some((entry) => entry.ref === row.ref)) continue;
    merged.push(row);
    changed = true;
  }

  return { merged, added, changed };
}

function createMirrorClient() {
  return createMirrorServerClient();
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

  if (payment.evidence?.length) {
    rememberPaymentEvidence(payment.ref, payment.evidence);
  }

  const client = createMirrorClient();
  if (!client) {
    const { configured: pub } = getSupabasePublicEnv();
    return {
      ok: true,
      skipped: true,
      reason: pub && !mirrorUsesServiceRole() ? "service_role_missing" : "supabase_not_configured",
    };
  }

  const rpc = await client.rpc("register_collection", {
    p_ref: row.ref,
    p_loan_ref: row.loan_ref,
    p_amount: row.amount,
    p_paid_date: row.paid_date,
    p_method: row.method,
    p_idempotency_key: payment.idempotencyKey ?? null,
    p_client_ref: row.client_ref,
    p_collector_ref: row.collector_ref,
    p_collector_name: row.collector_name,
    p_paid_time: row.paid_time,
    p_due_date: row.due_date,
    p_charge_label: row.charge_label,
    p_source: row.source,
    p_payment_type: row.payment_type,
    p_payment_kind: row.payment_kind,
    p_route_ref: row.route_ref,
    p_evidence: row.evidence ?? null,
  });
  if (!rpc.error) {
    const body = rpc.data as { ok?: boolean; error?: string } | null;
    if (body && body.ok === false) {
      return { ok: false, error: body.error || "register_collection" };
    }
    return { ok: true };
  }
  const rpcMsg = rpc.error.message || "";
  if (!/register_collection|schema cache|PGRST202|Could not find the function/i.test(rpcMsg)) {
    return { ok: false, error: rpcMsg };
  }

  const { error } = await client.from("payments").upsert(row, { onConflict: "ref" });
  if (error) {
    const msg = error.message || "";
    // Columna evidence ausente (migración vieja): guarda el cobro sin foto.
    // Si ya hay foto y falla evidence, NO fingir éxito: la cola debe reintentar.
    if (/evidence/i.test(msg)) {
      const hadPreview = evidenceHasPreview(payment.evidence);
      const { evidence: _drop, ...withoutEvidence } = row;
      const retry = await client.from("payments").upsert(withoutEvidence, { onConflict: "ref" });
      if (retry.error) return { ok: false, error: retry.error.message };
      if (hadPreview) {
        return { ok: false, error: `evidence_upsert_failed: ${msg}` };
      }
      return { ok: true };
    }
    // Constraint viejo sin 'banco': no tumbar el cobro local; cola reintenta tras migración.
    if (/method/i.test(msg) && /banco|check|constraint/i.test(msg)) {
      return {
        ok: false,
        error: `payments_method_ok necesita 'banco' — aplicar migración 20260916200000_payments_method_banco.sql (${msg})`,
      };
    }
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export type FetchPaymentsResult =
  | { ok: true; rows: PaymentMirrorRow[] }
  | { ok: true; skipped: true; reason: string; rows: [] }
  | { ok: false; error: string; rows: [] };

/** Lectura desde Supabase (servidor o cliente con anon key). */
export async function fetchPaymentsFromSupabase(): Promise<FetchPaymentsResult> {
  const client = createMirrorClient();
  if (!client) {
    const { configured: pub } = getSupabasePublicEnv();
    return {
      ok: true,
      skipped: true,
      reason: pub && !mirrorUsesServiceRole() ? "service_role_missing" : "supabase_not_configured",
      rows: [],
    };
  }

  const { data, error } = await client
    .from("payments")
    .select(
      "id,ref,loan_ref,client_ref,collector_ref,collector_name,amount,paid_date,paid_time,due_date,charge_label,method,source,payment_type,payment_kind,route_ref,evidence,updated_at",
    )
    .order("paid_date", { ascending: false })
    .limit(3000);

  if (error && /evidence/i.test(error.message || "")) {
    const fallback = await client
      .from("payments")
      .select(
        "id,ref,loan_ref,client_ref,collector_ref,collector_name,amount,paid_date,paid_time,due_date,charge_label,method,source,payment_type,payment_kind,route_ref,updated_at",
      )
      .order("paid_date", { ascending: false })
      .limit(3000);
    if (fallback.error) return { ok: false, error: fallback.error.message, rows: [] };
    return { ok: true, rows: (fallback.data ?? []) as PaymentMirrorRow[] };
  }

  if (error) return { ok: false, error: error.message, rows: [] };
  return { ok: true, rows: (data ?? []) as PaymentMirrorRow[] };
}

function readMirrorQueue(): PaymentRow[] {
  return readDemoJson<PaymentRow[]>(DEMO_PAYMENT_MIRROR_QUEUE_KEY, []).filter((row) => row?.ref);
}

function writeMirrorQueue(rows: PaymentRow[]) {
  writeDemoJson(DEMO_PAYMENT_MIRROR_QUEUE_KEY, rows);
}

function enqueueMirrorPayment(payment: PaymentRow) {
  if (!payment?.ref) return;
  const queue = readMirrorQueue().filter((row) => row.ref !== payment.ref);
  queue.push(payment);
  writeMirrorQueue(queue);
}

function dequeueMirrorPayment(ref: string) {
  writeMirrorQueue(readMirrorQueue().filter((row) => row.ref !== ref));
}

/** POST al API de espejo; si falla, deja el cobro en cola offline. */
export async function persistPaymentToSupabase(
  payment: PaymentRow,
): Promise<MirrorPaymentResult> {
  if (typeof window === "undefined") {
    return { ok: true, skipped: true, reason: "ssr" };
  }
  const payload = withPaymentEvidence(payment);
  const body = JSON.stringify({ payment: payload });
  // keepalive ~64KB: firmas caben; JPEG Nequi no. Sin evidencia usamos keepalive.
  const useKeepalive = body.length < 60_000;
  // Con evidencia: encolar YA. Si el celular se cierra a mitad del POST, al reabrir se reintenta.
  if (evidenceHasPreview(payload.evidence)) {
    enqueueMirrorPayment(payload);
  }
  try {
    const res = await fetch("/api/payments/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      ...(useKeepalive ? { keepalive: true } : {}),
    });
    const result = (await res.json()) as MirrorPaymentResult & { error?: string };
    if (!res.ok || !result.ok) {
      enqueueMirrorPayment(payload);
      return { ok: false, error: result.error || `http_${res.status}` };
    }
    if (!result.skipped) {
      dequeueMirrorPayment(payload.ref);
    }
    return result;
  } catch (err) {
    enqueueMirrorPayment(payload);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "mirror_network_error",
    };
  }
}

/** C4: intenta subir la cola offline (no tumba la UX). */
export async function flushPaymentMirrorQueue(): Promise<{ flushed: number; left: number }> {
  if (typeof window === "undefined") return { flushed: 0, left: 0 };
  const queue = readMirrorQueue();
  if (!queue.length) return { flushed: 0, left: 0 };

  let flushed = 0;
  const left: PaymentRow[] = [];
  for (const payment of queue) {
    const payload = withPaymentEvidence(payment);
    try {
      const res = await fetch("/api/payments/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment: payload }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        skipped?: boolean;
        reason?: string;
      };
      // Solo sacar de cola si realmente escribió en Postgres.
      // `skipped` (sin service role / inválido) NO cuenta como éxito.
      if (res.ok && body.ok && !body.skipped) {
        flushed += 1;
      } else if (res.ok && body.ok && body.skipped && body.reason === "invalid_payment") {
        // Basura irrecuperable: no reintentar.
        flushed += 1;
      } else {
        left.push(payload);
      }
    } catch {
      left.push(payload);
    }
  }
  writeMirrorQueue(left);
  return { flushed, left: left.length };
}

/**
 * C4.1 — crítico negocio: todo `PG-` que exista solo en este navegador
 * debe subir a Postgres. Sin esto, PC y celular divergen (alerta distinta).
 */
export async function reconcileLocalPaymentsToRemote(): Promise<{
  pushed: number;
  failed: number;
  missing: number;
}> {
  if (typeof window === "undefined") {
    return { pushed: 0, failed: 0, missing: 0 };
  }

  const local = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []).filter((row) => row?.ref);
  if (!local.length) return { pushed: 0, failed: 0, missing: 0 };

  try {
    const res = await fetch("/api/payments", { method: "GET", cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      payments?: PaymentMirrorRow[];
      skipped?: boolean;
      error?: string;
    };
    if (!res.ok || !body.ok || body.skipped) {
      return { pushed: 0, failed: 0, missing: local.length };
    }

    const remoteRefs = new Set(
      (body.payments ?? []).map((row) => row.ref).filter(Boolean),
    );
    const missing = local.filter((row) => !remoteRefs.has(row.ref));
    if (!missing.length) return { pushed: 0, failed: 0, missing: 0 };

    let pushed = 0;
    let failed = 0;
    for (const payment of missing) {
      const result = await persistPaymentToSupabase(withPaymentEvidence(payment));
      if (result.ok && !("skipped" in result && result.skipped)) {
        pushed += 1;
      } else if (!result.ok) {
        failed += 1;
      }
    }
    return { pushed, failed, missing: missing.length };
  } catch {
    return { pushed: 0, failed: local.length, missing: local.length };
  }
}

/**
 * Sube constancias (previewUrl) que quedaron solo en este dispositivo.
 * Sin esto el celular ve la foto Nequi y el PC no (mismo link Vercel).
 */
export async function reconcilePaymentEvidenceToRemote(): Promise<{
  pushed: number;
  failed: number;
  pending: number;
  errors: string[];
}> {
  if (typeof window === "undefined") {
    return { pushed: 0, failed: 0, pending: 0, errors: [] };
  }

  const local = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, [])
    .filter((row) => row?.ref)
    .map(withPaymentEvidence)
    .filter((row) => evidenceHasPreview(row.evidence));
  if (!local.length) return { pushed: 0, failed: 0, pending: 0, errors: [] };

  try {
    const res = await fetch("/api/payments", { method: "GET", cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      payments?: PaymentMirrorRow[];
      skipped?: boolean;
      error?: string;
    };
    if (!res.ok || !body.ok || body.skipped) {
      return {
        pushed: 0,
        failed: 0,
        pending: local.length,
        errors: [body.error || (body.skipped ? "payments_get_skipped" : `http_${res.status}`)],
      };
    }

    const remoteByRef = new Map(
      (body.payments ?? []).map((row) => [row.ref, row] as const),
    );

    let pushed = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const payment of local) {
      const remote = remoteByRef.get(payment.ref);
      const remoteEvidence = Array.isArray(remote?.evidence) ? remote.evidence : undefined;
      if (evidenceHasPreview(remoteEvidence)) continue;

      const result = await persistPaymentToSupabase(payment);
      if (result.ok && !("skipped" in result && result.skipped)) {
        pushed += 1;
      } else if (!result.ok) {
        failed += 1;
        errors.push(`${payment.ref}: ${result.error}`);
      } else if ("skipped" in result && result.skipped) {
        failed += 1;
        errors.push(`${payment.ref}: skipped_${result.reason}`);
      }
    }
    return { pushed, failed, pending: local.length, errors };
  } catch (err) {
    return {
      pushed: 0,
      failed: local.length,
      pending: local.length,
      errors: [err instanceof Error ? err.message : "reconcile_failed"],
    };
  }
}

/** Disparo tras cobro local: sube a Postgres (con evidencia); si no, queda en cola. */
export function queuePaymentMirror(payment: PaymentRow): Promise<MirrorPaymentResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({ ok: true, skipped: true, reason: "ssr" });
  }
  return persistPaymentToSupabase(payment);
}

export type PullPaymentsResult = {
  ok: boolean;
  added: number;
  changed: boolean;
  skipped?: boolean;
  reason?: string;
};

/**
 * C4: trae cobros remotos (raíz), fusiona con caché local / offline.
 * `changed` incluye refs nuevos o dinero remoto distinto.
 */
export async function pullRemotePaymentsIntoDemo(): Promise<PullPaymentsResult> {
  if (typeof window === "undefined") {
    return { ok: true, added: 0, changed: false, skipped: true, reason: "ssr" };
  }

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
        changed: false,
        reason: body.error || body.reason || `http_${res.status}`,
      };
    }
    if (body.skipped) {
      return {
        ok: true,
        added: 0,
        changed: false,
        skipped: true,
        reason: body.reason,
      };
    }

    const remote = enrichClientNames(
      (body.payments ?? [])
        .map(mirrorRowToPaymentRow)
        .filter((row): row is PaymentRow => Boolean(row)),
    );
    const local = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
    // Post-wipe (2h): no reinyectar PG- remotos mientras local sigue vacío.
    if (isVirginRemoteHoldActive() && local.length === 0 && remote.length > 0) {
      return {
        ok: true,
        added: 0,
        changed: false,
        skipped: true,
        reason: "virgin_hold_empty",
      };
    }
    const { merged, added, changed } = mergePaymentsByRef(local, remote, readMirrorQueue());
    if (changed) {
      writeDemoJson(DEMO_PAYMENTS_KEY, merged);
    }
    return { ok: true, added, changed };
  } catch (err) {
    const message = err instanceof Error ? err.message : "pull_failed";
    return { ok: false, added: 0, changed: false, reason: message };
  }
}
