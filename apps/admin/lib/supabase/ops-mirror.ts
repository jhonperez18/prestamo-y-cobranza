/**
 * C6: sync operativo completo (cobradores, rutas, CIE, gastos, PV-, planilla).
 * Banco/logs siguen siendo proyección de PG- en la app.
 * @see docs/supabase-schema.md
 */
import { createMirrorServerClient } from "@/lib/supabase/admin";
import type { CollectorRow, PaymentRow, RouteRow, UserRow } from "@/lib/mock-data";
import { reconcilePaymentsOntoPlanilla } from "@/lib/planilla-payment-reconcile";
import {
  applyDayCloseRecordsToAssignments,
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { DAY_CLOSE_SKIP_REASON } from "@/lib/collector-dispatch-sync";
import type { MiscPayment } from "@/lib/misc-payments";
import {
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_USERS_KEY,
  isVirginRemoteHoldActive,
  listDeletedRouteRefs,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";

function createMirrorClient() {
  return createMirrorServerClient();
}

function mergeByRefRemote<T extends { ref: string }>(
  local: T[],
  remote: T[],
  sig: (row: T) => string,
): { merged: T[]; changed: boolean } {
  const map = new Map<string, T>();
  for (const row of local) if (row?.ref) map.set(row.ref, row);
  let changed = false;
  for (const row of remote) {
    if (!row?.ref) continue;
    const prev = map.get(row.ref);
    if (!prev) {
      map.set(row.ref, row);
      changed = true;
      continue;
    }
    if (sig(prev) !== sig(row)) changed = true;
    map.set(row.ref, row);
  }
  return { merged: [...map.values()], changed };
}

/** Remoto manda: dropea locales que no están en remoto (salvo cola pendiente). */
function mergeRemoteAuthority<T extends { ref: string }>(
  local: T[],
  remote: T[],
  pendingRefs: Set<string>,
  sig: (row: T) => string,
  pendingRows?: T[],
  pendingDeleteRefs?: Set<string>,
): { merged: T[]; changed: boolean } {
  const deletes = pendingDeleteRefs ?? new Set<string>();
  const pendingByRef = new Map(
    (pendingRows ?? local.filter((row) => row?.ref && pendingRefs.has(row.ref)))
      .filter((row) => row?.ref && !deletes.has(row.ref))
      .map((row) => [row.ref, row]),
  );

  // Nube vacía = verdad: solo quedan upserts pendientes (nada de seed local viejo).
  if (remote.length === 0) {
    const merged = [...pendingByRef.values()];
    const localSig = local
      .map((r) => r.ref)
      .sort()
      .join("|");
    const nextSig = merged
      .map((r) => r.ref)
      .sort()
      .join("|");
    return { merged, changed: localSig !== nextSig };
  }

  const merged: T[] = [];
  let changed = false;
  const localByRef = new Map(local.filter((row) => row?.ref).map((row) => [row.ref, row]));
  const seen = new Set<string>();

  for (const remoteRow of remote) {
    if (!remoteRow?.ref) continue;
    if (deletes.has(remoteRow.ref)) {
      changed = true;
      continue;
    }
    seen.add(remoteRow.ref);
    const pending = pendingByRef.get(remoteRow.ref);
    const chosen = pending ?? remoteRow;
    const localRow = localByRef.get(remoteRow.ref);
    if (!localRow) changed = true;
    else if (sig(localRow) !== sig(chosen)) changed = true;
    merged.push(chosen);
    localByRef.delete(remoteRow.ref);
  }
  for (const row of localByRef.values()) {
    if (deletes.has(row.ref)) {
      changed = true;
      continue;
    }
    if (pendingRefs.has(row.ref)) {
      merged.push(pendingByRef.get(row.ref) ?? row);
      continue;
    }
    changed = true;
  }
  for (const [ref, row] of pendingByRef) {
    if (seen.has(ref) || deletes.has(ref)) continue;
    if (merged.some((m) => m.ref === ref)) continue;
    merged.push(row);
    changed = true;
  }
  return { merged, changed };
}

async function postMirror(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
  const json = (await res.json()) as { ok?: boolean; error?: string };
  return { res, json };
}

function enqueue<T extends { ref: string }>(key: string, row: T) {
  const q = readDemoJson<T[]>(key, []).filter((r) => r.ref !== row.ref);
  q.push(row);
  writeDemoJson(key, q);
}

function dequeue(key: string, ref: string) {
  writeDemoJson(
    key,
    readDemoJson<{ ref: string }[]>(key, []).filter((r) => r.ref !== ref),
  );
}

/**
 * Cola de planilla abierta no debe sobrevivir a un cierre ya montado en este PC
 * (CIE- o dayClosedAt). Sin esto, al actualizar el código el flush reabre la hoja
 * del amigo en la nube.
 */
function pruneOpenAssignmentQueueAgainstLocalCloses() {
  if (typeof window === "undefined") return;
  const queued = readDemoJson<
    { ref: string; dayClosedAt?: string; collectorRef?: string; dispatchDate?: string }[]
  >(Q_ASSIGN, []);
  if (!queued.length) return;
  const localByKey = new Map<string, DailyCollectionAssignment>(
    readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []).map((row) => {
      const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
      return [`${date}::${row.itemId}`, row];
    }),
  );
  const closedCollectorDays = new Set<string>(
    readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []).map((row) => {
      const date = normalizeHistoryDate(row.date) || row.date;
      return `${row.collectorRef}::${date}`;
    }),
  );
  const kept = queued.filter((row) => {
    if (row.dayClosedAt) return true;
    const live = localByKey.get(row.ref);
    if (live?.dayClosedAt) return false;
    const date =
      normalizeHistoryDate(String(row.dispatchDate || live?.dispatchDate || "")) ||
      String(row.dispatchDate || live?.dispatchDate || "");
    const collector = String(row.collectorRef || live?.collectorRef || "").trim();
    if (collector && date && closedCollectorDays.has(`${collector}::${date}`)) return false;
    return true;
  });
  if (kept.length !== queued.length) writeDemoJson(Q_ASSIGN, kept);
}

const Q_COLLECTORS = "nexo-demo-ops-collectors-queue";
const Q_COLLECTOR_DELETES = "nexo-demo-ops-collector-deletes-queue";
const Q_ROUTES = "nexo-demo-ops-routes-queue";
const Q_ROUTE_DELETES = "nexo-demo-ops-route-deletes-queue";
const Q_CLOSES = "nexo-demo-ops-day-closes-queue";
const Q_EXPENSES = "nexo-demo-ops-day-expenses-queue";
const Q_MISC = "nexo-demo-ops-misc-queue";
const Q_ASSIGN = "nexo-demo-ops-assignments-queue";

// —— mappers ——

export function collectorToRow(c: CollectorRow) {
  return {
    ref: c.ref,
    name: c.name || "",
    zone: c.zone || "",
    phone: c.phone || "",
    document: c.document ?? null,
    notes: c.notes ?? null,
    active: Boolean(c.active),
    user_ref: c.userRef ?? null,
    login: c.login ?? null,
    mobile_access: Boolean(c.mobileAccess),
    updated_at: new Date().toISOString(),
  };
}

export function rowToCollector(r: Record<string, unknown>): CollectorRow | null {
  const ref = String(r.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    name: String(r.name || ""),
    zone: String(r.zone || ""),
    phone: String(r.phone || ""),
    document: (r.document as string) || undefined,
    notes: (r.notes as string) || undefined,
    active: Boolean(r.active),
    userRef: (r.user_ref as string) || undefined,
    login: (r.login as string) || undefined,
    mobileAccess: Boolean(r.mobile_access ?? true),
  };
}

export function routeToRow(route: RouteRow) {
  return {
    ref: route.ref,
    slug: route.id || "",
    name: route.name || "",
    collector_ref: route.collectorRef || "",
    collector_name: route.collector || "",
    zone: route.zone || "",
    frequency: route.frequency || "",
    notes: route.notes ?? null,
    stops: route.stops ?? [],
    clients_count: Number(route.clients) || 0,
    status: route.status || "Activa",
    kind: route.kind || "ok",
    scheduled_date: route.scheduledDate ?? null,
    updated_at: new Date().toISOString(),
  };
}

export function rowToRoute(r: Record<string, unknown>): RouteRow | null {
  const ref = String(r.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    id: String(r.slug || ""),
    name: String(r.name || ""),
    collectorRef: String(r.collector_ref || ""),
    collector: String(r.collector_name || ""),
    zone: String(r.zone || ""),
    frequency: String(r.frequency || ""),
    notes: (r.notes as string) || undefined,
    stops: Array.isArray(r.stops) ? (r.stops as RouteRow["stops"]) : [],
    clients: Number(r.clients_count) || 0,
    status: String(r.status || "Activa"),
    kind: (r.kind as RouteRow["kind"]) || "ok",
    scheduledDate: (r.scheduled_date as string) || undefined,
  };
}

export function dayCloseToRow(c: CollectorDayCloseRecord) {
  const closeDate = normalizeHistoryDate(c.date) || c.date;
  return {
    ref: c.ref,
    collector_ref: c.collectorRef,
    collector_name: c.collectorName || "",
    close_date: closeDate,
    route_ref: c.routeRef || "",
    collected: Number(c.collected) || 0,
    expenses: c.expenses ?? [],
    expenses_total: Number(c.expensesTotal) || 0,
    cash_float: Number(c.cashFloat) || 0,
    closed_at: c.closedAt,
    movement_refs: c.movementRefs ?? [],
    updated_at: new Date().toISOString(),
  };
}

export function rowToDayClose(r: Record<string, unknown>): CollectorDayCloseRecord | null {
  const ref = String(r.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    collectorRef: String(r.collector_ref || ""),
    collectorName: String(r.collector_name || ""),
    date: String(r.close_date || ""),
    routeRef: String(r.route_ref || ""),
    collected: Number(r.collected) || 0,
    expenses: Array.isArray(r.expenses) ? (r.expenses as CollectorDayCloseRecord["expenses"]) : [],
    expensesTotal: Number(r.expenses_total) || 0,
    cashFloat: Number(r.cash_float) || 0,
    openingCash: r.opening_cash == null ? undefined : Number(r.opening_cash) || 0,
    cashExpected: r.cash_expected == null ? undefined : Number(r.cash_expected) || 0,
    cashDeclared: r.cash_declared == null ? undefined : Number(r.cash_declared) || 0,
    cashVariance: r.cash_variance == null ? undefined : Number(r.cash_variance) || 0,
    closedAt: String(r.closed_at || new Date().toISOString()),
    movementRefs: Array.isArray(r.movement_refs) ? (r.movement_refs as string[]) : [],
  };
}

export function dayExpenseToRow(d: CollectorDayExpenseDraft) {
  const expenseDate = normalizeHistoryDate(d.date) || d.date;
  return {
    ref: d.ref,
    collector_ref: d.collectorRef,
    collector_name: d.collectorName || "",
    expense_date: expenseDate,
    route_ref: d.routeRef || "",
    expenses: d.expenses ?? [],
    expenses_total: Number(d.expensesTotal) || 0,
    updated_at: d.updatedAt || new Date().toISOString(),
  };
}

export function rowToDayExpense(r: Record<string, unknown>): CollectorDayExpenseDraft | null {
  const ref = String(r.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    collectorRef: String(r.collector_ref || ""),
    collectorName: String(r.collector_name || ""),
    date: String(r.expense_date || ""),
    routeRef: String(r.route_ref || ""),
    expenses: Array.isArray(r.expenses) ? (r.expenses as CollectorDayExpenseDraft["expenses"]) : [],
    expensesTotal: Number(r.expenses_total) || 0,
    updatedAt: String(r.updated_at || new Date().toISOString()),
  };
}

export function miscToRow(m: MiscPayment) {
  return {
    ref: m.ref,
    paid_date: m.paidDate,
    label: m.label || "",
    amount: Number(m.amount) || 0,
    bank_account_ref: m.bankAccountRef || "",
    method: m.method || "efectivo",
    created_at_app: m.createdAt,
    updated_at: new Date().toISOString(),
  };
}

export function rowToMisc(r: Record<string, unknown>): MiscPayment | null {
  const ref = String(r.ref || "").trim();
  if (!ref) return null;
  return {
    ref,
    paidDate: String(r.paid_date || ""),
    label: String(r.label || ""),
    amount: Number(r.amount) || 0,
    bankAccountRef: String(r.bank_account_ref || ""),
    method: (r.method as MiscPayment["method"]) || "efectivo",
    createdAt: String(r.created_at_app || r.created_at || new Date().toISOString()),
  };
}

export function assignmentToRow(a: DailyCollectionAssignment) {
  const dispatchDate = normalizeHistoryDate(a.dispatchDate) || a.dispatchDate;
  return {
    item_id: a.itemId,
    dispatch_date: dispatchDate,
    loan_ref: a.loanRef || "",
    client_ref: a.clientRef || "",
    client_name: a.clientName || "",
    client_route: a.clientRoute || "",
    address: a.address ?? null,
    charge_date: a.chargeDate ?? null,
    amount_due: Number(a.amountDue) || 0,
    charge_label: a.chargeLabel || "",
    kind: a.kind || "cuota",
    collector_ref: a.collectorRef || "",
    collector_name: a.collector || "",
    assigned_at: a.assignedAt ?? null,
    dispatched: Boolean(a.dispatched),
    dispatched_at: a.dispatchedAt ?? null,
    visit_status: a.visitStatus ?? null,
    skip_reason: a.skipReason ?? null,
    day_closed_at: a.dayClosedAt ?? null,
    payment_ref: a.paymentRef ?? null,
    alert_count: a.alertCount ?? null,
    awaiting_loan: Boolean(a.awaitingLoan),
    updated_at: new Date().toISOString(),
  };
}

export function rowToAssignment(r: Record<string, unknown>): DailyCollectionAssignment | null {
  const itemId = String(r.item_id || "").trim();
  const dispatchDate = String(r.dispatch_date || "").trim();
  if (!itemId || !dispatchDate) return null;
  return {
    itemId,
    dispatchDate,
    loanRef: String(r.loan_ref || ""),
    clientRef: String(r.client_ref || ""),
    clientName: String(r.client_name || ""),
    clientRoute: String(r.client_route || ""),
    address: (r.address as string) || undefined,
    chargeDate: (r.charge_date as string) || undefined,
    amountDue: Number(r.amount_due) || 0,
    chargeLabel: String(r.charge_label || ""),
    kind: (r.kind as DailyCollectionAssignment["kind"]) || "cuota",
    collectorRef: String(r.collector_ref || ""),
    collector: String(r.collector_name || ""),
    assignedAt: String(r.assigned_at || ""),
    dispatched: Boolean(r.dispatched),
    dispatchedAt: (r.dispatched_at as string) || undefined,
    visitStatus: (r.visit_status as DailyCollectionAssignment["visitStatus"]) || undefined,
    skipReason: (r.skip_reason as string) || undefined,
    dayClosedAt: (r.day_closed_at as string) || undefined,
    paymentRef: (r.payment_ref as string) || undefined,
    alertCount: typeof r.alert_count === "number" ? r.alert_count : undefined,
    awaitingLoan: Boolean(r.awaiting_loan),
  };
}

// —— server upserts ——

/** Guarda el descuadre en el CIE. Si la función aún no está en Supabase, no tumba el cierre. */
export async function auditDayCloseInCloud(row: CollectorDayCloseRecord) {
  const client = createMirrorClient();
  if (!client || !row.ref) return { ok: true as const, skipped: true as const };
  const opening = Number(row.openingCash) || 0;
  const expenses = Number(row.expensesTotal) || 0;
  const expected = Number(row.cashExpected ?? row.cashFloat) || 0;
  const declared = Number(row.cashDeclared ?? row.cashFloat) || 0;
  const collections = expected - opening + expenses;
  const { error } = await client.rpc("verify_day_cash", {
    p_ref: row.ref,
    p_opening: opening,
    p_collections: collections,
    p_expenses: expenses,
    p_declared: declared,
  });
  if (!error) return { ok: true as const };
  const msg = error.message || "";
  if (/verify_day_cash|schema cache|PGRST202|Could not find|cash_variance|opening_cash/i.test(msg)) {
    return { ok: true as const, skipped: true as const };
  }
  return { ok: false as const, error: msg };
}

export async function upsertDayExpenseIdempotent(row: Record<string, unknown>) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const { data, error } = await client.rpc("register_day_expense", {
    p_ref: row.ref,
    p_collector_ref: row.collector_ref,
    p_collector_name: row.collector_name,
    p_expense_date: row.expense_date,
    p_route_ref: row.route_ref,
    p_expenses: row.expenses,
    p_expenses_total: row.expenses_total,
  });
  if (!error) {
    const body = data as { ok?: boolean; error?: string } | null;
    if (body && body.ok === false) return { ok: false as const, error: body.error || "register_day_expense" };
    return { ok: true as const };
  }
  const msg = error.message || "";
  if (!/register_day_expense|schema cache|PGRST202|Could not find the function/i.test(msg)) {
    return { ok: false as const, error: msg };
  }
  return upsertOpsRow("day_expenses", row, "ref");
}

/**
 * Espejo de planilla (servidor). Una fila «pendiente» sin PG- no pisa un N/P u omisión
 * del cobrador que ya está en la nube: ese estado solo lo cambia un cobro o el cierre
 * de jornada, y de vuelta a pendiente solo el reabrir un «Cierre de jornada».
 * Vale para cualquier aparato, aunque todavía corra código viejo.
 */
export async function upsertAssignmentRow(row: Record<string, unknown>) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const incomingStatus = String(row.visit_status ?? "pendiente");
  if (incomingStatus === "pendiente" && !row.payment_ref) {
    const { data, error } = await client
      .from("daily_assignments")
      .select("visit_status, skip_reason")
      .eq("dispatch_date", row.dispatch_date)
      .eq("item_id", row.item_id)
      .maybeSingle();
    const current = (data ?? null) as { visit_status?: string; skip_reason?: string | null } | null;
    if (
      !error &&
      current?.visit_status === "omitido" &&
      current.skip_reason !== DAY_CLOSE_SKIP_REASON
    ) {
      return { ok: true as const, kept: true as const };
    }
  }
  return upsertOpsRow("daily_assignments", row, "dispatch_date,item_id");
}

export async function upsertOpsRow(
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  const { error } = await client.from(table).upsert(row, { onConflict });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function fetchOpsTable(table: string) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, rows: [] as Record<string, unknown>[] };
  const { data, error } = await client.from(table).select("*").limit(8000);
  if (error) return { ok: false as const, error: error.message, rows: [] as Record<string, unknown>[] };
  return { ok: true as const, rows: (data ?? []) as Record<string, unknown>[] };
}

// —— browser queue + persist ——

async function persistKind(
  queueKey: string,
  pathBody: { kind: string; row: unknown },
  ref: string,
) {
  if (typeof window === "undefined") return false;
  // Cola primero: el pull no debe pisar una edición en vuelo.
  enqueue(queueKey, { ref, ...(pathBody.row as object) } as { ref: string });
  try {
    const { res, json } = await postMirror("/api/ops/mirror", pathBody);
    if (res.ok && json.ok) {
      dequeue(queueKey, ref);
      return true;
    }
  } catch {
    /* queda en cola */
  }
  return false;
}

export function queueCollectorMirror(c: CollectorRow) {
  void persistKind(Q_COLLECTORS, { kind: "collector", row: c }, c.ref);
}
export function queueCollectorsMirror(rows: CollectorRow[]) {
  for (const row of rows) queueCollectorMirror(row);
}

/** Borrado duro en Postgres (Eliminar usuario cobrador = desaparecer COB-). */
export function queueCollectorDeleteMirror(ref: string) {
  const clean = (ref || "").trim();
  if (!clean || typeof window === "undefined") return;
  writeDemoJson(
    Q_COLLECTORS,
    readDemoJson<{ ref: string }[]>(Q_COLLECTORS, []).filter((row) => row.ref !== clean),
  );
  const queued = readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, []);
  if (!queued.some((row) => row.ref === clean)) {
    writeDemoJson(Q_COLLECTOR_DELETES, [...queued, { ref: clean }]);
  }
  void (async () => {
    try {
      const { res, json } = await postMirror("/api/ops/mirror", {
        kind: "collector_delete",
        row: { ref: clean },
      });
      if (res.ok && json.ok) {
        writeDemoJson(
          Q_COLLECTOR_DELETES,
          readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, []).filter((row) => row.ref !== clean),
        );
      }
    } catch {
      /* cola */
    }
  })();
}
export function queueRouteMirror(r: RouteRow) {
  void persistKind(Q_ROUTES, { kind: "route", row: r }, r.ref);
}
export function queueRoutesMirror(rows: RouteRow[]) {
  for (const row of rows) queueRouteMirror(row);
}

/** Borrado duro en Postgres (Eliminar = desaparecer, no solo en este PC). */
export function queueRouteDeleteMirror(ref: string) {
  const clean = (ref || "").trim();
  if (!clean || typeof window === "undefined") return;
  void (async () => {
    try {
      const { res, json } = await postMirror("/api/ops/mirror", {
        kind: "route_delete",
        row: { ref: clean },
      });
      if (res.ok && json.ok) return;
    } catch {
      /* cola */
    }
    const queued = readDemoJson<{ ref: string }[]>(Q_ROUTE_DELETES, []);
    if (queued.some((row) => row.ref === clean)) return;
    writeDemoJson(Q_ROUTE_DELETES, [...queued, { ref: clean }]);
  })();
}

export function queueDayCloseMirror(c: CollectorDayCloseRecord) {
  void persistKind(Q_CLOSES, { kind: "day_close", row: c }, c.ref);
}
export function queueDayExpenseMirror(d: CollectorDayExpenseDraft) {
  void persistKind(Q_EXPENSES, { kind: "day_expense", row: d }, d.ref);
}
export function queueMiscPaymentMirror(m: MiscPayment) {
  void persistKind(Q_MISC, { kind: "misc_payment", row: m }, m.ref);
}
/** Firma operativa. Si no cambia, no se vuelve a subir la fila. */
function assignmentMirrorSig(a: DailyCollectionAssignment) {
  return [
    a.visitStatus || "",
    a.paymentRef || "",
    a.amountDue,
    a.dayClosedAt || "",
    a.skipReason || "",
    a.dispatched ? 1 : 0,
  ].join("|");
}

const sentAssignmentSig = new Map<string, string>();

export function queueAssignmentMirror(a: DailyCollectionAssignment) {
  const ref = `${a.dispatchDate}::${a.itemId}`;
  const sig = assignmentMirrorSig(a);
  if (sentAssignmentSig.get(ref) === sig) return;
  sentAssignmentSig.set(ref, sig);
  void persistKind(Q_ASSIGN, { kind: "assignment", row: a }, ref).then((ok) => {
    if (!ok) sentAssignmentSig.delete(ref);
  });
}

export function queueAssignmentsMirror(rows: DailyCollectionAssignment[]) {
  for (const row of rows) queueAssignmentMirror(row);
}

export async function flushOpsMirrorQueues() {
  if (typeof window === "undefined") return;

  pruneOpenAssignmentQueueAgainstLocalCloses();

  // Primero deletes (si no, un upsert viejo las revive).
  const routeDeletes = readDemoJson<{ ref: string }[]>(Q_ROUTE_DELETES, []);
  const routeDeletesLeft: { ref: string }[] = [];
  for (const row of routeDeletes) {
    try {
      const { res, json } = await postMirror("/api/ops/mirror", {
        kind: "route_delete",
        row: { ref: row.ref },
      });
      if (!(res.ok && json.ok)) routeDeletesLeft.push(row);
    } catch {
      routeDeletesLeft.push(row);
    }
  }
  writeDemoJson(Q_ROUTE_DELETES, routeDeletesLeft);

  const collectorDeletes = readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, []);
  const collectorDeletesLeft: { ref: string }[] = [];
  for (const row of collectorDeletes) {
    try {
      const { res, json } = await postMirror("/api/ops/mirror", {
        kind: "collector_delete",
        row: { ref: row.ref },
      });
      if (!(res.ok && json.ok)) collectorDeletesLeft.push(row);
    } catch {
      collectorDeletesLeft.push(row);
    }
  }
  writeDemoJson(Q_COLLECTOR_DELETES, collectorDeletesLeft);

  const deleted = new Set(listDeletedRouteRefs());
  const deletedCollectors = new Set(
    readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, []).map((row) => row.ref),
  );
  const jobs: Array<{ key: string; kind: string; rows: { ref: string }[] }> = [
    {
      key: Q_COLLECTORS,
      kind: "collector",
      rows: readDemoJson<{ ref: string }[]>(Q_COLLECTORS, []).filter(
        (row) => !deletedCollectors.has(row.ref),
      ),
    },
    {
      key: Q_ROUTES,
      kind: "route",
      rows: readDemoJson<{ ref: string }[]>(Q_ROUTES, []).filter((row) => !deleted.has(row.ref)),
    },
    { key: Q_CLOSES, kind: "day_close", rows: readDemoJson(Q_CLOSES, []) },
    { key: Q_EXPENSES, kind: "day_expense", rows: readDemoJson(Q_EXPENSES, []) },
    { key: Q_MISC, kind: "misc_payment", rows: readDemoJson(Q_MISC, []) },
    { key: Q_ASSIGN, kind: "assignment", rows: readDemoJson(Q_ASSIGN, []) },
  ];
  const localAssignByKey = new Map<string, DailyCollectionAssignment>(
    readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []).map((row) => {
      const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
      return [`${date}::${row.itemId}`, row];
    }),
  );
  for (const job of jobs) {
    const left: { ref: string }[] = [];
    for (const row of job.rows) {
      try {
        let payload: unknown = row;
        if (job.kind === "assignment") {
          const queued = row as { ref: string; dayClosedAt?: string };
          const live = localAssignByKey.get(queued.ref);
          // No subir hoja abierta si este aparato ya tiene el cierre (pull del amigo).
          if (live?.dayClosedAt) payload = live;
        }
        const { res, json } = await postMirror("/api/ops/mirror", {
          kind: job.kind,
          row: payload,
        });
        if (!(res.ok && json.ok)) left.push(row);
      } catch {
        left.push(row);
      }
    }
    writeDemoJson(job.key, left);
  }
}

export type PullOpsResult = { ok: boolean; changed: boolean; reason?: string };

/**
 * C6.1 — crítico: CIE / gastos / planilla / rutas que viven solo en un
 * navegador deben subir a Postgres. Sin esto el saldo de rutas diverge
 * entre PC y celular (mismo bug que los PG- huérfanos).
 */
export async function reconcileLocalOpsToRemote(): Promise<{
  pushed: number;
  failed: number;
}> {
  if (typeof window === "undefined") return { pushed: 0, failed: 0 };

  try {
    const res = await fetch("/api/ops/bundle", { cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      collectors?: { ref?: string }[];
      routes?: { ref?: string }[];
      day_closes?: { ref?: string }[];
      day_expenses?: { ref?: string }[];
      misc_payments?: { ref?: string }[];
      daily_assignments?: { dispatch_date?: string; item_id?: string }[];
    };
    if (!res.ok || !body.ok || body.skipped) return { pushed: 0, failed: 0 };

    const remoteCollector = new Set((body.collectors ?? []).map((r) => r.ref).filter(Boolean));
    const remoteRoute = new Set((body.routes ?? []).map((r) => r.ref).filter(Boolean));
    const remoteClose = new Set((body.day_closes ?? []).map((r) => r.ref).filter(Boolean));
    const remoteExpense = new Set((body.day_expenses ?? []).map((r) => r.ref).filter(Boolean));
    const remoteMisc = new Set((body.misc_payments ?? []).map((r) => r.ref).filter(Boolean));
    const remoteAssign = new Set(
      (body.daily_assignments ?? []).map((r) => {
        const date = normalizeHistoryDate(String(r.dispatch_date || "")) || String(r.dispatch_date || "");
        return `${date}::${r.item_id}`;
      }),
    );
    const deletedRoutes = new Set(listDeletedRouteRefs());
    const catalogUsers = readDemoJson<UserRow[]>(DEMO_USERS_KEY, []);
    const linkedCollectorRefs = new Set(
      catalogUsers.map((row) => row.collectorRef).filter(Boolean) as string[],
    );
    const pendingCollectorUpserts = new Set(
      readDemoJson<{ ref: string }[]>(Q_COLLECTORS, [])
        .map((row) => row.ref)
        .filter(Boolean),
    );
    const pendingCollectorDeletes = new Set(
      readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, [])
        .map((row) => row.ref)
        .filter(Boolean),
    );

    const jobs: Array<{ kind: string; row: unknown; key: string }> = [];

    for (const ref of pendingCollectorDeletes) {
      if (remoteCollector.has(ref)) {
        jobs.push({ kind: "collector_delete", row: { ref }, key: ref });
      }
    }

    for (const row of readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, [])) {
      if (!row?.ref || remoteCollector.has(row.ref)) continue;
      if (pendingCollectorDeletes.has(row.ref)) continue;
      // No subir cobradores fantasma (seed local / diego) que no están en el listado.
      if (!linkedCollectorRefs.has(row.ref) && !pendingCollectorUpserts.has(row.ref)) continue;
      jobs.push({ kind: "collector", row, key: row.ref });
    }
    for (const row of readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, [])) {
      if (!row?.ref || deletedRoutes.has(row.ref)) continue;
      if (!remoteRoute.has(row.ref)) {
        jobs.push({ kind: "route", row, key: row.ref });
      }
    }
    for (const ref of deletedRoutes) {
      if (remoteRoute.has(ref)) {
        jobs.push({ kind: "route_delete", row: { ref }, key: ref });
      }
    }
    for (const row of readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, [])) {
      if (row?.ref && !remoteClose.has(row.ref)) {
        jobs.push({ kind: "day_close", row, key: row.ref });
      }
    }
    for (const row of readDemoJson<CollectorDayExpenseDraft[]>(
      DEMO_COLLECTOR_DAY_EXPENSES_KEY,
      [],
    )) {
      if (row?.ref && !remoteExpense.has(row.ref)) {
        jobs.push({ kind: "day_expense", row, key: row.ref });
      }
    }
    for (const row of readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, [])) {
      if (row?.ref && !remoteMisc.has(row.ref)) {
        jobs.push({ kind: "misc_payment", row, key: row.ref });
      }
    }
    for (const row of readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, [])) {
      const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
      const key = `${date}::${row.itemId}`;
      if (row?.itemId && date && !remoteAssign.has(key)) {
        jobs.push({ kind: "assignment", row, key });
      }
    }

    let pushed = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        const { res: mirrorRes, json } = await postMirror("/api/ops/mirror", {
          kind: job.kind,
          row: job.row,
        });
        if (mirrorRes.ok && json.ok) pushed += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    return { pushed, failed };
  } catch {
    return { pushed: 0, failed: 0 };
  }
}

/** Pull catálogo operativo + CIE + planilla + PV- */
export async function pullRemoteOpsIntoDemo(): Promise<PullOpsResult> {
  if (typeof window === "undefined") return { ok: true, changed: false, reason: "ssr" };
  try {
    const res = await fetch("/api/ops/bundle", { cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      skipped?: boolean;
      collectors?: Record<string, unknown>[];
      routes?: Record<string, unknown>[];
      day_closes?: Record<string, unknown>[];
      day_expenses?: Record<string, unknown>[];
      misc_payments?: Record<string, unknown>[];
      daily_assignments?: Record<string, unknown>[];
    };
    if (!res.ok || !body.ok) {
      return { ok: false, changed: false, reason: body.error || `http_${res.status}` };
    }
    if (body.skipped) return { ok: true, changed: false, reason: "skipped" };

    const holdMoney = isVirginRemoteHoldActive();
    let changed = false;

    const collectors = (body.collectors ?? [])
      .map(rowToCollector)
      .filter((r): r is CollectorRow => Boolean(r));
    const pendingCollectorRows = readDemoJson<CollectorRow[]>(Q_COLLECTORS, []).filter(
      (row) => row?.ref,
    );
    const pendingCollectors = new Set(pendingCollectorRows.map((row) => row.ref));
    const pendingCollectorDeletes = new Set(
      readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, [])
        .map((row) => row.ref)
        .filter(Boolean),
    );
    const cMerge = mergeRemoteAuthority(
      readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, []),
      collectors,
      pendingCollectors,
      (r) => `${r.ref}|${r.name}|${r.active}|${r.zone}|${r.userRef ?? ""}|${r.login ?? ""}`,
      pendingCollectorRows,
      pendingCollectorDeletes,
    );
    if (cMerge.changed) {
      writeDemoJson(DEMO_COLLECTORS_KEY, cMerge.merged);
      changed = true;
    }

    const deletedRoutes = new Set(listDeletedRouteRefs());
    const routes = (body.routes ?? [])
      .map(rowToRoute)
      .filter((r): r is RouteRow => Boolean(r) && !deletedRoutes.has(r!.ref));
    const localRoutes = readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, []).filter(
      (r) => r?.ref && !deletedRoutes.has(r.ref),
    );
    const pendingRouteRows = readDemoJson<RouteRow[]>(Q_ROUTES, []).filter((row) => row?.ref);
    const pendingRoutes = new Set(pendingRouteRows.map((row) => row.ref));
    const rMerge = mergeRemoteAuthority(
      localRoutes,
      routes,
      pendingRoutes,
      (r) => `${r.ref}|${r.name}|${r.collectorRef}|${r.collector}|${r.status}|${r.clients}`,
      pendingRouteRows,
    );
    if (rMerge.changed || localRoutes.length !== readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, []).length) {
      writeDemoJson(DEMO_ROUTES_KEY, rMerge.merged);
      changed = true;
    }

    if (holdMoney) {
      return { ok: true, changed, reason: "virgin_hold_skip_money" };
    }

    const closes = (body.day_closes ?? [])
      .map(rowToDayClose)
      .filter((r): r is CollectorDayCloseRecord => Boolean(r));
    const clMerge = mergeByRefRemote(
      readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
      closes,
      (r) => `${r.ref}|${r.collected}|${r.cashFloat}|${r.closedAt}`,
    );
    if (clMerge.changed) {
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, clMerge.merged);
      changed = true;
    }

    const expenses = (body.day_expenses ?? [])
      .map(rowToDayExpense)
      .filter((r): r is CollectorDayExpenseDraft => Boolean(r));
    const eMerge = mergeByRefRemote(
      readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
      expenses,
      (r) => `${r.ref}|${r.expensesTotal}|${r.updatedAt}`,
    );
    if (eMerge.changed) {
      writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, eMerge.merged);
      changed = true;
    }

    const misc = (body.misc_payments ?? [])
      .map(rowToMisc)
      .filter((r): r is MiscPayment => Boolean(r));
    const mMerge = mergeByRefRemote(
      readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []),
      misc,
      (r) => `${r.ref}|${r.amount}|${r.paidDate}|${r.label}`,
    );
    if (mMerge.changed) {
      writeDemoJson(DEMO_MISC_PAYMENTS_KEY, mMerge.merged);
      changed = true;
    }

    const remoteAssign = (body.daily_assignments ?? [])
      .map(rowToAssignment)
      .filter((r): r is DailyCollectionAssignment => Boolean(r));
    const localAssign = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
    const assignMap = new Map<string, DailyCollectionAssignment>();
    for (const row of localAssign) {
      assignMap.set(`${row.dispatchDate}::${row.itemId}`, row);
    }
    const pendingAssign = new Set(
      readDemoJson<{ ref: string }[]>(Q_ASSIGN, []).map((row) => row.ref),
    );
    let assignChanged = false;
    const sig = (a: DailyCollectionAssignment) =>
      `${a.visitStatus}|${a.paymentRef}|${a.amountDue}|${a.dayClosedAt}|${a.skipReason}`;
    for (const row of remoteAssign) {
      const key = `${row.dispatchDate}::${row.itemId}`;
      // La nube ya tiene esta firma: un push posterior solo sube filas que cambien de verdad.
      // Sin esto, cada "Actualizar planillas" encolaba toda la hoja, la cola escudaba filas
      // sin cambios contra el N/P del cobrador y luego las pisaba en la nube.
      sentAssignmentSig.set(key, assignmentMirrorSig(row));
      const prev = assignMap.get(key);
      if (!prev) {
        assignMap.set(key, row);
        assignChanged = true;
        continue;
      }
      if (sig(prev) === sig(row)) continue;
      // Cierre hecho en otro celular: gana siempre. La cola local de hoja "abierta"
      // no puede escudar ese cierre ni volver a subirlo al flush (amigo cerrado / yo abierto).
      const remoteClosedLocalOpen = Boolean(row.dayClosedAt) && !prev.dayClosedAt;
      if (pendingAssign.has(key) && !remoteClosedLocalOpen) continue;
      if (remoteClosedLocalOpen && pendingAssign.has(key)) {
        dequeue(Q_ASSIGN, key);
        pendingAssign.delete(key);
      }
      // La hoja abierta de la nube no reabre un cierre de este PC. El resto sí entra, para que el otro aparato se vea igual.
      if (prev.dayClosedAt && !row.dayClosedAt) continue;
      // Un N/P / omisión marcada en este aparato no la reabre una fila "pendiente" vieja de otro aparato.
      // Solo un cobro (PG-) o un cierre de jornada cambian ese estado desde afuera.
      if (
        prev.visitStatus === "omitido" &&
        (row.visitStatus ?? "pendiente") === "pendiente" &&
        !row.paymentRef &&
        !row.dayClosedAt
      ) {
        continue;
      }
      assignMap.set(key, row);
      assignChanged = true;
    }
    const stamped = reconcilePaymentsOntoPlanilla(
      [...assignMap.values()],
      readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
    );
    // Si el CIE- ya llegó y la planilla local sigue abierta (cola / flush a medias), sellar.
    const closesNow = readDemoJson<CollectorDayCloseRecord[]>(
      DEMO_COLLECTOR_DAY_CLOSES_KEY,
      [],
    );
    const healed = applyDayCloseRecordsToAssignments(stamped, closesNow);
    for (const row of healed) {
      if (!row.dayClosedAt) continue;
      const key = `${row.dispatchDate}::${row.itemId}`;
      if (pendingAssign.has(key)) {
        dequeue(Q_ASSIGN, key);
        pendingAssign.delete(key);
      }
    }
    pruneOpenAssignmentQueueAgainstLocalCloses();
    const stampedSig = healed
      .map((row) => `${row.dispatchDate}::${row.itemId}|${sig(row)}`)
      .sort()
      .join("\n");
    const prevSig = localAssign
      .map((row) => `${row.dispatchDate}::${row.itemId}|${sig(row)}`)
      .sort()
      .join("\n");
    if (stampedSig !== prevSig) assignChanged = true;
    if (assignChanged) {
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, healed);
      changed = true;
    }

    return { ok: true, changed };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      reason: err instanceof Error ? err.message : "ops_pull_failed",
    };
  }
}
