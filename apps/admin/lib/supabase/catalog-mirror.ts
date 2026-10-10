/**
 * C5: clientes y préstamos compartidos (Postgres raíz; local = caché + cola offline).
 * @see docs/demo-to-backend.md
 */
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { fetchAllRows, fetchRowsChangedSince } from "@/lib/supabase/changed-since";
import { createIncrementalPull, withSinceParam } from "@/lib/incremental-pull";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { type ClientRow, type LoanRow, type PaymentRow, type StatusKind } from "@/lib/mock-data";
import {
  isLoanRejection,
  isPendingLoanRef,
  LOAN_REF_RENAMED_EVENT,
  loanRejectionMessage,
  mergeLoanCommands,
  type LoanCommand,
} from "@/lib/loan-command";
import { reportLoanRejection } from "@/lib/loan-rejections";
import { BIG_DEMO_STORE_CHANGED_EVENT } from "@/lib/big-demo-store";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { displayToIso } from "@/lib/loan-preview";
import { loanDisbursementIsoDate } from "@/lib/nequi-pool";
import {
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  buildDayExpenseDraft,
  cashLineIsLoanOf,
  type CollectorDayExpenseDraft,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import { businessTodayIso } from "@/lib/business-timezone";
import { forgetDeletedId, isDeletedRef, readDeletedIdSet, rememberDeletedId } from "@/lib/deleted-ids";
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
  /** Sin valor la nube pone la hora del alta (`default now()`). */
  created_at?: string;
  /** Solo de la nube: sube con cada cambio de términos (`update_loan_terms`). */
  terms_version?: number;
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
    start_date: loanDisbursementIsoDate(row) || displayToIso(row.date) || row.date || "",
    due_date: displayToIso(row.due) || row.due || "",
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
    ...(row.createdAt ? { created_at: row.createdAt } : {}),
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
    date: loanDisbursementIsoDate({ date: row.start_date, start_date: row.start_date }) || row.start_date || "",
    due: displayToIso(row.due_date) || row.due_date || "",
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
    createdAt: row.created_at || undefined,
    termsVersion: Number(row.terms_version) || 0,
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
 *    `cloudOwns`: el dato lo calcula la base (préstamos) → siempre remoto. El reloj del aparato
 *    no decide: una ficha vieja con hora local nueva rebobinaba saldos y revivía préstamos pagados.
 */
function mergeByRefPreferPendingLocal<T extends { ref: string; updatedAt?: string }>(
  local: T[],
  remote: T[],
  pendingByRef: Map<string, T>,
  signature: (row: T) => string,
  options?: { cloudOwns?: boolean },
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
    const winner = options?.cloudOwns || localTs < remoteTs ? remoteRow : localRow;
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
    Number(row.termsVersion) || 0,
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

export type LoanRefRenameState = {
  loans: LoanRow[];
  loanQueue: LoanRow[];
  assignments: DailyCollectionAssignment[];
  drafts: CollectorDayExpenseDraft[];
};

export type LoanRefRenameResult = LoanRefRenameState & {
  /** `to` ya era una ficha de este cliente: la copia se une, no se renombra. */
  twin: boolean;
  changedAssignments: DailyCollectionAssignment[];
  changedDrafts: CollectorDayExpenseDraft[];
};

/**
 * La nube le dio otro P- a una ficha de este aparato (choque con otro cliente) o la unió a la
 * misma ficha ya subida (reintento). Todo lo de ESE cliente con el P- viejo sigue al nuevo:
 * ficha, cola, visitas y renglón de caja. Lo del otro cliente con el mismo P- no se toca.
 */
export function renameLoanRefInState(
  state: LoanRefRenameState,
  loan: Pick<LoanRow, "ref" | "clientRef" | "client">,
  to: string,
  todayIso: string,
): LoanRefRenameResult {
  const from = loan.ref;
  const unchanged = { ...state, twin: false, changedAssignments: [], changedDrafts: [] };
  if (!from || !to || from === to) return unchanged;
  const mine = (row: Pick<LoanRow, "ref" | "clientRef">) =>
    row.ref === from && (!loan.clientRef || !row.clientRef || row.clientRef === loan.clientRef);
  const twin = state.loans.some(
    (row) => row.ref === to && (!loan.clientRef || row.clientRef === loan.clientRef),
  );
  const now = new Date().toISOString();
  const moveLoans = (rows: LoanRow[]) =>
    twin
      ? rows.filter((row) => !mine(row))
      : rows.map((row) => (mine(row) ? { ...row, ref: to, updatedAt: now } : row));

  const changedAssignments: DailyCollectionAssignment[] = [];
  const assignments: DailyCollectionAssignment[] = [];
  for (const row of state.assignments) {
    const ofLoan =
      row.loanRef === from && (!loan.clientRef || !row.clientRef || row.clientRef === loan.clientRef);
    if (!ofLoan) {
      assignments.push(row);
      continue;
    }
    const open = !row.paymentRef && !row.dayClosedAt;
    if (twin && open) continue;
    const next = { ...row, loanRef: to };
    assignments.push(next);
    changedAssignments.push(next);
  }

  const changedDrafts: CollectorDayExpenseDraft[] = [];
  const drafts = state.drafts.map((draft) => {
    const hasTo = draft.expenses.some((line) => cashLineIsLoanOf(line, to, loan.client));
    let touched = false;
    const expenses: RouteExpenseLine[] = [];
    for (const line of draft.expenses) {
      if (!cashLineIsLoanOf(line, from, loan.client)) {
        expenses.push(line);
        continue;
      }
      touched = true;
      if (twin && hasTo && draft.date === todayIso) continue;
      expenses.push({ ...line, loanRef: to, label: line.label.replace(` · ${from} · `, ` · ${to} · `) });
    }
    if (!touched) return draft;
    const next = buildDayExpenseDraft({ ...draft, expenses });
    changedDrafts.push(next);
    return next;
  });

  return {
    loans: moveLoans(state.loans),
    loanQueue: moveLoans(state.loanQueue),
    assignments,
    drafts,
    twin,
    changedAssignments,
    changedDrafts,
  };
}

function applyLoanRefRename(loan: Pick<LoanRow, "ref" | "clientRef" | "client">, to: string) {
  if (!loan.ref || !to || loan.ref === to) return;
  const state: LoanRefRenameState = {
    loans: readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []),
    loanQueue: readDemoJson<LoanRow[]>(DEMO_LOAN_MIRROR_QUEUE_KEY, []),
    assignments: readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []),
    drafts: readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
  };
  const renamed = renameLoanRefInState(state, loan, to, businessTodayIso());
  const next = {
    ...renamed,
    loans: renamed.loans.map((row) => withRenewalPointer(row, loan.ref, to)),
    // Lo que se encoló mientras subía el alta ya tiene P- de la nube: es una modificación.
    loanQueue: renamed.loanQueue.map((row) =>
      row.ref === to && (row.loanCommand?.op === "create" || row.loanCommand?.op === "renew")
        ? { ...row, loanCommand: { op: "update" as const, termsVersion: 0 } }
        : withRenewalPointer(row, loan.ref, to),
    ),
  };
  if (next.loans.some((row, i) => row !== state.loans[i]) || next.loans.length !== state.loans.length) {
    writeDemoJson(DEMO_LOANS_KEY, next.loans);
  }
  if (next.loanQueue.length !== state.loanQueue.length || next.loanQueue.some((row, i) => row !== state.loanQueue[i])) {
    writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, next.loanQueue);
  }
  if (next.assignments.length !== state.assignments.length || next.changedAssignments.length) {
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, next.assignments);
  }
  if (next.changedDrafts.length) writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, next.drafts);
  if (next.changedAssignments.length || next.changedDrafts.length) {
    void import("@/lib/supabase/ops-mirror").then(({ queueAssignmentsMirror, queueDayExpenseMirror }) => {
      queueAssignmentsMirror(next.changedAssignments);
      for (const draft of next.changedDrafts) queueDayExpenseMirror(draft);
    });
  }
  renamePaymentsLoanRef(loan, to);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));
    window.dispatchEvent(new CustomEvent(LOAN_REF_RENAMED_EVENT, { detail: { from: loan.ref, to } }));
  }
}

/**
 * Las marcas de renovación («Cerrado por renovación → P-pend-…», «Renovación de P-pend-…»)
 * y la orden de renovar de un préstamo pendiente apuntan al P- que dio la nube.
 */
function withRenewalPointer(row: LoanRow, from: string, to: string): LoanRow {
  const notes = row.notes || "";
  const renewedFrom = `Renovación de ${from}`;
  const nextNotes = notes
    .split(`→ ${from}`)
    .join(`→ ${to}`)
    .replace(new RegExp(`^${renewedFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\S)`), `Renovación de ${to}`);
  const command = row.loanCommand;
  const renewsFrom = command?.op === "renew" && command.oldRef === from;
  if (nextNotes === notes && !renewsFrom) return row;
  return {
    ...row,
    notes: nextNotes,
    ...(renewsFrom ? { loanCommand: { ...command, oldRef: to } } : {}),
  };
}

/** Literal a propósito (como `mirror-queue`): importar `payment-mirror` aquí cierra un ciclo. */
const PAYMENT_MIRROR_QUEUE_KEY = "nexo-demo-payment-mirror-queue";

/** Cobros de este aparato (y su cola) hechos sobre el número pendiente siguen al P- de la nube. */
function renamePaymentsLoanRef(loan: Pick<LoanRow, "ref" | "client">, to: string) {
  const mine = (row: PaymentRow) => row.loanRef === loan.ref && (!loan.client || row.client === loan.client);
  for (const key of [DEMO_PAYMENTS_KEY, PAYMENT_MIRROR_QUEUE_KEY]) {
    const rows = readDemoJson<PaymentRow[]>(key, []);
    if (!rows.some(mine)) continue;
    writeDemoJson(key, rows.map((row) => (mine(row) ? { ...row, loanRef: to } : row)));
  }
}

/**
 * Fichas que contestó la nube: entran tal cual (P-, términos, versión, saldo de la base),
 * salvo las que tienen otra orden de este aparato en cola (no se rebobina lo que aún sube).
 */
function adoptCloudLoans(rows: (LoanMirrorRow | undefined)[]) {
  const queued = new Set(readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).map((row) => row.ref));
  const incoming = rows
    .map((row) => (row ? mirrorToLoanRow(row) : null))
    .filter((row): row is LoanRow => row !== null && !queued.has(row.ref));
  if (!incoming.length) return;
  const byRef = new Map(incoming.map((row) => [row.ref, row]));
  const local = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
  const seen = new Set<string>();
  const next = local.map((row) => {
    const cloud = byRef.get(row.ref);
    if (!cloud) return row;
    seen.add(row.ref);
    return cloud;
  });
  for (const row of incoming) if (!seen.has(row.ref)) next.unshift(row);
  writeDemoJson(DEMO_LOANS_KEY, next);
}

/** Alta / renovación que la nube no aceptó: el número pendiente no existe; sale del aparato. */
function dropRejectedPendingLoan(loan: LoanRow) {
  if (!isPendingLoanRef(loan.ref)) return;
  rememberDeletedId(loan.ref);
  const local = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
  writeDemoJson(DEMO_LOANS_KEY, local.filter((row) => row.ref !== loan.ref));
}

/**
 * Una modificación de este aparato encolada mientras subía otra orden del mismo préstamo
 * parte de la versión que la nube acaba de dar (es la continuación, no un choque).
 */
function rebaseQueuedUpdate(cloud: LoanMirrorRow) {
  const version = Number(cloud.terms_version);
  if (!cloud.ref || !Number.isFinite(version)) return;
  const queue = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY);
  let changed = false;
  const next = queue.map((row) => {
    const command = row.loanCommand;
    if (row.ref !== cloud.ref || command?.op !== "update" || command.termsVersion === version) return row;
    changed = true;
    return { ...row, loanCommand: { op: "update" as const, termsVersion: version } };
  });
  if (changed) writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, next);
}

/** Respuesta de la nube a una orden de préstamo → aparato (renombrar, adoptar, avisar). */
function settleLoanMirrorReply(loan: LoanRow, json: LoanMirrorReply) {
  const op = loan.loanCommand?.op;
  if (json.ok && !json.skipped) {
    if (json.rekeyed && json.ref && json.ref !== loan.ref) applyLoanRefRename(loan, json.ref);
    if (op && op !== "alerts") {
      adoptCloudLoans([json.closed, json.loan]);
      if (json.loan) rebaseQueuedUpdate(json.loan);
    }
  } else if (json.ok && json.skipped && isLoanRejection(json.reason)) {
    adoptCloudLoans([json.loan]);
    dropRejectedPendingLoan(loan);
    reportLoanRejection({ ref: loan.ref, client: loan.client, reason: String(json.reason), cloudRef: json.ref });
  } else {
    return;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));
}

type MirrorDbClient = NonNullable<ReturnType<typeof createMirrorClient>>;

/** Respuesta de las funciones de préstamo en la base (`create_loan`, `renew_loan`, …). */
type LoanRpcResult = {
  ok?: boolean;
  error?: string;
  retry?: boolean;
  ref?: string;
  loan?: LoanMirrorRow;
  closed?: LoanMirrorRow;
  created?: LoanMirrorRow;
};

export type LoanMirrorResult =
  | { ok: true; ref: string; rekeyed: boolean; loan?: LoanMirrorRow; closed?: LoanMirrorRow }
  | { ok: true; skipped: true; reason: string; ref?: string; loan?: LoanMirrorRow }
  | { ok: false; error: string };

/**
 * Aparato con la versión anterior (sube la ficha sin orden): la orden sale de la ficha una
 * sola vez. Si la nube no la tiene es un alta (clave fija: el reintento no duplica); si la
 * tiene, solo entran sus alertas. Una baja sin el botón Borrar no pasa.
 */
async function legacyLoanCommand(
  supabase: MirrorDbClient,
  loan: LoanRow,
  row: LoanMirrorRow,
): Promise<{ ok: true; command: LoanCommand } | { ok: true; skip: string } | { ok: false; error: string }> {
  if (isLoanDeletedStatus(row)) {
    return loan.deleteIntent === "owner"
      ? { ok: true, command: { op: "delete", by: "aparato (versión anterior)" } }
      : { ok: true, skip: "loan_delete_not_owner" };
  }
  const { data, error } = await supabase.from("loans").select("client_ref").eq("ref", row.ref).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (data && String(data.client_ref || "").trim() === row.client_ref) {
    return { ok: true, command: { op: "alerts" } };
  }
  return {
    ok: true,
    command: { op: "create", key: `legacy:${row.client_ref}:${row.ref}:${row.created_at || row.start_date}` },
  };
}

async function loanRefForPendingDelete(
  supabase: MirrorDbClient,
  ref: string,
  key: string | undefined,
): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
  if (!isPendingLoanRef(ref)) return { ok: true, ref };
  if (!key) return { ok: true, ref: null };
  const { data, error } = await supabase.from("loans").select("ref").eq("idempotency_key", key).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, ref: data ? String(data.ref) : null };
}

async function runLoanCommand(
  supabase: MirrorDbClient,
  command: LoanCommand,
  row: LoanMirrorRow,
): Promise<{ ok: true; data: LoanRpcResult } | { ok: true; skip: string } | { ok: false; error: string }> {
  const call = async (fn: string, params: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn, params);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, data: (data ?? {}) as LoanRpcResult };
  };
  switch (command.op) {
    case "create":
      return call("create_loan", { p_idempotency_key: command.key, p_loan: row });
    case "update":
      return call("update_loan_terms", { p_ref: row.ref, p_terms_version: command.termsVersion, p_terms: row });
    case "renew":
      return call("renew_loan", { p_old_ref: command.oldRef, p_idempotency_key: command.key, p_new: row });
    case "delete": {
      const target = await loanRefForPendingDelete(supabase, row.ref, command.key);
      if (!target.ok) return target;
      if (!target.ref) return { ok: true, skip: "loan_never_created" };
      return call("delete_loan", { p_ref: target.ref, p_by: command.by });
    }
    case "alerts": {
      const res = await call("set_loan_alerts", {
        p_ref: row.ref,
        p_status: row.status,
        p_kind: row.kind,
        p_collection_alerts: row.collection_alerts,
      });
      // La base cierra y borra sola; una alerta de un préstamo que ya no está activo no aplica.
      if (res.ok && !res.data.ok) return { ok: true, skip: "loan_alerts_not_applied" };
      return res;
    }
  }
}

/**
 * Préstamo → nube. El aparato no escribe la ficha: manda la orden y la base la hace
 * de forma atómica (P- propio, un préstamo activo por cliente, saldo desde los PG-).
 */
export async function mirrorLoanToSupabase(loan: LoanRow): Promise<LoanMirrorResult> {
  const row = loanRowToMirror(loan);
  if (!row) return { ok: true, skipped: true, reason: "invalid_loan" };
  const supabase = createMirrorClient();
  if (!supabase) return { ok: true, skipped: true, reason: mirrorSkipReason() };

  let command = loan.loanCommand;
  if (!command) {
    const legacy = await legacyLoanCommand(supabase, loan, row);
    if (!legacy.ok) return legacy;
    if ("skip" in legacy) return { ok: true, skipped: true, reason: legacy.skip };
    command = legacy.command;
  }

  const result = await runLoanCommand(supabase, command, row);
  if (!result.ok) return result;
  if ("skip" in result) return { ok: true, skipped: true, reason: result.skip };
  const data = result.data;
  if (!data.ok) {
    const reason = String(data.error || "loan_rpc_failed");
    if (data.retry) return { ok: false, error: reason };
    if (command.op === "delete" && reason === "prestamo_inexistente") {
      return { ok: true, skipped: true, reason: "loan_never_created" };
    }
    return { ok: true, skipped: true, reason, ref: data.ref, loan: data.loan };
  }
  const ref = String(data.ref || row.ref);
  return {
    ok: true,
    ref,
    rekeyed: ref !== row.ref,
    loan: data.created ?? data.loan,
    closed: data.closed,
  };
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
    ref?: string;
    rekeyed?: boolean;
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

type LoanMirrorReply = MirrorApiJson & { loan?: LoanMirrorRow; closed?: LoanMirrorRow };

export type PersistLoanResult =
  | { ok: true; ref: string; rejected?: false }
  | { ok: true; ref: string; rejected: true; message: string }
  | { ok: false; error: string };

/** Sube una orden de préstamo. Sale de la cola solo si la nube la resolvió (hecha o rechazada). */
async function persistLoanToSupabase(loan: LoanRow): Promise<PersistLoanResult> {
  if (typeof window === "undefined") return { ok: false, error: "ssr" };
  try {
    const { res, json } = await postMirror("/api/loans/mirror", { loan });
    const reply = json as LoanMirrorReply;
    if (!res.ok || !shouldDropFromMirrorQueue(reply)) {
      keepQueued(DEMO_LOAN_MIRROR_QUEUE_KEY, loan);
      return { ok: false, error: reply.error || reply.reason || `http_${res.status}` };
    }
    dequeueSent(DEMO_LOAN_MIRROR_QUEUE_KEY, [loan]);
    settleLoanMirrorReply(loan, reply);
    if (reply.skipped && isLoanRejection(reply.reason)) {
      return {
        ok: true,
        ref: loan.ref,
        rejected: true,
        message: loanRejectionMessage(String(reply.reason), loan.client, reply.ref),
      };
    }
    return { ok: true, ref: reply.ref || loan.ref };
  } catch (err) {
    keepQueued(DEMO_LOAN_MIRROR_QUEUE_KEY, loan);
    return { ok: false, error: err instanceof Error ? err.message : "network" };
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

/** Ficha de la baja (botón Borrar): la orden `delete` lleva quién la pidió. */
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

/**
 * Préstamo reactivado en la nube (por pedido del dueño): la baja aprendida aquí se suelta.
 * El servidor nunca revive una baja por el espejo (`loan_deleted`), así que una ficha viva
 * en la nube con tombstone local solo es una reactivación. Una baja propia aún en cola manda.
 */
function forgetRemoteLoanRevivals(remote: LoanRow[]) {
  const known = readDeletedIdSet();
  if (!known.size) return false;
  const pendingDeletes = new Set(
    readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY)
      .filter((row) => isLoanDeletedStatus(row))
      .map((row) => row.ref),
  );
  let revived = false;
  for (const row of remote) {
    if (isLoanDeletedStatus(row) || !known.has(row.ref) || pendingDeletes.has(row.ref)) continue;
    forgetDeletedId(row.ref);
    revived = true;
  }
  return revived;
}

/**
 * Encola la orden del préstamo y la sube ya. Si ya había una orden del mismo préstamo en
 * cola, se unen (`mergeLoanCommands`): un alta pendiente sigue siendo alta con lo más nuevo.
 */
export function queueLoanCommand(loan: LoanRow, command: LoanCommand): Promise<PersistLoanResult> {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, error: "ssr" });
  const queue = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY);
  const prev = queue.find((row) => row.ref === loan.ref)?.loanCommand;
  const row: LoanRow = { ...loan, loanCommand: mergeLoanCommands(prev, command) };
  writeQueue(DEMO_LOAN_MIRROR_QUEUE_KEY, [...queue.filter((entry) => entry.ref !== loan.ref), row]);
  return sendQueuedLoan(loan.ref);
}

const loanSends = new Map<string, Promise<PersistLoanResult>>();

/**
 * Una orden por préstamo en vuelo: la siguiente espera y sube lo que quede en cola.
 * Dos envíos de la misma modificación chocarían con su propia versión.
 */
function sendQueuedLoan(ref: string): Promise<PersistLoanResult> {
  const before = loanSends.get(ref);
  const run = (async (): Promise<PersistLoanResult> => {
    const last = before ? await before : null;
    const row = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).find((entry) => entry.ref === ref);
    if (!row) return last ?? { ok: true, ref };
    return persistLoanToSupabase(row);
  })();
  loanSends.set(ref, run);
  void run.finally(() => {
    if (loanSends.get(ref) === run) loanSends.delete(ref);
  });
  return run;
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

  for (const loan of readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY)) {
    await sendQueuedLoan(loan.ref);
  }
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

/** Lista completa al abrir, cada 60 min, al reparar y en la puesta a punto; entre medio solo lo cambiado. */
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

/**
 * Lista completa de la nube: un préstamo que la nube no tiene y que este aparato no está
 * subiendo no existe (P-426 / P-433 de Albornoz armaban alertas). Queda como baja local;
 * si la nube lo tiene vivo después, `forgetRemoteLoanRevivals` lo devuelve.
 */
function dropLoansMissingFromCloud(
  merged: LoanRow[],
  remoteRefs: ReadonlySet<string>,
  pendingRefs: ReadonlySet<string>,
): { loans: LoanRow[]; dropped: string[] } {
  const dropped: string[] = [];
  const loans = merged.filter((row) => {
    if (remoteRefs.has(row.ref) || pendingRefs.has(row.ref)) return true;
    dropped.push(row.ref);
    return false;
  });
  for (const ref of dropped) rememberDeletedId(ref);
  return { loans, dropped };
}

/** `cursor` solo si clientes y préstamos entraron enteros al aparato. */
async function mergeRemoteCatalog(
  since: string | null,
): Promise<PullCatalogResult & { cursor?: string | null }> {
  try {
    // Lo que estaba subiendo al pedir la lista: si sube en medio, la lista puede no traerlo aún.
    const loansQueuedAtStart = readQueue<LoanRow>(DEMO_LOAN_MIRROR_QUEUE_KEY).map((row) => row.ref);
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
      const revived = forgetRemoteLoanRevivals(remoteAll);
      const learnedDeletes = learnRemoteLoanDeletes(remoteAll) || revived;
      const remote = remoteAll.filter((row) => !isLoanDeletedStatus(row));
      const local = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
      const pendingLoans = readDemoJson<LoanRow[]>(DEMO_LOAN_MIRROR_QUEUE_KEY, []).filter(
        (row) => row?.ref && !isLoanDeletedStatus(row),
      );
      const pendingByRef = new Map(pendingLoans.map((row) => [row.ref, row]));
      // Lo que subía al pedir la lista: la respuesta de ese envío ya está en el aparato y es más
      // nueva que la lista.
      for (const ref of loansQueuedAtStart) {
        const row = local.find((entry) => entry.ref === ref);
        if (row && !pendingByRef.has(ref)) pendingByRef.set(ref, row);
      }
      const merge = mergeByRefPreferPendingLocal(local, remote, pendingByRef, loanSignature, {
        cloudOwns: true,
      });
      const settled = loansBody.incremental
        ? { loans: merge.merged, dropped: [] as string[] }
        : dropLoansMissingFromCloud(
            merge.merged,
            new Set(remoteAll.map((row) => row.ref)),
            new Set([...pendingByRef.keys(), ...loansQueuedAtStart]),
          );
      if (merge.changed || learnedDeletes || settled.dropped.length) {
        if (!writeDemoJson(DEMO_LOANS_KEY, settled.loans)) unsaved.push("préstamos");
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
