/**
 * C2–C4: pagos compartidos en Supabase.
 * C4: Postgres es la raíz de `PG-`; localStorage es caché + cola offline.
 * @see docs/demo-to-backend.md
 * @see docs/operational-money.md
 */
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { fetchAllRows, fetchRowsChangedSince } from "@/lib/supabase/changed-since";
import {
  collectorLiveDayIso,
  isCollectorLiveDevice,
  withDateWindowParam,
} from "@/lib/collector-live-window";
import { createIncrementalPull, withSinceParam } from "@/lib/incremental-pull";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { money, type LoanRow, type PaymentRow, type StatusKind } from "@/lib/mock-data";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import {
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  isVirginRemoteHoldActive,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import { BIG_DEMO_STORE_CHANGED_EVENT } from "@/lib/big-demo-store";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { evidenceForMirror, evidenceHasDurableRef, evidenceHasPreview } from "@/lib/payment-evidence";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import {
  rememberPaymentEvidence,
  resolvePaymentEvidence,
  withPaymentEvidence,
} from "@/lib/payment-evidence-store";
import { normalizePaymentMethod } from "@/lib/payment-method";
import { parseComboChargeLabel } from "@/lib/payment-combo";
import { encodeLateChargeLabel, parseLateChargeLabel } from "@/lib/late-payment";
import { isDeletedRef } from "@/lib/deleted-ids";
import {
  emitMirrorQueueChanged,
  PAYMENT_REJECTED_BALANCE,
  shouldDropFromMirrorQueue,
  type MirrorApiJson,
} from "@/lib/supabase/mirror-queue";
import { reportPaymentRejection } from "@/lib/loan-rejections";

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
  idempotency_key?: string | null;
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
      : encodeLateChargeLabel(payment.chargeLabel, payment.lateFor) || null,
    method: normalizePaymentMethod(payment.method),
    source: payment.source || "ruta",
    payment_type: payment.voidedAt ? "Anulado" : payment.type || null,
    payment_kind: payment.kind || null,
    route_ref: payment.routeRef?.trim() || null,
    evidence: evidenceForMirror(payment.evidence) ?? null,
    idempotency_key: payment.idempotencyKey?.trim() || null,
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

  const lateParsed = isVoided ? {} : parseLateChargeLabel(row.charge_label);
  const comboParsed = isVoided
    ? { chargeLabel: undefined as string | undefined, comboGroupId: undefined as string | undefined }
    : parseComboChargeLabel(lateParsed.chargeLabel);

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
    idempotencyKey: row.idempotency_key?.trim() || undefined,
    voidedAt,
    voidReason,
    voidedBy,
    ...(lateParsed.lateFor ? { lateFor: lateParsed.lateFor } : {}),
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
    paymentIsVoided(row) ? "anulado" : "",
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
    // Sin columna evidence en la lista, el remoto no “perdió” la foto.
    if (
      remoteRow.evidence !== undefined &&
      evidenceHasPreview(next.evidence) &&
      !evidenceHasPreview(remoteRow.evidence)
    ) {
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

function mirrorRowIsVoided(row: Pick<PaymentMirrorRow, "payment_type" | "charge_label">) {
  return row.payment_type === "Anulado" || (row.charge_label || "").startsWith("ANULADO:");
}

/**
 * Anulación en la nube: marca el PG- (una anulación no se deshace) y la base recalcula el
 * préstamo con los cobros vivos (`_loan_settle`, la misma regla que `register_collection`).
 */
async function voidPaymentInSupabase(row: PaymentMirrorRow): Promise<MirrorPaymentResult> {
  const client = createMirrorClient();
  if (!client) return { ok: true, skipped: true, reason: "supabase_not_configured" };
  const stamp = new Date().toISOString();

  const marked = await client
    .from("payments")
    .update({
      payment_type: "Anulado",
      charge_label: row.charge_label,
      updated_at: stamp,
    })
    .eq("ref", row.ref)
    .select("ref");
  if (marked.error) return { ok: false, error: marked.error.message };
  if (!marked.data?.length) {
    const { evidence: _evidence, ...withoutEvidence } = row;
    const inserted = await client
      .from("payments")
      .upsert({ ...withoutEvidence, updated_at: stamp }, { onConflict: "ref" });
    if (inserted.error) return { ok: false, error: inserted.error.message };
  }

  const settled = await client.rpc("_loan_settle", { p_ref: row.loan_ref });
  if (settled.error) return { ok: false, error: settled.error.message };
  return { ok: true };
}

export type MirrorPaymentResult =
  | {
      ok: true;
      skipped?: false;
      duplicate?: boolean;
      payment?: PaymentRow;
      /** Combinado: los dos tramos, en el orden enviado. */
      payments?: PaymentRow[];
    }
  | { ok: true; skipped: true; reason: string; balance?: number }
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

  // `register_collection` solo inserta: con el PG- ya en la nube contesta «duplicado» y no
  // guarda la anulación. La anulación va por su propio camino.
  if (paymentIsVoided(payment)) return voidPaymentInSupabase(row);

  const {
    registerLoanPaymentInSupabase,
  } = await import("@/lib/supabase/register-loan-payment");
  const registered = await registerLoanPaymentInSupabase(payment);
  if (registered.ok) {
    return {
      ok: true,
      duplicate: registered.duplicate,
      payment: registered.payments[0],
    };
  }

  if (registered.reason === PAYMENT_REJECTED_BALANCE) {
    return { ok: true, skipped: true, reason: PAYMENT_REJECTED_BALANCE, balance: registered.balance };
  }

  // Sin service role / sin Supabase: no tumbar el cobro local.
  if (
    registered.error === "service_role_missing" ||
    registered.error === "supabase_not_configured"
  ) {
    return { ok: true, skipped: true, reason: registered.error };
  }

  // Solo sin la RPC (migración vieja): el upsert por ref pisaría otro cobro con el mismo PG-.
  if (registered.error === "register_collection_missing") {
    const client = createMirrorClient();
    if (!client) {
      return { ok: true, skipped: true, reason: "supabase_not_configured" };
    }

    const { error } = await client.from("payments").upsert(row, { onConflict: "ref" });
    if (error) {
      const msg = error.message || "";
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
      if (/method/i.test(msg) && /banco|check|constraint/i.test(msg)) {
        return {
          ok: false,
          error: `payments_method_ok necesita 'banco' — aplicar migración 20260916200000_payments_method_banco.sql (${msg})`,
        };
      }
      // Idempotencia por índice único: reintento = éxito.
      if (/idempotency|duplicate|unique/i.test(msg)) {
        return { ok: true, duplicate: true, payment };
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  }

  return { ok: false, error: registered.error };
}

/** Dos tramos combinados en una sola RPC (rollback total si falla uno). */
export async function mirrorCombinedPaymentsToSupabase(
  parts: [PaymentRow, PaymentRow],
): Promise<MirrorPaymentResult> {
  const {
    registerCombinedLoanPaymentInSupabase,
    registerLoanPaymentInSupabase,
  } = await import("@/lib/supabase/register-loan-payment");

  const combined = await registerCombinedLoanPaymentInSupabase(parts);
  if (combined.ok) {
    return {
      ok: true,
      duplicate: combined.duplicate,
      payment: combined.payments[0],
      payments: combined.payments,
    };
  }

  if (combined.reason === PAYMENT_REJECTED_BALANCE) {
    return { ok: true, skipped: true, reason: PAYMENT_REJECTED_BALANCE, balance: combined.balance };
  }

  if (
    combined.error === "service_role_missing" ||
    combined.error === "supabase_not_configured"
  ) {
    return { ok: true, skipped: true, reason: combined.error };
  }

  // Migración aún no aplicada: no dejar un solo tramo en la nube.
  if (combined.error === "register_combined_collection_missing") {
    const first = await registerLoanPaymentInSupabase(parts[0]);
    if (!first.ok) {
      if (
        first.error === "service_role_missing" ||
        first.error === "supabase_not_configured"
      ) {
        return { ok: true, skipped: true, reason: first.error };
      }
      return { ok: false, error: first.error };
    }
    const second = await registerLoanPaymentInSupabase(parts[1]);
    if (!second.ok) {
      return {
        ok: false,
        error: `combinado_parcial: ${parts[0].ref} ok, ${parts[1].ref} falló (${second.error})`,
      };
    }
    return { ok: true, duplicate: first.duplicate && second.duplicate, payment: first.payments[0] };
  }

  return { ok: false, error: combined.error };
}

export type FetchPaymentsResult =
  | { ok: true; rows: PaymentMirrorRow[] }
  | { ok: true; skipped: true; reason: string; rows: [] }
  | { ok: false; error: string; rows: [] };

const PAYMENT_MONEY_COLUMNS =
  "id,ref,loan_ref,client_ref,collector_ref,collector_name,amount,paid_date,paid_time,due_date,charge_label,method,source,payment_type,payment_kind,route_ref,updated_at";

/**
 * Lectura desde Supabase.
 * La lista de cobros no trae la foto: eso es 1,6 MB que traban la pantalla en reposo.
 * `evidence: true` solo cuando hay que subir una constancia que este aparato tiene y la nube no.
 * `since`: solo los cobros que cambiaron o se crearon desde ese corte (sin foto).
 */
export async function fetchPaymentsFromSupabase(options?: {
  evidence?: boolean;
  since?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<FetchPaymentsResult> {
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

  if (options?.since) {
    const changed = await fetchRowsChangedSince<PaymentMirrorRow>(
      client,
      "payments",
      PAYMENT_MONEY_COLUMNS,
      options.since,
    );
    return changed.ok ? { ok: true, rows: changed.rows } : { ok: false, error: changed.error, rows: [] };
  }

  const dateWindow =
    options?.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(options.fromDate)
      ? {
          column: "paid_date",
          since: options.fromDate,
          until:
            options.toDate && /^\d{4}-\d{2}-\d{2}$/.test(options.toDate)
              ? options.toDate
              : undefined,
        }
      : undefined;
  let full = await fetchAllRows<PaymentMirrorRow>(
    client,
    "payments",
    options?.evidence ? `${PAYMENT_MONEY_COLUMNS},evidence` : PAYMENT_MONEY_COLUMNS,
    dateWindow,
  );
  if (!full.ok && options?.evidence && /evidence/i.test(full.error)) {
    full = await fetchAllRows<PaymentMirrorRow>(
      client,
      "payments",
      PAYMENT_MONEY_COLUMNS,
      dateWindow,
    );
  }
  if (!full.ok) return { ok: false, error: full.error, rows: [] };
  return {
    ok: true,
    rows: full.rows.sort((a, b) => String(b.paid_date).localeCompare(String(a.paid_date))),
  };
}

function readMirrorQueue(): PaymentRow[] {
  return readDemoJson<PaymentRow[]>(DEMO_PAYMENT_MIRROR_QUEUE_KEY, []).filter((row) => row?.ref);
}

function writeMirrorQueue(rows: PaymentRow[]) {
  writeDemoJson(DEMO_PAYMENT_MIRROR_QUEUE_KEY, rows);
  emitMirrorQueueChanged();
}

function enqueueMirrorPayment(payment: PaymentRow) {
  if (!payment?.ref) return;
  const queue = readMirrorQueue().filter((row) => row.ref !== payment.ref);
  queue.push(payment);
  writeMirrorQueue(queue);
}

/** Encola ya (sync). El POST va atrás: confirmar en T no espera la nube. */
export function enqueuePaymentsForFlush(payments: PaymentRow[]): void {
  for (const payment of payments) {
    enqueueMirrorPayment(withPaymentEvidence(payment));
  }
}

function dequeueMirrorPayment(ref: string) {
  writeMirrorQueue(readMirrorQueue().filter((row) => row.ref !== ref));
}

/** La nube guardó el cobro con otro PG-: el cobro local y su visita pasan a ese número. */
function adoptCloudPaymentRefs(
  sent: PaymentRow[],
  cloud: (PaymentRow | undefined)[] | undefined,
) {
  const renames = new Map<string, string>();
  sent.forEach((row, index) => {
    const to = cloud?.[index]?.ref?.trim();
    if (to && to !== row.ref) renames.set(row.ref, to);
  });
  if (!renames.size) return;

  const payments = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const present = new Set(payments.map((row) => row.ref));
  writeDemoJson(
    DEMO_PAYMENTS_KEY,
    payments
      .filter((row) => !(renames.has(row.ref) && present.has(renames.get(row.ref) as string)))
      .map((row) => (renames.has(row.ref) ? { ...row, ref: renames.get(row.ref) as string } : row)),
  );
  for (const row of sent) {
    const to = renames.get(row.ref);
    if (to && row.evidence?.length) rememberPaymentEvidence(to, row.evidence);
  }

  const changed: DailyCollectionAssignment[] = [];
  const assignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []).map(
    (row) => {
      const to = row.paymentRef ? renames.get(row.paymentRef) : undefined;
      if (!to) return row;
      const next = { ...row, paymentRef: to };
      changed.push(next);
      return next;
    },
  );
  if (changed.length) {
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);
    void import("@/lib/supabase/ops-mirror").then(({ queueAssignmentsMirror }) =>
      queueAssignmentsMirror(changed),
    );
  }
  window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));
}

function isPaymentRejection(reply: { skipped?: boolean; reason?: string } | null | undefined) {
  return Boolean(reply?.skipped && reply.reason === PAYMENT_REJECTED_BALANCE);
}

/**
 * La nube no aceptó el cobro (el préstamo debe menos): ese PG- no existe. Sale de la cola y de
 * los cobros del aparato (caja), su visita abierta vuelve a «por cobrar» y se avisa en pantalla.
 */
function dropRejectedPayments(sent: PaymentRow[], balance: number | undefined) {
  const refs = new Set(sent.map((row) => row.ref));
  writeMirrorQueue(readMirrorQueue().filter((row) => !refs.has(row.ref)));
  writeDemoJson(
    DEMO_PAYMENTS_KEY,
    readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []).filter((row) => !refs.has(row.ref)),
  );

  const reopened: DailyCollectionAssignment[] = [];
  const assignments = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []).map(
    (row) => {
      if (!row.paymentRef || !refs.has(row.paymentRef) || row.dayClosedAt) return row;
      const next: DailyCollectionAssignment = { ...row, visitStatus: "pendiente", paymentRef: undefined };
      reopened.push(next);
      return next;
    },
  );
  if (reopened.length) {
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);
    void import("@/lib/supabase/ops-mirror").then(({ queueAssignmentsMirror }) =>
      queueAssignmentsMirror(reopened),
    );
  }
  window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));

  const first = sent[0];
  if (!first) return;
  const total = sent.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const owes = Number(balance || 0);
  const why = owes > 0 ? `el préstamo ${first.loanRef} solo debe ${money(owes)}` : `el préstamo ${first.loanRef} ya está pagado`;
  reportPaymentRejection({
    ref: first.ref,
    client: first.client,
    reason: PAYMENT_REJECTED_BALANCE,
    message: `Cobro de ${first.client || "cliente"} por ${money(total)} no entró en la nube: ${why}. Se quitó de la caja.`,
  });
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
      signal: AbortSignal.timeout(20_000),
      ...(useKeepalive ? { keepalive: true } : {}),
    });
    const result = (await res.json()) as MirrorPaymentResult & { error?: string };
    if (!res.ok || !result.ok) {
      enqueueMirrorPayment(payload);
      return { ok: false, error: result.error || `http_${res.status}` };
    }
    if (!result.skipped) {
      dequeueMirrorPayment(payload.ref);
      adoptCloudPaymentRefs([payload], [result.payment]);
    } else if (isPaymentRejection(result)) {
      dropRejectedPayments([payload], result.balance);
    } else if (!shouldDropFromMirrorQueue(result)) {
      // skipped sin escritura real (p. ej. service_role_missing): queda pendiente.
      enqueueMirrorPayment(payload);
    } else {
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

/** C4: intenta subir la cola offline (no tumba la UX). Reintentable. */
export async function flushPaymentMirrorQueue(): Promise<{ flushed: number; left: number }> {
  if (typeof window === "undefined") return { flushed: 0, left: 0 };
  const queue = readMirrorQueue();
  if (!queue.length) return { flushed: 0, left: 0 };

  let flushed = 0;
  const left: PaymentRow[] = [];
  const rejected: { payment: PaymentRow; balance?: number }[] = [];
  for (const payment of queue) {
    const payload = withPaymentEvidence(payment);
    try {
      const res = await fetch("/api/payments/mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment: payload }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json()) as MirrorApiJson & { payment?: PaymentRow };
      // Solo sacar de cola si realmente escribió en Postgres (o skip irrecuperable).
      if (res.ok && isPaymentRejection(body)) {
        flushed += 1;
        rejected.push({ payment: payload, balance: body.balance });
      } else if (res.ok && shouldDropFromMirrorQueue(body) && !body.skipped) {
        flushed += 1;
        adoptCloudPaymentRefs([payload], [body.payment]);
      } else if (res.ok && shouldDropFromMirrorQueue(body) && body.skipped) {
        // invalid_payment u otro drop intencional
        flushed += 1;
      } else {
        left.push(payload);
      }
    } catch {
      left.push(payload);
    }
  }
  writeMirrorQueue(left);
  for (const row of rejected) dropRejectedPayments([row.payment], row.balance);
  return { flushed, left: left.length };
}

/**
 * C4.1 — solo la cola. El historial ya en la nube no se vuelve a subir.
 * Comparar todo lo local contra una lista incompleta era el rebote de la mañana.
 */
export async function reconcileLocalPaymentsToRemote(
  _knownRemoteRefs?: string[],
  _knownRemoteVoidedRefs?: string[],
): Promise<{
  pushed: number;
  failed: number;
  missing: number;
}> {
  if (typeof window === "undefined") {
    return { pushed: 0, failed: 0, missing: 0 };
  }
  try {
    const queue = readMirrorQueue();
    if (!queue.length) return { pushed: 0, failed: 0, missing: 0 };
    const result = await flushPaymentMirrorQueue();
    return { pushed: result.flushed, failed: result.left, missing: result.left };
  } catch {
    return { pushed: 0, failed: 1, missing: 1 };
  }
}

/**
 * Baja constancias (firma / Nequi) de la nube a IndexedDB **una sola vez**.
 * Acepta previewUrl (data/https) o fileId del bucket — sin meter Base64 en localStorage.
 * Así Cobranza ve la foto aunque Postgres solo guarde el path liviano.
 */
export async function pullRemoteEvidenceIntoIdb(): Promise<{
  parked: number;
  failed: boolean;
}> {
  if (typeof window === "undefined") return { parked: 0, failed: false };
  try {
    const evidenceUrl = withDateWindowParam(
      "/api/payments?evidence=1",
      isCollectorLiveDevice() ? collectorLiveDayIso() : null,
    );
    const res = await fetch(evidenceUrl, { method: "GET", cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      payments?: PaymentMirrorRow[];
      skipped?: boolean;
    };
    if (!res.ok || !body.ok || body.skipped) return { parked: 0, failed: true };

    let parked = 0;
    for (const row of body.payments ?? []) {
      const ref = String(row.ref || "").trim();
      const evidence = Array.isArray(row.evidence) ? row.evidence : undefined;
      if (!ref || !evidence?.length) continue;
      if (!evidenceHasPreview(evidence) && !evidenceHasDurableRef(evidence)) continue;
      rememberPaymentEvidence(ref, evidence);
      parked += 1;
    }
    return { parked, failed: false };
  } catch {
    return { parked: 0, failed: true };
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

  const liveDay = isCollectorLiveDevice() ? collectorLiveDayIso() : null;
  const local = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, [])
    .filter((row) => row?.ref)
    .filter((row) => !liveDay || row.paidDate === liveDay)
    .map(withPaymentEvidence)
    .filter((row) => evidenceHasPreview(row.evidence));
  if (!local.length) return { pushed: 0, failed: 0, pending: 0, errors: [] };

  try {
    const evidenceUrl = withDateWindowParam(
      "/api/payments?evidence=1",
      isCollectorLiveDevice() ? collectorLiveDayIso() : null,
    );
    const res = await fetch(evidenceUrl, { method: "GET", cache: "no-store" });
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
      if (evidenceHasPreview(remoteEvidence) || evidenceHasDurableRef(remoteEvidence)) continue;

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

/**
 * Sube un combinado de forma atómica (una sola petición).
 * Si la RPC combinada no existe, el server intenta ambos tramos y reporta parcial.
 */
export async function queueCombinedPaymentMirror(
  parts: [PaymentRow, PaymentRow],
): Promise<MirrorPaymentResult> {
  if (typeof window === "undefined") {
    return { ok: true, skipped: true, reason: "ssr" };
  }
  const payload: [PaymentRow, PaymentRow] = [
    withPaymentEvidence(parts[0]),
    withPaymentEvidence(parts[1]),
  ];
  for (const payment of payload) {
    if (evidenceHasPreview(payment.evidence)) {
      enqueueMirrorPayment(payment);
    }
  }
  try {
    const res = await fetch("/api/payments/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ combined: { parts: payload } }),
    });
    const result = (await res.json()) as MirrorPaymentResult & { error?: string };
    if (!res.ok || !result.ok) {
      for (const payment of payload) enqueueMirrorPayment(payment);
      return { ok: false, error: result.error || `http_${res.status}` };
    }
    if (!result.skipped) {
      dequeueMirrorPayment(payload[0].ref);
      dequeueMirrorPayment(payload[1].ref);
      adoptCloudPaymentRefs(payload, result.payments);
    } else if (isPaymentRejection(result)) {
      dropRejectedPayments(payload, result.balance);
    }
    return result;
  } catch (err) {
    for (const payment of payload) enqueueMirrorPayment(payment);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "mirror_network_error",
    };
  }
}

/** Un cobro o un par combinado → espejo nube. */
export async function queuePaymentsMirror(payments: PaymentRow[]): Promise<void> {
  if (payments.length === 2) {
    const [a, b] = payments;
    const comboA = a.comboGroupId?.trim();
    const comboB = b.comboGroupId?.trim();
    if (comboA && comboB && comboA === comboB) {
      await queueCombinedPaymentMirror([a, b]);
      return;
    }
  }
  for (const pay of payments) {
    await queuePaymentMirror(pay);
  }
}

export type PullPaymentsResult = {
  ok: boolean;
  added: number;
  changed: boolean;
  skipped?: boolean;
  reason?: string;
  /** Lista fusionada. El cobrador la pinta aunque el estado del panel venga vacío. */
  rows?: PaymentRow[];
  /** true = bajó la lista completa (el reconcile solo compara contra una lista completa). */
  full?: boolean;
  /** Refs de la lista completa. El reconcile no vuelve a pedirla. Parcial = sin refs. */
  remoteRefs?: string[];
  remoteVoidedRefs?: string[];
};

/**
 * C4: trae cobros remotos (raíz), fusiona con caché local / offline.
 * `changed` incluye refs nuevos o dinero remoto distinto.
 */
let livePaymentCache: PaymentRow[] | null = null;
type PaymentListBody = { rows: PaymentMirrorRow[]; full: boolean; cursor: string | null };
const paymentListFlights = new Map<string, Promise<PaymentListBody | null>>();
/** Lista completa al abrir, cada 60 min y en la puesta a punto; entre medio solo lo cambiado. */
const paymentsPull = createIncrementalPull();

/** Una sola bajada por corte. Las llamadas que coinciden esperan la misma. */
function fetchPaymentListBody(
  since: string | null,
  fromDate: string | null = null,
  toDate: string | null = null,
): Promise<PaymentListBody | null> {
  const key = `${since ?? "full"}|${fromDate ?? ""}|${toDate ?? ""}`;
  const inFlight = paymentListFlights.get(key);
  if (inFlight) return inFlight;
  const flight = (async () => {
    const res = await fetch(
      withDateWindowParam(withSinceParam("/api/payments", since), fromDate, toDate),
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      payments?: PaymentMirrorRow[];
      skipped?: boolean;
      incremental?: boolean;
      cursor?: string;
    };
    if (!res.ok || !body.ok || body.skipped) return null;
    return {
      rows: body.payments ?? [],
      full: !body.incremental,
      cursor: body.cursor ?? null,
    };
  })().finally(() => {
    paymentListFlights.delete(key);
  });
  paymentListFlights.set(key, flight);
  return flight;
}

/** Lista completa de cobros de la base (reconcile y panel sin caché). */
async function fetchPaymentList(): Promise<PaymentMirrorRow[] | null> {
  return (await fetchPaymentListBody(null))?.rows ?? null;
}

/** Cobros de la base. Sobrevive a un remount del panel. */
export async function loadLivePaymentRows(): Promise<PaymentRow[]> {
  if (typeof window === "undefined") return [];
  if (livePaymentCache?.length) return livePaymentCache;
  const fromDate = isCollectorLiveDevice() ? collectorLiveDayIso() : null;
  const payments = fromDate
    ? (await fetchPaymentListBody(null, fromDate))?.rows ?? null
    : await fetchPaymentList();
  if (!payments) return livePaymentCache ?? [];
  const rows = payments
    .map(mirrorRowToPaymentRow)
    .filter((row): row is PaymentRow => Boolean(row));
  if (rows.length > 0) livePaymentCache = rows;
  return rows;
}

/**
 * `full`: lista completa (al abrir, cada 60 min, puesta a punto); si no, solo lo cambiado.
 * Una bajada parcial nunca borra cobros locales y no trae `remoteRefs` (el reconcile
 * solo compara contra la lista completa).
 */
export async function pullRemotePaymentsIntoDemo(
  opts: { full?: boolean } = {},
): Promise<PullPaymentsResult> {
  if (typeof window === "undefined") {
    return { ok: true, added: 0, changed: false, skipped: true, reason: "ssr" };
  }

  const startedAt = Date.now();
  const localCount = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []).length;
  const since = paymentsPull.sinceFor(Boolean(opts.full) || localCount === 0);
  const fromDate = !since && isCollectorLiveDevice() ? collectorLiveDayIso() : null;
  const result = await mergeRemotePayments(since, fromDate);
  paymentsPull.settle(
    { ok: result.ok && !result.skipped, full: Boolean(result.full), cursor: result.cursor },
    startedAt,
  );
  return result;
}

async function mergeRemotePayments(
  since: string | null,
  fromDate: string | null = null,
  toDate: string | null = null,
): Promise<PullPaymentsResult & { cursor?: string | null }> {
  try {
    const body = await fetchPaymentListBody(since, fromDate, toDate);
    if (!body) {
      return {
        ok: false,
        added: 0,
        changed: false,
        reason: "payments_list_failed",
      };
    }
    const listed = body.rows;

    const remote = enrichClientNames(
      listed
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
    if (changed || merged.length !== local.length) {
      // Lo que no entró al aparato no vuelve en una bajada parcial: el pull no es OK.
      if (!writeDemoJson(DEMO_PAYMENTS_KEY, merged)) {
        return { ok: false, added: 0, changed: false, reason: "sin espacio en el aparato: cobros" };
      }
    }
    if (fromDate && !since && !toDate) requeueDayPaymentsMissingFromCloud(fromDate, remote, merged);
    // Misma lista que acaba de bajar: loadLivePaymentRows no re-fetcha en el mismo ciclo.
    livePaymentCache = merged.length > 0 ? merged : livePaymentCache;
    return {
      ok: true,
      added,
      changed: changed || merged.length !== local.length,
      rows: merged,
      full: body.full,
      cursor: body.cursor,
      ...(body.full && !fromDate
        ? {
            remoteRefs: remote.map((row) => row.ref),
            remoteVoidedRefs: remote.filter(paymentIsVoided).map((row) => row.ref),
          }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "pull_failed";
    return { ok: false, added: 0, changed: false, reason: message };
  }
}

/**
 * Cobros del día que el aparato dio por subidos y la lista completa de ese día en la nube no
 * trae: vuelven a la cola. Solo con clave, así un reintento devuelve el mismo cobro.
 */
function requeueDayPaymentsMissingFromCloud(day: string, remote: PaymentRow[], local: PaymentRow[]) {
  const inCloud = new Set(remote.map((row) => row.ref));
  const queued = new Set(readMirrorQueue().map((row) => row.ref));
  for (const row of local) {
    if ((normalizeHistoryDate(row.paidDate || "") || row.paidDate) !== day) continue;
    if (!row.idempotencyKey?.trim() || paymentIsVoided(row)) continue;
    if (inCloud.has(row.ref) || queued.has(row.ref)) continue;
    enqueueMirrorPayment(withPaymentEvidence(row));
  }
}

/** Historial cobrador: baja un día, lo mezcla y no toca la cola. */
export async function mergePaymentsWindowIntoDemo(fromDate: string, toDate = fromDate) {
  const result = await mergeRemotePayments(null, fromDate, toDate);
  return (result.rows ?? []).filter((row) => {
    const day = String(row.paidDate || "");
    return day >= fromDate && day <= toDate;
  });
}
