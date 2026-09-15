/**
 * C6: sync operativo completo (cobradores, rutas, CIE, gastos, PV-, planilla).
 * Banco/logs siguen siendo proyección de PG- en la app.
 * @see docs/supabase-schema.md
 */
import { createMirrorServerClient } from "@/lib/supabase/admin";
import type { CollectorRow, RouteRow } from "@/lib/mock-data";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { MiscPayment } from "@/lib/misc-payments";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import {
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
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

const Q_COLLECTORS = "nexo-demo-ops-collectors-queue";
const Q_ROUTES = "nexo-demo-ops-routes-queue";
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
  if (typeof window === "undefined") return;
  try {
    const { res, json } = await postMirror("/api/ops/mirror", pathBody);
    if (!res.ok || !json.ok) {
      enqueue(queueKey, { ref, ...(pathBody.row as object) } as { ref: string });
      return;
    }
    dequeue(queueKey, ref);
  } catch {
    enqueue(queueKey, { ref, ...(pathBody.row as object) } as { ref: string });
  }
}

export function queueCollectorMirror(c: CollectorRow) {
  void persistKind(Q_COLLECTORS, { kind: "collector", row: c }, c.ref);
}
export function queueCollectorsMirror(rows: CollectorRow[]) {
  for (const row of rows) queueCollectorMirror(row);
}
export function queueRouteMirror(r: RouteRow) {
  void persistKind(Q_ROUTES, { kind: "route", row: r }, r.ref);
}
export function queueRoutesMirror(rows: RouteRow[]) {
  for (const row of rows) queueRouteMirror(row);
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
export function queueAssignmentMirror(a: DailyCollectionAssignment) {
  const ref = `${a.dispatchDate}::${a.itemId}`;
  void persistKind(Q_ASSIGN, { kind: "assignment", row: a }, ref);
}

export function queueAssignmentsMirror(rows: DailyCollectionAssignment[]) {
  for (const row of rows) queueAssignmentMirror(row);
}

export async function flushOpsMirrorQueues() {
  if (typeof window === "undefined") return;
  const jobs: Array<{ key: string; kind: string; rows: { ref: string }[] }> = [
    { key: Q_COLLECTORS, kind: "collector", rows: readDemoJson(Q_COLLECTORS, []) },
    { key: Q_ROUTES, kind: "route", rows: readDemoJson(Q_ROUTES, []) },
    { key: Q_CLOSES, kind: "day_close", rows: readDemoJson(Q_CLOSES, []) },
    { key: Q_EXPENSES, kind: "day_expense", rows: readDemoJson(Q_EXPENSES, []) },
    { key: Q_MISC, kind: "misc_payment", rows: readDemoJson(Q_MISC, []) },
    { key: Q_ASSIGN, kind: "assignment", rows: readDemoJson(Q_ASSIGN, []) },
  ];
  for (const job of jobs) {
    const left: { ref: string }[] = [];
    for (const row of job.rows) {
      try {
        const { res, json } = await postMirror("/api/ops/mirror", { kind: job.kind, row });
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
      (body.daily_assignments ?? []).map((r) => `${r.dispatch_date}::${r.item_id}`),
    );

    const jobs: Array<{ kind: string; row: unknown; key: string }> = [];

    for (const row of readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, [])) {
      if (row?.ref && !remoteCollector.has(row.ref)) {
        jobs.push({ kind: "collector", row, key: row.ref });
      }
    }
    for (const row of readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, [])) {
      if (row?.ref && !remoteRoute.has(row.ref)) {
        jobs.push({ kind: "route", row, key: row.ref });
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
      const key = `${row.dispatchDate}::${row.itemId}`;
      if (row?.itemId && row?.dispatchDate && !remoteAssign.has(key)) {
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

    let changed = false;

    const collectors = (body.collectors ?? [])
      .map(rowToCollector)
      .filter((r): r is CollectorRow => Boolean(r));
    const cMerge = mergeByRefRemote(
      readDemoJson<CollectorRow[]>(DEMO_COLLECTORS_KEY, []),
      collectors,
      (r) => `${r.ref}|${r.name}|${r.active}|${r.zone}`,
    );
    if (cMerge.changed) {
      writeDemoJson(DEMO_COLLECTORS_KEY, cMerge.merged);
      changed = true;
    }

    const routes = (body.routes ?? []).map(rowToRoute).filter((r): r is RouteRow => Boolean(r));
    const rMerge = mergeByRefRemote(
      readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, []),
      routes,
      (r) => `${r.ref}|${r.name}|${r.collectorRef}|${r.status}|${r.clients}`,
    );
    if (rMerge.changed) {
      writeDemoJson(DEMO_ROUTES_KEY, rMerge.merged);
      changed = true;
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
    let assignChanged = false;
    for (const row of remoteAssign) {
      const key = `${row.dispatchDate}::${row.itemId}`;
      const prev = assignMap.get(key);
      const sig = (a: DailyCollectionAssignment) =>
        `${a.visitStatus}|${a.paymentRef}|${a.amountDue}|${a.dayClosedAt}|${a.skipReason}`;
      if (!prev || sig(prev) !== sig(row)) {
        assignMap.set(key, row);
        assignChanged = true;
      }
    }
    if (assignChanged) {
      writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, [...assignMap.values()]);
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
