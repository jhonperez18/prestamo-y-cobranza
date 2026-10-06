/**
 * C5: clientes y préstamos compartidos (Postgres raíz; local = caché + cola offline).
 * @see docs/demo-to-backend.md
 */
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { fetchAllRows, fetchRowsChangedSince } from "@/lib/supabase/changed-since";
import { createIncrementalPull, withSinceParam } from "@/lib/incremental-pull";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { ClientRow, LoanRow, StatusKind } from "@/lib/mock-data";
import {
  DEMO_CLIENTS_KEY,
  DEMO_LOANS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import { isDeletedRef, readDeletedIdSet, rememberDeletedId } from "@/lib/deleted-ids";
import {
  emitMirrorQueueChanged,
  queueWithoutSent,
  shouldDropFromMirrorQueue,
  type MirrorApiJson,
} from "@/lib/supabase/mirror-queue";

/**
 * Baja de cliente en la nube: la fila queda con este estado (no se borra) para que
 * todo aparato la aprenda en el pull / Realtime y la saque de su caché.
 */
export const CLIENT_DELETED_STATUS = "Eliminado";

export function isClientDeletedStatus(row: { status?: string | null } | null | undefined) {
  return String(row?.status || "").trim() === CLIENT_DELETED_STATUS;
}

/** Baja de préstamo en la nube: misma regla que el cliente (la fila queda «Eliminado»). */
export const LOAN_DELETED_STATUS = "Eliminado";

export function isLoanDeletedStatus(row: { status?: string | null } | null | undefined) {
  return String(row?.status || "").trim() === LOAN_DELETED_STATUS;
}

export const DEMO_CLIENT_MIRROR_QUEUE_KEY = "nexo-demo-client-mirror-queue";
export const DEMO_LOAN_MIRROR_QUEUE_KEY = "nexo-demo-loan-mirror-queue";
/**
 * Tras Guardar / mirror: el pull no pisa la ficha local hasta que la nube
 * coincida en firma. Sin caducidad corta (antes 15 min → rebobinaba).
 */
export const DEMO_CLIENT_PULL_SHIELD_KEY = "nexo-demo-client-pull-shield";
/** Solo válvula de seguridad: escudos huérfanos > 7 días. */
const CLIENT_PULL_SHIELD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type ClientPullShieldEntry = { client: ClientRow; armedAt: number };

export type ClientMirrorRow = {
  ref: string;
  alta: string;
  name: string;
  last_name: string;
  nickname: string | null;
  document: string;
  city: string;
  barrio: string;
  route: string;
  route_order: number;
  email: string;
  phone: string;
  address: string;
  notes: string;
  photo: string | null;
  lat: number | null;
  lng: number | null;
  total: number;
  pending: number;
  status: string;
  kind: string;
  created_by: string | null;
  awaiting_loan: boolean;
  profile_pending: boolean;
  updated_at: string;
};

export type LoanMirrorRow = {
  ref: string;
  client_ref: string;
  client_name: string;
  start_date: string;
  due_date: string;
  capital: number;
  paid: number;
  balance: number;
  status: string;
  kind: string;
  notes: string | null;
  rate: number | null;
  frequency: string | null;
  mode: string | null;
  pact: string | null;
  days: number | null;
  interest: number | null;
  total: number | null;
  installment: number | null;
  schedule: LoanRow["schedule"] | null;
  collection_alerts: number;
  terms_pending: boolean;
  updated_at: string;
};

function createMirrorClient() {
  return createMirrorServerClient();
}

export function clientRowToMirror(row: ClientRow): ClientMirrorRow | null {
  const ref = (row.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    alta: row.alta || "",
    name: row.name || "",
    last_name: row.lastName || "",
    nickname: row.nickname?.trim() || null,
    document: row.document || "",
    city: row.city || "",
    barrio: row.barrio || "",
    route: row.route || "",
    route_order: Number(row.routeOrder) || 0,
    email: row.email || "",
    phone: row.phone || "",
    address: row.address || "",
    notes: row.notes || "",
    photo: row.photo || null,
    lat: typeof row.lat === "number" ? row.lat : null,
    lng: typeof row.lng === "number" ? row.lng : null,
    total: Number(row.total) || 0,
    pending: Number(row.pending) || 0,
    status: row.status || "Activo",
    kind: row.kind || "ok",
    created_by: row.createdBy || null,
    awaiting_loan: Boolean(row.awaitingLoan),
    profile_pending: Boolean(row.profilePending),
    updated_at: row.updatedAt || new Date().toISOString(),
  };
}

export function mirrorToClientRow(row: ClientMirrorRow): ClientRow | null {
  const ref = (row.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    alta: row.alta || "",
    name: row.name || "",
    lastName: row.last_name || "",
    nickname: row.nickname || undefined,
    document: row.document || "",
    city: row.city || "",
    barrio: row.barrio || "",
    route: row.route || "",
    routeOrder: Number(row.route_order) || 0,
    email: row.email || "",
    phone: row.phone || "",
    address: row.address || "",
    notes: row.notes || "",
    photo: row.photo || undefined,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    total: Number(row.total) || 0,
    pending: Number(row.pending) || 0,
    status: row.status || "Activo",
    kind: (row.kind as StatusKind) || "ok",
    createdBy: row.created_by || undefined,
    awaitingLoan: Boolean(row.awaiting_loan),
    profilePending: Boolean(row.profile_pending),
    updatedAt: row.updated_at || undefined,
  };
}

export function loanRowToMirror(row: LoanRow): LoanMirrorRow | null {
  const ref = (row.ref || "").trim();
  const clientRef = (row.clientRef || "").trim();
  if (!ref || !clientRef) return null;
  return {
    ref,
    client_ref: clientRef,
    client_name: row.client || "",
    start_date: row.date || "",
    due_date: row.due || "",
    capital: Number(row.capital) || 0,
    paid: Number(row.paid) || 0,
    balance: Number(row.balance) || 0,
    status: row.status || "Activo",
    kind: row.kind || "ok",
    notes: row.notes ?? null,
    rate: row.rate ?? null,
    frequency: row.frequency ?? null,
    mode: row.mode ?? null,
    pact: row.pact ?? null,
    days: row.days ?? null,
    interest: row.interest ?? null,
    total: row.total ?? null,
    installment: row.installment ?? null,
    schedule: row.schedule ?? null,
    collection_alerts: Number(row.collectionAlerts) || 0,
    terms_pending: Boolean(row.termsPending),
    updated_at: row.updatedAt || new Date().toISOString(),
  };
}

export function mirrorToLoanRow(row: LoanMirrorRow): LoanRow | null {
  const ref = (row.ref || "").trim();
  const clientRef = (row.client_ref || "").trim();
  if (!ref || !clientRef) return null;
  return {
    ref,
    clientRef,
    client: row.client_name || "",
    date: row.start_date || "",
    due: row.due_date || "",
    capital: Number(row.capital) || 0,
    paid: Number(row.paid) || 0,
    balance: Number(row.balance) || 0,
    status: row.status || "Activo",
    kind: (row.kind as StatusKind) || "ok",
    notes: row.notes || undefined,
    rate: row.rate ?? undefined,
    frequency: (row.frequency as LoanRow["frequency"]) || undefined,
    mode: (row.mode as LoanRow["mode"]) || undefined,
    pact: (row.pact as LoanRow["pact"]) || undefined,
    days: row.days ?? undefined,
    interest: row.interest ?? undefined,
    total: row.total ?? undefined,
    installment: row.installment ?? undefined,
    schedule: row.schedule || undefined,
    collectionAlerts: Number(row.collection_alerts) || 0,
    termsPending: Boolean(row.terms_pending),
    updatedAt: row.updated_at || undefined,
    fundedBy: row.notes?.includes("[[fb:nequi]]")
      ? "nequi"
      : row.notes?.includes("[[fb:efectivo]]")
        ? "efectivo"
        : row.notes?.includes("[[fb:banco]]")
          ? "banco"
          : row.notes?.includes("[[fb:cartera]]")
            ? "cartera"
            : undefined,
  };
}

function rowUpdatedAtMs(row: { updatedAt?: string }) {
  return Date.parse(String(row.updatedAt || "")) || 0;
}

/**
 * Merge local ← remoto (sistema madre).
 * 1) Cola / escudo (= pendingSync) → siempre local pendiente.
 * 2) Sin local → remoto (alta nueva en nube).
 * 3) Misma firma → meta más nueva; empate → local.
 * 4) Firma distinta → local si local.updatedAt >= remoto; si no, remoto (otro dispositivo).
 */
function mergeByRefPreferPendingLocal<T extends { ref: string; updatedAt?: string }>(
  local: T[],
  remote: T[],
  pendingByRef: Map<string, T>,
  signature: (row: T) => string,
): { merged: T[]; added: number; changed: boolean } {
  const localByRef = new Map<string, T>();
  for (const row of local) {
    if (row?.ref) localByRef.set(row.ref, row);
  }
  const merged: T[] = [];
  let added = 0;
  let changed = false;
  const seen = new Set<string>();

  for (const remoteRow of remote) {
    if (!remoteRow?.ref) continue;
    const ref = remoteRow.ref;
    if (isDeletedRef(ref)) {
      if (localByRef.delete(ref)) changed = true;
      pendingByRef.delete(ref);
      continue;
    }
    seen.add(ref);
    const pending = pendingByRef.get(ref);
    const localRow = localByRef.get(ref);
    if (pending) {
      if (!localRow || signature(pending) !== signature(localRow)) changed = true;
      if (signature(pending) !== signature(remoteRow)) changed = true;
      merged.push(pending);
      localByRef.delete(ref);
      continue;
    }
    if (!localRow) {
      merged.push(remoteRow);
      added += 1;
      changed = true;
      localByRef.delete(ref);
      continue;
    }

    const localTs = rowUpdatedAtMs(localRow);
    const remoteTs = rowUpdatedAtMs(remoteRow);
    const sameSig = signature(localRow) === signature(remoteRow);

    if (sameSig) {
      const winner = remoteTs > localTs ? remoteRow : localRow;
      if (winner !== localRow) changed = true;
      merged.push(winner);
      localByRef.delete(ref);
      continue;
    }

    // Contenido distinto: no rebobinar edit fresco del padre.
    // Empate de reloj → local. Remoto solo si es estrictamente más nuevo.
    const winner = localTs >= remoteTs ? localRow : remoteRow;
    if (signature(winner) !== signature(localRow)) changed = true;
    merged.push(winner);
    localByRef.delete(ref);
  }
  for (const row of localByRef.values()) {
    if (!row?.ref || seen.has(row.ref) || isDeletedRef(row.ref)) continue;
    const pending = pendingByRef.get(row.ref);
    merged.push(pending ?? row);
  }
  for (const [ref, row] of pendingByRef) {
    if (seen.has(ref) || localByRef.has(ref) || isDeletedRef(ref)) continue;
    merged.push(row);
    added += 1;
    changed = true;
  }
  return { merged, added, changed };
}

/** Toda la ficha editable: si falta un campo, el pull “igual” rebobina Guardar. */
function clientSignature(row: ClientRow) {
  return [
    row.ref,
    row.name,
    row.lastName,
    row.nickname ?? "",
    row.document,
    row.route,
    row.routeOrder,
    row.phone ?? "",
    row.email ?? "",
    row.city ?? "",
    row.barrio ?? "",
    row.address ?? "",
    row.notes ?? "",
    row.photo ?? "",
    row.status,
    row.kind ?? "",
    Number(row.total),
    Number(row.pending),
    row.awaitingLoan ? 1 : 0,
    row.profilePending ? 1 : 0,
  ].join("|");
}

function loanSignature(row: LoanRow) {
  const scheduleKey = (row.schedule ?? [])
    .map((line) => `${line.date}:${Number(line.amount) || 0}`)
    .join(",");
  return [
    row.ref,
    row.clientRef,
    row.date,
    row.due,
    Number(row.capital),
    Number(row.paid),
    Number(row.balance),
    row.status,
    row.frequency ?? "",
    row.mode ?? "",
    Number(row.days) || 0,
    Number(row.interest) || 0,
    Number(row.total) || 0,
    Number(row.installment) || 0,
    scheduleKey,
    row.notes ?? "",
    row.fundedBy ?? "",
    row.termsPending ? 1 : 0,
    Number(row.collectionAlerts) || 0,
  ].join("|");
}

function mirrorSkipReason() {
  const { configured: pub } = getSupabasePublicEnv();
  if (pub && !mirrorUsesServiceRole()) return "service_role_missing";
  return "supabase_not_configured";
}

export async function mirrorClientToSupabase(client: ClientRow) {
  const row = clientRowToMirror(client);
  if (!row) return { ok: true as const, skipped: true as const, reason: "invalid_client" };
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason() };
  if (!isClientDeletedStatus(row)) {
    const { data: current, error: readError } = await supabase
      .from("clients")
      .select("status")
      .eq("ref", row.ref)
      .maybeSingle();
    if (readError) return { ok: false as const, error: readError.message };
    if (isClientDeletedStatus(current)) {
      return { ok: true as const, skipped: true as const, reason: "client_deleted" };
    }
  }
  const { error } = await supabase.from("clients").upsert(row, { onConflict: "ref" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function mirrorLoanToSupabase(loan: LoanRow) {
  const row = loanRowToMirror(loan);
  if (!row) return { ok: true as const, skipped: true as const, reason: "invalid_loan" };
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason() };
  const deleting = isLoanDeletedStatus(row);
  if (!deleting) {
    const { data: current, error: readError } = await supabase
      .from("loans")
      .select("status")
      .eq("ref", row.ref)
      .maybeSingle();
    if (readError) return { ok: false as const, error: readError.message };
    if (isLoanDeletedStatus(current)) {
      return { ok: true as const, skipped: true as const, reason: "loan_deleted" };
    }
  }
  const { error } = await supabase.from("loans").upsert(row, { onConflict: "ref" });
  if (error) return { ok: false as const, error: error.message };
  if (deleting) {
    // Visitas abiertas de ese préstamo (sin cobro ni cierre): fuera de la planilla en la nube,
    // si no vuelven por el pull a cada aparato y dejan la jornada sin CIE-.
    const { error: assignError } = await supabase
      .from("daily_assignments")
      .delete()
      .eq("loan_ref", row.ref)
      .is("day_closed_at", null)
      .is("payment_ref", null);
    if (assignError) return { ok: false as const, error: assignError.message };
  }
  return { ok: true as const };
}

/** `since`: solo filas que cambiaron o se crearon desde ese corte (incluye bajas por estado). */
export async function fetchClientsFromSupabase(since: string | null = null) {
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason(), rows: [] as ClientMirrorRow[] };
  if (since) {
    const changed = await fetchRowsChangedSince<ClientMirrorRow>(supabase, "clients", "*", since);
    if (!changed.ok) return { ok: false as const, error: changed.error, rows: [] as ClientMirrorRow[] };
    return { ok: true as const, rows: changed.rows };
  }
  const all = await fetchAllRows<ClientMirrorRow>(supabase, "clients", "*");
  if (!all.ok) return { ok: false as const, error: all.error, rows: [] as ClientMirrorRow[] };
  return { ok: true as const, rows: all.rows };
}

export async function fetchLoansFromSupabase(since: string | null = null) {
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason(), rows: [] as LoanMirrorRow[] };
  if (since) {
    const changed = await fetchRowsChangedSince<LoanMirrorRow>(supabase, "loans", "*", since);
    if (!changed.ok) return { ok: false as const, error: changed.error, rows: [] as LoanMirrorRow[] };
    return { ok: true as const, rows: changed.rows };
  }
  const all = await fetchAllRows<LoanMirrorRow>(supabase, "loans", "*");
  if (!all.ok) return { ok: false as const, error: all.error, rows: [] as LoanMirrorRow[] };
  return { ok: true as const, rows: all.rows };
}

function readQueue<T extends { ref: string }>(key: string) {
  return readDemoJson<T[]>(key, []).filter((row) => row?.ref);
}

function writeQueue<T>(key: string, rows: T[]) {
  writeDemoJson(key, rows);
  emitMirrorQueueChanged();
}

/** Sale de la cola solo lo confirmado por la nube y sin cambios desde que se envió. */
function dequeueSent(key: string, sent: readonly { ref: string }[]) {
  if (!sent.length) return;
  const current = readQueue<{ ref: string }>(key);
  const left = queueWithoutSent(current, sent);
  if (left.length !== current.length) writeQueue(key, left);
}

/** Envío fallido: la fila sigue en cola sin pisar una versión más nueva encolada mientras subía. */
function keepQueued<T extends { ref: string }>(key: string, row: T) {
  const current = readQueue<T>(key);
  if (current.some((entry) => entry.ref === row.ref)) return;
  writeQueue(key, [...current, row]);
}

function readClientPullShield(): Map<string, ClientRow> {
  const raw = readDemoJson<ClientPullShieldEntry[]>(DEMO_CLIENT_PULL_SHIELD_KEY, []);
  const now = Date.now();
  const alive: ClientPullShieldEntry[] = [];
  const byRef = new Map<string, ClientRow>();
  for (const entry of raw) {
    if (!entry?.client?.ref) continue;
    const armedAt = Number(entry.armedAt) || 0;
    // Compat: entradas viejas con `until` se tratan como armadas.
    const legacyUntil = Number((entry as { until?: number }).until) || 0;
    const ageBase = armedAt || (legacyUntil ? legacyUntil - 15 * 60 * 1000 : now);
    if (ageBase && now - ageBase > CLIENT_PULL_SHIELD_MAX_AGE_MS) continue;
    alive.push({ client: entry.client, armedAt: ageBase || now });
    byRef.set(entry.client.ref, entry.client);
  }
  if (alive.length !== raw.length) writeDemoJson(DEMO_CLIENT_PULL_SHIELD_KEY, alive);
  return byRef;
}

function armClientPullShield(client: ClientRow) {
  if (!client?.ref) return;
  const raw = readDemoJson<ClientPullShieldEntry[]>(DEMO_CLIENT_PULL_SHIELD_KEY, []);
  const next = raw.filter((entry) => entry?.client?.ref && entry.client.ref !== client.ref);
  next.push({ client, armedAt: Date.now() });
  writeDemoJson(DEMO_CLIENT_PULL_SHIELD_KEY, next);
}

function pruneClientPullShieldAgainstRemote(remoteByRef: Map<string, ClientRow>) {
  const raw = readDemoJson<ClientPullShieldEntry[]>(DEMO_CLIENT_PULL_SHIELD_KEY, []);
  const next = raw.filter((entry) => {
    if (!entry?.client?.ref) return false;
    const remote = remoteByRef.get(entry.client.ref);
    // Sin remoto aún → mantener escudo.
    if (!remote) return true;
    // Nube ya tiene la misma ficha → soltar.
    return clientSignature(entry.client) !== clientSignature(remote);
  });
  if (next.length !== raw.length) writeDemoJson(DEMO_CLIENT_PULL_SHIELD_KEY, next);
}

/** Sin `keepalive` (Chrome lo rechaza con >64 KB en vuelo); la cola cubre el cierre de la app. */
async function postMirror(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
  return { res, json };
}

export async function persistClientToSupabase(client: ClientRow) {
  if (typeof window === "undefined") return { ok: true as const, skipped: true as const, reason: "ssr" };
  try {
    const { res, json } = await postMirror("/api/clients/mirror", { client });
    if (!res.ok || !json.ok) {
      keepQueued(DEMO_CLIENT_MIRROR_QUEUE_KEY, client);
      return { ok: false as const, error: json.error || `http_${res.status}` };
    }
    if (!json.skipped) {
      dequeueSent(DEMO_CLIENT_MIRROR_QUEUE_KEY, [client]);
      armClientPullShield(client);
    }
    return { ok: true as const, skipped: json.skipped };
  } catch (err) {
    keepQueued(DEMO_CLIENT_MIRROR_QUEUE_KEY, client);
    return { ok: false as const, error: err instanceof Error ? err.message : "network" };
  }
}

export async function persistLoanToSupabase(loan: LoanRow) {
  if (typeof window === "undefined") return { ok: true as const, skipped: true as const, reason: "ssr" };
  try {
    const { res, json } = await postMirror("/api/loans/mirror", { loan });
    if (!res.ok || !json.ok) {
      keepQueued(DEMO_LOAN_MIRROR_QUEUE_KEY, loan);
      return { ok: false as const, error: json.error || `http_${res.status}` };
    }
    if (!json.skipped) dequeueSent(DEMO_LOAN_MIRROR_QUEUE_KEY, [loan]);
    return { ok: true as const, skipped: json.skipped };
  } catch (err) {
    keepQueued(DEMO_LOAN_MIRROR_QUEUE_KEY, loan);
    return { ok: false as const, error: err instanceof Error ? err.message : "network" };
  }
}

export function queueClientMirror(client: ClientRow) {
  if (typeof window === "undefined") return;
  // Cola + escudo primero: un pull concurrente no rebobina el edit mientras sube.
  const q = readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY).filter((r) => r.ref !== client.ref);
  q.push(client);
  writeQueue(DEMO_CLIENT_MIRROR_QUEUE_KEY, q);
  armClientPullShield(client);
  void persistClientToSupabase(client);
}

/** Fila que sube a la nube para dar de baja al cliente (misma cola que Guardar). */
export function clientDeletedRow(client: ClientRow, at = new Date().toISOString()): ClientRow {
  return { ...client, status: CLIENT_DELETED_STATUS, updatedAt: at };
}

/** Baja hecha en otro aparato → tombstone local. Devuelve si aprendió alguna nueva. */
function learnRemoteClientDeletes(remote: ClientRow[]) {
  const known = readDeletedIdSet();
  let learned = false;
  for (const row of remote) {
    if (!isClientDeletedStatus(row) || known.has(row.ref)) continue;
    rememberDeletedId(row.ref);
    learned = true;
  }
  return learned;
}

/**
 * Bajas que quedaron solo en este aparato (antes no viajaban): suben a la nube.
 * Solo clientes sin préstamos en la nube — los únicos que se pueden eliminar.
 */
function queueLocalClientDeletesToCloud(liveRemote: ClientRow[], clientRefsWithLoans: ReadonlySet<string>) {
  const gone = readDeletedIdSet();
  if (!gone.size) return;
  const queued = new Set(
    readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY)
      .filter((row) => isClientDeletedStatus(row))
      .map((row) => row.ref),
  );
  for (const row of liveRemote) {
    if (!row.ref.startsWith("COD-") || !gone.has(row.ref)) continue;
    if (clientRefsWithLoans.has(row.ref) || queued.has(row.ref)) continue;
    queueClientMirror(clientDeletedRow(row));
  }
}

/** Fila que sube a la nube para dar de baja el préstamo (misma cola que Guardar). */
export function loanDeletedRow(loan: LoanRow, at = new Date().toISOString()): LoanRow {
  return { ...loan, status: LOAN_DELETED_STATUS, updatedAt: at };
}

/** Baja de préstamo hecha en otro aparato → tombstone local. */
function learnRemoteLoanDeletes(remote: LoanRow[]) {
  const known = readDeletedIdSet();
  let learned = false;
  for (const row of remote) {
    if (!isLoanDeletedStatus(row) || known.has(row.ref)) continue;
    rememberDeletedId(row.ref);
    learned = true;
  }
  return learned;
}

export function queueLoanMirror(loan: LoanRow) {
  if (typeof window === "undefined") return;
  const q = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).filter((r) => r.ref !== loan.ref);
  q.push(loan);
  writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, q);
  void persistLoanToSupabase(loan);
}

export function queueLoansMirror(loans: LoanRow[]) {
  for (const loan of loans) queueLoanMirror(loan);
}

export async function flushCatalogMirrorQueues() {
  if (typeof window === "undefined") return;
  const sentClients: ClientRow[] = [];
  for (const client of readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY)) {
    try {
      const { res, json } = await postMirror("/api/clients/mirror", { client });
      const body = json as MirrorApiJson;
      if (!res.ok || !shouldDropFromMirrorQueue(body)) continue;
      if (!body.skipped) armClientPullShield(client);
      sentClients.push(client);
    } catch {
      /* queda en cola */
    }
  }
  dequeueSent(DEMO_CLIENT_MIRROR_QUEUE_KEY, sentClients);

  const sentLoans: LoanRow[] = [];
  for (const loan of readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY)) {
    try {
      const { res, json } = await postMirror("/api/loans/mirror", { loan });
      if (res.ok && shouldDropFromMirrorQueue(json as MirrorApiJson)) sentLoans.push(loan);
    } catch {
      /* queda en cola */
    }
  }
  dequeueSent(DEMO_LOAN_MIRROR_QUEUE_KEY, sentLoans);
}

export type PullCatalogResult = {
  ok: boolean;
  changed: boolean;
  reason?: string;
  /** true = bajó la lista completa de clientes y préstamos. */
  full?: boolean;
};

type CatalogListBody<Key extends "clients" | "loans", Row> = {
  ok?: boolean;
  skipped?: boolean;
  error?: string;
  incremental?: boolean;
  cursor?: string;
} & { [K in Key]?: Row[] };

/** Lista completa al abrir, cada 10 min, al reparar y en la puesta a punto; entre medio solo lo cambiado. */
const catalogPull = createIncrementalPull();

/**
 * Pull clientes + préstamos. Cola/escudo y updatedAt local ganan sobre remoto viejo.
 * `full`: lista completa; si no, solo lo cambiado (una parcial nunca borra lo que no vino).
 */
export async function pullRemoteCatalogIntoDemo(
  opts: { full?: boolean } = {},
): Promise<PullCatalogResult> {
  if (typeof window === "undefined") {
    return { ok: true, changed: false, reason: "ssr" };
  }
  const startedAt = Date.now();
  const localEmpty =
    readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []).length === 0 ||
    readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []).length === 0;
  const since = catalogPull.sinceFor(Boolean(opts.full) || localEmpty);
  const { cursor, ...result } = await mergeRemoteCatalog(since);
  catalogPull.settle({ ok: result.ok, full: Boolean(result.full), cursor }, startedAt);
  return result;
}

/** `cursor` solo si clientes y préstamos entraron enteros al aparato. */
async function mergeRemoteCatalog(
  since: string | null,
): Promise<PullCatalogResult & { cursor?: string | null }> {
  try {
    const [clientsRes, loansRes] = await Promise.all([
      fetch(withSinceParam("/api/clients", since), { cache: "no-store" }),
      fetch(withSinceParam("/api/loans", since), { cache: "no-store" }),
    ]);
    const clientsBody = (await clientsRes.json()) as CatalogListBody<"clients", ClientMirrorRow>;
    const loansBody = (await loansRes.json()) as CatalogListBody<"loans", LoanMirrorRow>;

    if (!clientsRes.ok || !clientsBody.ok) {
      return { ok: false, changed: false, reason: clientsBody.error || "clients_pull_failed" };
    }

    const full = !clientsBody.incremental && !loansBody.incremental;
    let changed = false;
    let loansOk = true;
    let loansReason: string | undefined;
    const unsaved: string[] = [];

    if (!clientsBody.skipped) {
      const remoteAll = (clientsBody.clients ?? [])
        .map(mirrorToClientRow)
        .filter((row): row is ClientRow => Boolean(row));
      const learnedDeletes = learnRemoteClientDeletes(remoteAll);
      const remote = remoteAll.filter((row) => !isClientDeletedStatus(row));
      // Solo contra listas completas: con una parcial, un cliente con préstamo que no vino
      // se vería «sin préstamos» y se encolaría su baja.
      if (full && loansRes.ok && loansBody.ok && !loansBody.skipped) {
        queueLocalClientDeletesToCloud(
          remote,
          new Set((loansBody.loans ?? []).map((row) => row.client_ref)),
        );
      }
      const local = readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []);
      const pendingClients = readDemoJson<ClientRow[]>(DEMO_CLIENT_MIRROR_QUEUE_KEY, []).filter(
        (row) => row?.ref,
      );
      const pendingByRef = new Map(pendingClients.map((row) => [row.ref, row]));
      // Escudo post-mirror: misma fuerza que cola (Guardar del padre no se rebobina).
      for (const [ref, row] of readClientPullShield()) {
        if (!pendingByRef.has(ref)) pendingByRef.set(ref, row);
      }
      const merge = mergeByRefPreferPendingLocal(local, remote, pendingByRef, clientSignature);
      if (merge.changed || learnedDeletes || (local.length === 0 && remote.length > 0)) {
        if (!writeDemoJson(DEMO_CLIENTS_KEY, merge.merged.length ? merge.merged : remote)) {
          unsaved.push("clientes");
        }
        changed = true;
      }
      const remoteByRef = new Map(remoteAll.map((row) => [row.ref, row]));
      pruneClientPullShieldAgainstRemote(remoteByRef);
    }

    if (!loansRes.ok || !loansBody.ok) {
      loansOk = false;
      loansReason = loansBody.error || "loans_pull_failed";
    } else if (!loansBody.skipped) {
      const remoteAll = (loansBody.loans ?? [])
        .map(mirrorToLoanRow)
        .filter((row): row is LoanRow => Boolean(row));
      const learnedDeletes = learnRemoteLoanDeletes(remoteAll);
      const remote = remoteAll.filter((row) => !isLoanDeletedStatus(row));
      const local = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
      const pendingLoans = readDemoJson<LoanRow[]>(DEMO_LOAN_MIRROR_QUEUE_KEY, []).filter(
        (row) => row?.ref && !isLoanDeletedStatus(row),
      );
      const pendingByRef = new Map(pendingLoans.map((row) => [row.ref, row]));
      const merge = mergeByRefPreferPendingLocal(local, remote, pendingByRef, loanSignature);
      if (merge.changed || learnedDeletes) {
        if (!writeDemoJson(DEMO_LOANS_KEY, merge.merged)) unsaved.push("préstamos");
        changed = true;
      }
    }

    if (clientsBody.skipped && (!loansOk || loansBody.skipped)) {
      return { ok: loansOk, changed: false, reason: loansReason || "skipped" };
    }
    // Lo que no entró al aparato no vuelve en una bajada parcial: el pull no es OK.
    if (unsaved.length) {
      return { ok: false, changed, full, reason: `sin espacio en el aparato: ${unsaved.join(", ")}` };
    }

    const complete = loansOk && !clientsBody.skipped && !loansBody.skipped;
    const cursors = [clientsBody.cursor, loansBody.cursor].filter((c): c is string => Boolean(c));
    return {
      ok: true,
      changed,
      full,
      reason: loansOk ? undefined : loansReason,
      cursor: complete && cursors.length === 2 ? cursors.sort()[0] : null,
    };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      reason: err instanceof Error ? err.message : "catalog_pull_failed",
    };
  }
}
