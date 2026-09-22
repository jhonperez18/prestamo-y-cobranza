/**
 * C5: clientes y préstamos compartidos (Postgres raíz; local = caché + cola offline).
 * @see docs/demo-to-backend.md
 */
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { ClientRow, LoanRow, StatusKind } from "@/lib/mock-data";
import {
  DEMO_CLIENTS_KEY,
  DEMO_LOANS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";

export const DEMO_CLIENT_MIRROR_QUEUE_KEY = "nexo-demo-client-mirror-queue";
export const DEMO_LOAN_MIRROR_QUEUE_KEY = "nexo-demo-loan-mirror-queue";

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
          : undefined,
  };
}

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
    if (signature(localRow) === signature(remoteRow)) {
      merged.push(remoteRow);
      localByRef.delete(ref);
      continue;
    }
    // Firmas distintas: gana el más reciente (updatedAt).
    // Celular supervisor recibe posiciones del PC; edit fresco local no se rebobina.
    // Sin reloj en ambos → local (no pisar este aparato con remoto opaco).
    const localTs = Date.parse(String(localRow.updatedAt || "")) || 0;
    const remoteTs = Date.parse(String(remoteRow.updatedAt || "")) || 0;
    const winner =
      remoteTs > localTs ? remoteRow : localTs > remoteTs ? localRow : localRow;
    if (signature(winner) !== signature(localRow)) changed = true;
    merged.push(winner);
    localByRef.delete(ref);
  }
  for (const row of localByRef.values()) {
    if (!row?.ref || seen.has(row.ref)) continue;
    const pending = pendingByRef.get(row.ref);
    merged.push(pending ?? row);
  }
  for (const [ref, row] of pendingByRef) {
    if (seen.has(ref) || localByRef.has(ref)) continue;
    merged.push(row);
    added += 1;
    changed = true;
  }
  return { merged, added, changed };
}

function clientSignature(row: ClientRow) {
  return [
    row.ref,
    row.name,
    row.lastName,
    row.document,
    row.route,
    row.routeOrder,
    row.phone,
    row.status,
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
  const { error } = await supabase.from("clients").upsert(row, { onConflict: "ref" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function mirrorLoanToSupabase(loan: LoanRow) {
  const row = loanRowToMirror(loan);
  if (!row) return { ok: true as const, skipped: true as const, reason: "invalid_loan" };
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason() };
  const { error } = await supabase.from("loans").upsert(row, { onConflict: "ref" });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function fetchClientsFromSupabase() {
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason(), rows: [] as ClientMirrorRow[] };
  const { data, error } = await supabase.from("clients").select("*").order("updated_at", { ascending: false }).limit(5000);
  if (error) return { ok: false as const, error: error.message, rows: [] as ClientMirrorRow[] };
  return { ok: true as const, rows: (data ?? []) as ClientMirrorRow[] };
}

export async function fetchLoansFromSupabase() {
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true as const, skipped: true as const, reason: mirrorSkipReason(), rows: [] as LoanMirrorRow[] };
  const { data, error } = await supabase.from("loans").select("*").order("updated_at", { ascending: false }).limit(5000);
  if (error) return { ok: false as const, error: error.message, rows: [] as LoanMirrorRow[] };
  return { ok: true as const, rows: (data ?? []) as LoanMirrorRow[] };
}

function readQueue<T extends { ref: string }>(key: string) {
  return readDemoJson<T[]>(key, []).filter((row) => row?.ref);
}

function writeQueue<T>(key: string, rows: T[]) {
  writeDemoJson(key, rows);
}

async function postMirror(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
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
      const q = readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY).filter((r) => r.ref !== client.ref);
      q.push(client);
      writeQueue(DEMO_CLIENT_MIRROR_QUEUE_KEY, q);
      return { ok: false as const, error: json.error || `http_${res.status}` };
    }
    if (!json.skipped) {
      writeQueue(
        DEMO_CLIENT_MIRROR_QUEUE_KEY,
        readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY).filter((r) => r.ref !== client.ref),
      );
    }
    return { ok: true as const, skipped: json.skipped };
  } catch (err) {
    const q = readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY).filter((r) => r.ref !== client.ref);
    q.push(client);
    writeQueue(DEMO_CLIENT_MIRROR_QUEUE_KEY, q);
    return { ok: false as const, error: err instanceof Error ? err.message : "network" };
  }
}

export async function persistLoanToSupabase(loan: LoanRow) {
  if (typeof window === "undefined") return { ok: true as const, skipped: true as const, reason: "ssr" };
  try {
    const { res, json } = await postMirror("/api/loans/mirror", { loan });
    if (!res.ok || !json.ok) {
      const q = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).filter((r) => r.ref !== loan.ref);
      q.push(loan);
      writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, q);
      return { ok: false as const, error: json.error || `http_${res.status}` };
    }
    if (!json.skipped) {
      writeQueue(
        DEMO_LOAN_MIRROR_QUEUE_KEY,
        readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).filter((r) => r.ref !== loan.ref),
      );
    }
    return { ok: true as const, skipped: json.skipped };
  } catch (err) {
    const q = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).filter((r) => r.ref !== loan.ref);
    q.push(loan);
    writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, q);
    return { ok: false as const, error: err instanceof Error ? err.message : "network" };
  }
}

export function queueClientMirror(client: ClientRow) {
  if (typeof window === "undefined") return;
  // Cola primero: un pull concurrente no rebobina el edit mientras sube.
  const q = readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY).filter((r) => r.ref !== client.ref);
  q.push(client);
  writeQueue(DEMO_CLIENT_MIRROR_QUEUE_KEY, q);
  void persistClientToSupabase(client);
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
  const clients = readQueue<ClientRow>(DEMO_CLIENT_MIRROR_QUEUE_KEY);
  const leftClients: ClientRow[] = [];
  for (const client of clients) {
    try {
      const { res, json } = await postMirror("/api/clients/mirror", { client });
      if (res.ok && json.ok && !json.skipped) continue;
      if (res.ok && json.ok && json.skipped && json.reason === "invalid_client") continue;
      leftClients.push(client);
    } catch {
      leftClients.push(client);
    }
  }
  writeQueue(DEMO_CLIENT_MIRROR_QUEUE_KEY, leftClients);

  const loans = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY);
  const leftLoans: LoanRow[] = [];
  for (const loan of loans) {
    try {
      const { res, json } = await postMirror("/api/loans/mirror", { loan });
      if (res.ok && json.ok && !json.skipped) continue;
      if (res.ok && json.ok && json.skipped && json.reason === "invalid_loan") continue;
      leftLoans.push(loan);
    } catch {
      leftLoans.push(loan);
    }
  }
  writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, leftLoans);
}

export type PullCatalogResult = {
  ok: boolean;
  changed: boolean;
  reason?: string;
};

/** Pull clientes + préstamos; remoto manda; local-only (offline) se conserva. */
export async function pullRemoteCatalogIntoDemo(): Promise<PullCatalogResult> {
  if (typeof window === "undefined") {
    return { ok: true, changed: false, reason: "ssr" };
  }
  try {
    const [clientsRes, loansRes] = await Promise.all([
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/loans", { cache: "no-store" }),
    ]);
    const clientsBody = (await clientsRes.json()) as {
      ok?: boolean;
      clients?: ClientMirrorRow[];
      skipped?: boolean;
      error?: string;
    };
    const loansBody = (await loansRes.json()) as {
      ok?: boolean;
      loans?: LoanMirrorRow[];
      skipped?: boolean;
      error?: string;
    };

    if (!clientsRes.ok || !clientsBody.ok) {
      return { ok: false, changed: false, reason: clientsBody.error || "clients_pull_failed" };
    }

    let changed = false;
    let loansOk = true;
    let loansReason: string | undefined;

    if (!clientsBody.skipped) {
      const remote = (clientsBody.clients ?? [])
        .map(mirrorToClientRow)
        .filter((row): row is ClientRow => Boolean(row));
      const local = readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []);
      const pendingClients = readDemoJson<ClientRow[]>(DEMO_CLIENT_MIRROR_QUEUE_KEY, []).filter(
        (row) => row?.ref,
      );
      const pendingByRef = new Map(pendingClients.map((row) => [row.ref, row]));
      // Cola pendiente gana: pull no rebobina altas/edits frescos del padre.
      const merge = mergeByRefPreferPendingLocal(local, remote, pendingByRef, clientSignature);
      if (merge.changed || (local.length === 0 && remote.length > 0)) {
        writeDemoJson(DEMO_CLIENTS_KEY, merge.merged.length ? merge.merged : remote);
        changed = true;
      }
    }

    if (!loansRes.ok || !loansBody.ok) {
      loansOk = false;
      loansReason = loansBody.error || "loans_pull_failed";
    } else if (!loansBody.skipped) {
      const remote = (loansBody.loans ?? [])
        .map(mirrorToLoanRow)
        .filter((row): row is LoanRow => Boolean(row));
      const local = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
      const pendingLoans = readDemoJson<LoanRow[]>(DEMO_LOAN_MIRROR_QUEUE_KEY, []).filter(
        (row) => row?.ref,
      );
      const pendingByRef = new Map(pendingLoans.map((row) => [row.ref, row]));
      const merge = mergeByRefPreferPendingLocal(local, remote, pendingByRef, loanSignature);
      if (merge.changed) {
        writeDemoJson(DEMO_LOANS_KEY, merge.merged);
        changed = true;
      }
    }

    if (clientsBody.skipped && (!loansOk || loansBody.skipped)) {
      return { ok: loansOk, changed: false, reason: loansReason || "skipped" };
    }

    return {
      ok: true,
      changed,
      reason: loansOk ? undefined : loansReason,
    };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      reason: err instanceof Error ? err.message : "catalog_pull_failed",
    };
  }
}
