/**
 * Estado y contrato de colas mirror (local → API → Supabase service role).
 * Un `ok: true, skipped: true` NO es escritura: la fila debe quedarse en cola
 * salvo motivos irrecuperables o "la nube ya ganó a propósito".
 *
 * Claves duplicadas como literales a propósito: evita ciclos con payment/ops-mirror.
 */
import { readDemoJson } from "@/lib/demo-persist";
import { LOAN_REJECTION_REASONS, LOAN_SILENT_SKIPS } from "@/lib/loan-command";

export const MIRROR_QUEUE_CHANGED_EVENT = "nexo-mirror-queue-changed";

const Q_PAYMENTS = "nexo-demo-payment-mirror-queue";
const Q_CLIENTS = "nexo-demo-client-mirror-queue";
const Q_LOANS = "nexo-demo-loan-mirror-queue";
const Q_USERS = "nexo-demo-user-mirror-queue";
const Q_USER_DELETES = "nexo-demo-user-delete-queue";
const Q_BANKS = "nexo-demo-bank-account-mirror-queue";
const Q_MONTH_CLOSES = "nexo-demo-month-close-mirror-queue";

/** Respuestas skipped que SÍ pueden salir de cola (no tiene sentido reintentar). */
const DROP_ON_SKIP_REASON = new Set([
  "invalid_payment",
  "invalid_client",
  "client_deleted",
  "invalid_loan",
  "loan_deleted",
  "loan_delete_not_owner",
  "prestar_ghost",
  "cloud_cie_keeps_cash_float",
  "cloud_cie_keeps_cash_adjustment",
  "cloud_cie_past_day_sealed",
  "provisional_day_close",
  "cie_reopened",
  ...LOAN_SILENT_SKIPS,
  ...LOAN_REJECTION_REASONS,
]);

/**
 * Firma de una fila de cola tal como queda en el aparato (sin fotos `data:`, que no
 * entran a localStorage). Lo enviado y lo encolado se comparan con esta firma.
 */
export function queueRowSig(row: unknown): string {
  return JSON.stringify(row, (key, entry) =>
    key === "previewUrl" && typeof entry === "string" && entry.startsWith("data:") ? undefined : entry,
  );
}

/**
 * Sobrevivientes de la cola tras una subida: sale solo lo que la nube confirmó y que no
 * cambió mientras subía. Lo encolado (o editado) durante el envío se queda.
 */
export function queueWithoutSent<T extends { ref: string }>(
  current: readonly T[],
  sent: readonly { ref: string }[],
): T[] {
  if (!sent.length) return [...current];
  const sentSig = new Map(sent.map((row) => [row.ref, queueRowSig(row)]));
  return current.filter((row) => sentSig.get(row.ref) !== queueRowSig(row));
}

export type MirrorApiJson = {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  kept?: boolean;
  error?: string;
  /** Alta de préstamo: si el P- ya era de otro cliente, la nube asignó otro. */
  ref?: string;
  rekeyed?: boolean;
};

/**
 * ¿Se puede sacar la fila de la cola?
 * - Escritura real (`ok` sin skipped) o `kept` (nube ya tenía el sello).
 * - Skipped solo si el motivo es basura / CIE nube gana a propósito.
 * - `supabase_not_configured` / `virgin_write_lock` / red → SE QUEDA.
 */
export function shouldDropFromMirrorQueue(json: MirrorApiJson | null | undefined): boolean {
  if (!json?.ok) return false;
  if (json.skipped) {
    return DROP_ON_SKIP_REASON.has(String(json.reason || ""));
  }
  return true;
}

const OPS_QUEUE_KEYS = [
  "nexo-demo-ops-collectors-queue",
  "nexo-demo-ops-collector-deletes-queue",
  "nexo-demo-ops-routes-queue",
  "nexo-demo-ops-route-deletes-queue",
  "nexo-demo-ops-day-closes-queue",
  "nexo-demo-ops-day-expenses-queue",
  "nexo-demo-ops-misc-queue",
  "nexo-demo-ops-assignments-queue",
  Q_MONTH_CLOSES,
] as const;

const ALL_QUEUE_KEYS = [
  Q_PAYMENTS,
  Q_CLIENTS,
  Q_LOANS,
  Q_USERS,
  Q_USER_DELETES,
  Q_BANKS,
  ...OPS_QUEUE_KEYS,
] as const;

/** Filas sin `ref` en cualquier cola: no se pueden subir ni sacar de cola por ref. */
export function countInvalidMirrorQueueRows(): number {
  if (typeof window === "undefined") return 0;
  let invalid = 0;
  for (const key of ALL_QUEUE_KEYS) {
    const rows = readDemoJson<{ ref?: string }[]>(key, []);
    if (Array.isArray(rows)) invalid += rows.filter((row) => !row?.ref).length;
  }
  return invalid;
}

function queueLen(key: string): number {
  const rows = readDemoJson<{ ref?: string }[]>(key, []);
  return Array.isArray(rows) ? rows.filter((row) => row?.ref).length : 0;
}

export type MirrorPendingBreakdown = {
  payments: number;
  clients: number;
  loans: number;
  users: number;
  userDeletes: number;
  bankAccounts: number;
  ops: number;
  total: number;
};

/** Cuántos registros siguen sin confirmar en Supabase. */
export function countPendingMirrorQueues(): MirrorPendingBreakdown {
  if (typeof window === "undefined") {
    return {
      payments: 0,
      clients: 0,
      loans: 0,
      users: 0,
      userDeletes: 0,
      bankAccounts: 0,
      ops: 0,
      total: 0,
    };
  }
  const payments = queueLen(Q_PAYMENTS);
  const clients = queueLen(Q_CLIENTS);
  const loans = queueLen(Q_LOANS);
  const users = queueLen(Q_USERS);
  const userDeletes = queueLen(Q_USER_DELETES);
  const bankAccounts = queueLen(Q_BANKS);
  let ops = 0;
  for (const key of OPS_QUEUE_KEYS) ops += queueLen(key);
  const total = payments + clients + loans + users + userDeletes + bankAccounts + ops;
  return { payments, clients, loans, users, userDeletes, bankAccounts, ops, total };
}

export function emitMirrorQueueChanged(pending = countPendingMirrorQueues()) {
  if (typeof window === "undefined") return pending;
  try {
    window.dispatchEvent(
      new CustomEvent(MIRROR_QUEUE_CHANGED_EVENT, { detail: pending }),
    );
  } catch {
    /* ignore */
  }
  return pending;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Vacía todas las colas mirror con reintentos (micro-cortes).
 * Independiente del pull: si la red vuelve, sube lo pendiente.
 */
export async function flushAllMirrorQueues(options?: {
  attempts?: number;
}): Promise<{ left: number; attemptsUsed: number; pending: MirrorPendingBreakdown }> {
  if (typeof window === "undefined") {
    return { left: 0, attemptsUsed: 0, pending: countPendingMirrorQueues() };
  }

  const {
    flushPaymentMirrorQueue,
  } = await import("@/lib/supabase/payment-mirror");
  const { flushCatalogMirrorQueues } = await import("@/lib/supabase/catalog-mirror");
  const { flushOpsMirrorQueues } = await import("@/lib/supabase/ops-mirror");
  const { flushUserMirrorQueues } = await import("@/lib/supabase/user-mirror");
  const { flushBankAccountMirrorQueues } = await import(
    "@/lib/supabase/bank-accounts-mirror"
  );
  const { flushMonthCloseMirrorQueue } = await import("@/lib/supabase/month-close-mirror");

  const maxAttempts = Math.max(1, options?.attempts ?? 3);
  let attemptsUsed = 0;
  let pending = countPendingMirrorQueues();

  for (let i = 0; i < maxAttempts; i++) {
    attemptsUsed = i + 1;
    try {
      await flushPaymentMirrorQueue();
    } catch (error) {
      console.error("mirror-flush-payments", error);
    }
    try {
      await flushCatalogMirrorQueues();
    } catch (error) {
      console.error("mirror-flush-catalog", error);
    }
    try {
      await flushOpsMirrorQueues();
    } catch (error) {
      console.error("mirror-flush-ops", error);
    }
    try {
      await flushUserMirrorQueues();
    } catch (error) {
      console.error("mirror-flush-users", error);
    }
    try {
      await flushBankAccountMirrorQueues();
    } catch (error) {
      console.error("mirror-flush-banks", error);
    }
    try {
      await flushMonthCloseMirrorQueue();
    } catch (error) {
      console.error("mirror-flush-month-closes", error);
    }

    pending = emitMirrorQueueChanged();
    if (pending.total === 0) break;
    if (i + 1 < maxAttempts) {
      await sleep(350 * (i + 1));
    }
  }

  return { left: pending.total, attemptsUsed, pending };
}
