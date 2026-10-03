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
import { DAY_CLOSE_SKIP_REASON, LOAN_GIVEN_TODAY_REASON } from "@/lib/collector-dispatch-sync";
import { isDeletedRef, readDeletedIdSet } from "@/lib/deleted-ids";
import { isLoanDeletedStatus } from "@/lib/supabase/catalog-mirror";
import type { MiscPayment } from "@/lib/misc-payments";
import {
  ensureManualTLaunchClose,
  projectPceTFromDayCloses,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";
import { businessDaysAgoIso, businessTodayIso } from "@/lib/business-timezone";
import {
  assignmentsInPlanillaWindow,
  planillaWindowStartIso,
} from "@/lib/planilla-window";
import {
  dayCloseFreshnessMs,
  joinCashAdjustmentRefs,
  mergeRouteCashAdjustments,
  routeCashAdjustmentsSig,
  splitCashAdjustmentRefs,
} from "@/lib/cash-adjustment";
import {
  emitMirrorQueueChanged,
  queueWithoutSent,
  shouldDropFromMirrorQueue,
  type MirrorApiJson,
} from "@/lib/supabase/mirror-queue";
import {
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
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

function unsavedReason(keys: string[]) {
  return `sin espacio en el aparato: ${keys.map((key) => key.replace(/^nexo-demo-/, "")).join(", ")}`;
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

/**
 * CIE-: la nube manda, salvo un ajuste de saldo local más nuevo que el de nube
 * (aún en cola de flush). Así el pull no rebobina el ajuste del supervisor.
 * Ajustes de A/N: unión por ruta (gana el más reciente), ninguno se pierde.
 */
function mergeDayClosesRemote(
  local: CollectorDayCloseRecord[],
  remote: CollectorDayCloseRecord[],
): { merged: CollectorDayCloseRecord[]; changed: boolean } {
  const localByRef = new Map(local.filter((row) => row?.ref).map((row) => [row.ref, row]));
  const adjustmentMs = (row: CollectorDayCloseRecord | undefined) =>
    dayCloseFreshnessMs(undefined, row?.cashAdjustment) || 0;
  const chosenRemote = remote.map((row) => {
    const prev = localByRef.get(row.ref);
    const chosen = prev && adjustmentMs(prev) > adjustmentMs(row) ? prev : row;
    const routeCashAdjustments = mergeRouteCashAdjustments(
      prev?.routeCashAdjustments,
      row.routeCashAdjustments,
    );
    return routeCashAdjustmentsSig(routeCashAdjustments) ===
      routeCashAdjustmentsSig(chosen.routeCashAdjustments)
      ? chosen
      : { ...chosen, routeCashAdjustments };
  });
  return mergeByRefRemote(
    local,
    chosenRemote,
    (r) =>
      `${r.ref}|${r.collected}|${r.cashFloat}|${r.closedAt}|${r.cashAdjustment?.at ?? ""}|${routeCashAdjustmentsSig(r.routeCashAdjustments)}`,
  );
}

/**
 * Gastos del día: no dejar que un pull viejo/vacío borre desembolsos locales
 * (botón Préstamos en 0 aunque el crédito sí está en el sistema).
 */
function mergeDayExpensesPreferRicher(
  local: CollectorDayExpenseDraft[],
  remote: CollectorDayExpenseDraft[],
): { merged: CollectorDayExpenseDraft[]; changed: boolean } {
  const map = new Map<string, CollectorDayExpenseDraft>();
  for (const row of local) if (row?.ref) map.set(row.ref, row);
  let changed = false;
  const richness = (row: CollectorDayExpenseDraft) => {
    const total = Number(row.expensesTotal) || 0;
    const lines = Array.isArray(row.expenses) ? row.expenses.length : 0;
    const prestamos = Array.isArray(row.expenses)
      ? row.expenses.filter(
          (line) => line.category === "prestamo_ruta" || line.id === "prestamo",
        ).length
      : 0;
    const at = Date.parse(String(row.updatedAt || "")) || 0;
    return { total, lines, prestamos, at };
  };
  const preferRemote = (prev: CollectorDayExpenseDraft, next: CollectorDayExpenseDraft) => {
    const a = richness(prev);
    const b = richness(next);
    if (b.prestamos !== a.prestamos) return b.prestamos > a.prestamos;
    if (b.total !== a.total) return b.total > a.total;
    if (b.lines !== a.lines) return b.lines > a.lines;
    return b.at >= a.at;
  };
  for (const row of remote) {
    if (!row?.ref) continue;
    const prev = map.get(row.ref);
    if (!prev) {
      map.set(row.ref, row);
      changed = true;
      continue;
    }
    if (!preferRemote(prev, row)) continue;
    if (
      `${prev.ref}|${prev.expensesTotal}|${prev.updatedAt}` !==
      `${row.ref}|${row.expensesTotal}|${row.updatedAt}`
    ) {
      changed = true;
    }
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

/**
 * Sin `keepalive`: Chrome rechaza al instante un keepalive si los que siguen en vuelo
 * suman más de 64 KB (ráfaga de planilla + pulls), y el dato quedaba sin subir.
 * Si la app se cierra a media subida, la fila sigue en cola y sube al volver.
 */
async function postMirror(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as MirrorApiJson;
  return { res, json };
}

function enqueue<T extends { ref: string }>(key: string, row: T) {
  const q = readDemoJson<T[]>(key, []).filter((r) => r.ref !== row.ref);
  q.push(row);
  writeDemoJson(key, q);
  emitMirrorQueueChanged();
}

/** Descarta la fila de la cola: la nube ya ganó sobre ella. */
function dequeue(key: string, ref: string) {
  writeDemoJson(
    key,
    readDemoJson<{ ref: string }[]>(key, []).filter((r) => r.ref !== ref),
  );
  emitMirrorQueueChanged();
}

/**
 * Saca de la cola solo lo que la nube confirmó, comparando contra la cola actual:
 * una fila encolada (o editada) mientras subía la anterior se queda para el próximo envío.
 */
function dequeueSent(key: string, sent: readonly { ref: string }[]) {
  if (!sent.length) return;
  const current = readDemoJson<{ ref: string }[]>(key, []);
  const left = queueWithoutSent(current, sent);
  if (left.length !== current.length) writeDemoJson(key, left);
  emitMirrorQueueChanged();
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
    movement_refs: joinCashAdjustmentRefs(
      c.movementRefs ?? [],
      c.cashAdjustment,
      c.routeCashAdjustments,
    ),
    updated_at: new Date().toISOString(),
  };
}

export function rowToDayClose(r: Record<string, unknown>): CollectorDayCloseRecord | null {
  const ref = String(r.ref || "").trim();
  if (!ref) return null;
  const { movementRefs, cashAdjustment, routeCashAdjustments } = splitCashAdjustmentRefs(
    Array.isArray(r.movement_refs) ? (r.movement_refs as string[]) : [],
  );
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
    ...(cashAdjustment
      ? {
          cashExpected: cashAdjustment.calculated,
          cashDeclared: cashAdjustment.real,
          cashVariance: cashAdjustment.real - cashAdjustment.calculated,
          cashAdjustment,
        }
      : {}),
    ...(routeCashAdjustments ? { routeCashAdjustments } : {}),
    movementRefs,
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

type MirrorDb = NonNullable<ReturnType<typeof createMirrorClient>>;

/** ¿El cliente tiene un préstamo vivo (no eliminado) que empieza ese día? Si falla la lectura, asume que sí. */
async function loanStartedOn(client: MirrorDb, clientRef: string, dispatchDate: string) {
  if (!clientRef.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) return true;
  const [y, m, d] = dispatchDate.split("-");
  const { data, error } = await client
    .from("loans")
    .select("ref, status")
    .eq("client_ref", clientRef.trim())
    .in("start_date", [`${d}/${m}/${y}`, dispatchDate]);
  if (error) return true;
  return (data ?? []).some((loan) => !isLoanDeletedStatus(loan));
}

/**
 * Fila «Prestar» fantasma: la armó un aparato con los préstamos a medio cargar.
 * - «Préstamo hecho hoy» sin préstamo que empiece ese día.
 * - Pendiente o «Cierre de jornada» de un cliente con préstamo abierto de días
 *   anteriores (saldo > 0, sin pago ese día). Esas filas dejaban a cada cliente doble.
 * Las decisiones del cobrador («Hoy no quiere préstamo», cobrado) siempre entran.
 */
async function prestarGhostReason(
  client: MirrorDb,
  row: Record<string, unknown>,
): Promise<{ ghost: boolean; error?: string }> {
  if (!String(row.item_id || "").includes(":prestar")) return { ghost: false };
  const dispatchDate = String(row.dispatch_date || "").trim();
  const clientRef = String(row.client_ref || "").trim();
  if (!clientRef || !/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) return { ghost: false };
  const status = String(row.visit_status || "pendiente");
  const reason = String(row.skip_reason || "");
  const givenTodayClaim = status === "omitido" && reason === LOAN_GIVEN_TODAY_REASON;
  const autoRow =
    status === "pendiente" || (status === "omitido" && reason === DAY_CLOSE_SKIP_REASON);
  if (!givenTodayClaim && !autoRow) return { ghost: false };

  const [y, m, d] = dispatchDate.split("-");
  const dispatchDisplay = `${d}/${m}/${y}`;
  const { data: loans, error } = await client
    .from("loans")
    .select("ref, status, start_date, balance")
    .eq("client_ref", clientRef);
  if (error) return { ghost: false, error: error.message };
  const live = (loans ?? []).filter((loan) => !isLoanDeletedStatus(loan));
  const startedToday = (loan: { start_date?: string | null }) =>
    loan.start_date === dispatchDisplay || loan.start_date === dispatchDate;
  if (givenTodayClaim) return { ghost: !live.some(startedToday) };

  const open = live.filter(
    (loan) =>
      !startedToday(loan) &&
      Number(loan.balance) > 0 &&
      !/finaliz|pagad|cancel/i.test(String(loan.status || "")),
  );
  if (!open.length) return { ghost: false };
  const { data: paidToday, error: payError } = await client
    .from("payments")
    .select("ref")
    .in("loan_ref", open.map((loan) => loan.ref))
    .eq("paid_date", dispatchDate)
    .limit(1);
  if (payError) return { ghost: false, error: payError.message };
  return { ghost: !(paidToday ?? []).length };
}

/**
 * Espejo de planilla (servidor). Invariantes (no romper nunca):
 * 1) day_closed_at en nube no lo borra una fila abierta de otro celular.
 * 2) omitido (N/P) no lo pisa un «pendiente» sin PG-.
 * 3) Reabrir jornada a propósito exige flujo explícito (hoy: no hay UI);
 *    un upsert normal nunca limpia day_closed_at.
 */
export async function upsertAssignmentRow(row: Record<string, unknown>) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  // Visita abierta de un préstamo dado de baja (copia vieja de otro aparato): no vuelve.
  const loanRef = String(row.loan_ref || "").trim();
  if (loanRef && !row.day_closed_at && !row.payment_ref) {
    const { data: loan, error: loanError } = await client
      .from("loans")
      .select("status")
      .eq("ref", loanRef)
      .maybeSingle();
    if (loanError) return { ok: false as const, error: loanError.message };
    if (isLoanDeletedStatus(loan)) {
      return { ok: true as const, skipped: true as const, reason: "loan_deleted" };
    }
  }
  const ghost = await prestarGhostReason(client, row);
  if (ghost.error) return { ok: false as const, error: ghost.error };
  if (ghost.ghost) return { ok: true as const, skipped: true as const, reason: "prestar_ghost" };
  const { data, error } = await client
    .from("daily_assignments")
    .select("visit_status, skip_reason, day_closed_at, collector_ref, dispatch_date")
    .eq("dispatch_date", row.dispatch_date)
    .eq("item_id", row.item_id)
    .maybeSingle();
  const current = (data ?? null) as {
    visit_status?: string;
    skip_reason?: string | null;
    day_closed_at?: string | null;
    collector_ref?: string | null;
    dispatch_date?: string | null;
  } | null;
  // Cierre en nube gana siempre frente a hoja abierta (dueño / otro celular / código viejo).
  if (!error && current?.day_closed_at && !row.day_closed_at) {
    return { ok: true as const, kept: true as const };
  }
  // Si ya hay CIE- del día, tampoco aceptar una fila que limpie el sello.
  if (!error && !row.day_closed_at) {
    const collectorRef = String(row.collector_ref || current?.collector_ref || "").trim();
    const closeDate = String(row.dispatch_date || current?.dispatch_date || "").trim();
    if (collectorRef && closeDate) {
      const { data: cie } = await client
        .from("day_closes")
        .select("ref")
        .eq("collector_ref", collectorRef)
        .eq("close_date", closeDate)
        .like("ref", "CIE-%")
        .limit(1)
        .maybeSingle();
      if (cie && typeof cie === "object" && "ref" in cie && cie.ref) {
        return { ok: true as const, kept: true as const };
      }
    }
  }
  const incomingStatus = String(row.visit_status ?? "pendiente");
  if (incomingStatus === "pendiente" && !row.payment_ref) {
    if (
      !error &&
      current?.visit_status === "omitido" &&
      current.skip_reason !== DAY_CLOSE_SKIP_REASON
    ) {
      // «Préstamo hecho hoy» cuyo préstamo se borró: el cliente vuelve a Prestar.
      const loanGone =
        current.skip_reason === LOAN_GIVEN_TODAY_REASON &&
        String(row.item_id || "").includes(":prestar") &&
        !(await loanStartedOn(client, String(row.client_ref || ""), String(row.dispatch_date || "")));
      if (!loanGone) return { ok: true as const, kept: true as const };
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

/**
 * CIE-/PCE- a day_closes. Si ya hay otro CIE- del mismo cobrador+día (ref distinta),
 * lo reemplaza para no chocar con el unique parcial.
 *
 * Blindaje CIE: no dejar que un aparato con cash_float viejo (ej. 2.090.000)
 * pise el CIE ya sellado en nube (ej. 2.704.000) si el de nube es más reciente.
 *
 * `force: true` (solo taller / force-sync): la PC principal pisa la nube con el float local.
 */
export async function upsertDayCloseIdempotent(
  row: Record<string, unknown>,
  options?: { force?: boolean },
) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };

  const ref = String(row.ref || "");
  const force = Boolean(options?.force);
  let incomingRow = row;
  if (ref.startsWith("CIE-")) {
    const { data: existing, error: readError } = await client
      .from("day_closes")
      .select("cash_float,close_date,closed_at,updated_at,movement_refs")
      .eq("ref", ref)
      .maybeSingle();
    if (readError) return { ok: false as const, error: readError.message };
    if (existing) {
      const cloudRefs = splitCashAdjustmentRefs(
        Array.isArray(existing.movement_refs) ? (existing.movement_refs as string[]) : [],
      );
      const incomingRefs = splitCashAdjustmentRefs(
        Array.isArray(row.movement_refs) ? (row.movement_refs as string[]) : [],
      );
      // Ajustes de A/N: unión por ruta (gana el más reciente). Ningún aparato borra el de otro.
      const routeAdjustments = mergeRouteCashAdjustments(
        cloudRefs.routeCashAdjustments,
        incomingRefs.routeCashAdjustments,
      );
      const routeSig = routeCashAdjustmentsSig(routeAdjustments);
      incomingRow = {
        ...row,
        movement_refs: joinCashAdjustmentRefs(
          incomingRefs.movementRefs,
          incomingRefs.cashAdjustment,
          routeAdjustments,
        ),
      };
      const cloudNeedsRouteAdjustments =
        routeSig !== routeCashAdjustmentsSig(cloudRefs.routeCashAdjustments);
      /** Un candado frena la fila, pero un ajuste nuevo de A/N igual entra a la nube (ok sin skip). */
      const skipKeepingRouteAdjustments = async (reason: string) => {
        if (!cloudNeedsRouteAdjustments) {
          return { ok: true as const, skipped: true as const, reason };
        }
        const { error: updateError } = await client
          .from("day_closes")
          .update({
            movement_refs: joinCashAdjustmentRefs(
              cloudRefs.movementRefs,
              cloudRefs.cashAdjustment,
              routeAdjustments,
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("ref", ref);
        if (updateError) return { ok: false as const, error: updateError.message };
        return { ok: true as const };
      };

      if (!force) {
        const cloudFloat = Number(existing.cash_float) || 0;
        const incomingFloat = Number(row.cash_float) || 0;
        // Candado de días pasados: el saldo de ayer y antes ya es el Inicial de otro día.
        // Solo el botón de taller (force) puede corregirlo.
        const closeDate = String(existing.close_date || row.close_date || "");
        if (cloudFloat !== incomingFloat && closeDate && closeDate < businessTodayIso()) {
          return skipKeepingRouteAdjustments("cloud_cie_past_day_sealed");
        }
        const cloudAdjustment = cloudRefs.cashAdjustment;
        const incomingAdjustment = incomingRefs.cashAdjustment;
        // Ajuste de saldo en nube: otro aparato con el CIE- sin ajuste (o uno más viejo) no lo borra.
        if (
          cloudAdjustment &&
          dayCloseFreshnessMs(undefined, cloudAdjustment) >
            (dayCloseFreshnessMs(undefined, incomingAdjustment) || 0)
        ) {
          return skipKeepingRouteAdjustments("cloud_cie_keeps_cash_adjustment");
        }
        if (cloudFloat !== incomingFloat) {
          const cloudTs = dayCloseFreshnessMs(
            String(existing.closed_at || existing.updated_at || ""),
            cloudAdjustment,
          );
          const incomingTs = dayCloseFreshnessMs(
            String(row.closed_at || row.updated_at || ""),
            incomingAdjustment,
          );
          const cloudWins =
            Number.isFinite(cloudTs) &&
            (!Number.isFinite(incomingTs) || cloudTs >= incomingTs);
          if (cloudWins) {
            return skipKeepingRouteAdjustments("cloud_cie_keeps_cash_float");
          }
        }
      }
    }
  }

  // Force: marca updated_at ahora para que pulls posteriores no rebobinen con basura vieja.
  const payload = force
    ? { ...incomingRow, updated_at: new Date().toISOString() }
    : incomingRow;

  const first = await client.from("day_closes").upsert(payload, { onConflict: "ref" });
  if (!first.error) return { ok: true as const, forced: force };

  const msg = first.error.message || "";
  const isCie = ref.startsWith("CIE-");
  const isUniqueClash =
    msg.includes("day_closes_collector_date") ||
    msg.includes("day_closes_cie_collector_date") ||
    msg.includes("duplicate key");

  if (!isCie || !isUniqueClash) {
    return { ok: false as const, error: msg };
  }

  const collectorRef = String(payload.collector_ref || "");
  const closeDate = String(payload.close_date || "");
  if (!collectorRef || !closeDate) {
    return { ok: false as const, error: msg };
  }

  const { error: delError } = await client
    .from("day_closes")
    .delete()
    .eq("collector_ref", collectorRef)
    .eq("close_date", closeDate)
    .neq("ref", ref)
    .like("ref", "CIE-%");
  if (delError) return { ok: false as const, error: delError.message };

  const second = await client.from("day_closes").upsert(payload, { onConflict: "ref" });
  if (second.error) return { ok: false as const, error: second.error.message };
  return { ok: true as const, forced: force };
}

/** PostgREST/Supabase suele topear en 1000 filas aunque pidas limit mayor. */
const OPS_FETCH_PAGE = 1000;

export async function fetchOpsTable(table: string) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, rows: [] as Record<string, unknown>[] };

  let orderById = true;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let query = client.from(table).select("*");
    if (orderById) query = query.order("id", { ascending: true });
    let { data, error } = await query.range(from, from + OPS_FETCH_PAGE - 1);
    if (error && orderById) {
      orderById = false;
      ({ data, error } = await client
        .from(table)
        .select("*")
        .range(from, from + OPS_FETCH_PAGE - 1));
    }
    if (error) {
      return { ok: false as const, error: error.message, rows: [] as Record<string, unknown>[] };
    }
    const page = (data ?? []) as Record<string, unknown>[];
    if (!page.length) break;
    rows.push(...page);
    if (page.length < OPS_FETCH_PAGE) break;
    from += OPS_FETCH_PAGE;
  }
  return { ok: true as const, rows };
}

/**
 * Lectura paginada con ventana de fechas (acelera el bundle en PC).
 * No borra filas locales más viejas: el merge solo actualiza lo que viene.
 */
export async function fetchOpsTableSince(
  table: string,
  dateColumn: string,
  sinceIso: string,
) {
  const client = createMirrorClient();
  if (!client) return { ok: true as const, skipped: true as const, rows: [] as Record<string, unknown>[] };

  const since = String(sinceIso || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return fetchOpsTable(table);
  }

  let orderById = true;
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let query = client.from(table).select("*").gte(dateColumn, since);
    if (orderById) query = query.order("id", { ascending: true });
    let { data, error } = await query.range(from, from + OPS_FETCH_PAGE - 1);
    if (error && orderById) {
      orderById = false;
      ({ data, error } = await client
        .from(table)
        .select("*")
        .gte(dateColumn, since)
        .range(from, from + OPS_FETCH_PAGE - 1));
    }
    if (error) {
      return { ok: false as const, error: error.message, rows: [] as Record<string, unknown>[] };
    }
    const page = (data ?? []) as Record<string, unknown>[];
    if (!page.length) break;
    rows.push(...page);
    if (page.length < OPS_FETCH_PAGE) break;
    from += OPS_FETCH_PAGE;
  }
  return { ok: true as const, rows };
}

// —— browser queue + persist ——

async function persistKind(
  queueKey: string,
  pathBody: { kind: string; row: unknown },
  ref: string,
) {
  if (typeof window === "undefined") return false;
  // Cola primero: el pull no debe pisar una edición en vuelo.
  const queued = { ref, ...(pathBody.row as object) } as { ref: string };
  enqueue(queueKey, queued);
  try {
    const { res, json } = await postMirror("/api/ops/mirror", pathBody);
    // Solo sacar de cola si escribió de verdad (o skip irrecuperable / CIE nube gana).
    // Antes: ok+skipped (sin service role / virgin) vaciaba la cola y el dato nunca subía.
    if (res.ok && shouldDropFromMirrorQueue(json)) {
      dequeueSent(queueKey, [queued]);
      return !json.skipped;
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
/** JSON con llaves ordenadas: jsonb de Postgres reordena las llaves de `stops`. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, entry]) => `${JSON.stringify(k)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Firma de lo que viaja a `routes` (sin `updated_at`). */
function routeMirrorSig(route: RouteRow) {
  const { updated_at: _stamp, ...row } = routeToRow(route);
  return stableJson(row);
}

/** Última firma subida / vista en nube por ruta: solo se sube la ruta que cambió. */
const sentRouteSig = new Map<string, string>();

export function queueRouteMirror(r: RouteRow) {
  const sig = routeMirrorSig(r);
  if (sentRouteSig.get(r.ref) === sig) return;
  sentRouteSig.set(r.ref, sig);
  void persistKind(Q_ROUTES, { kind: "route", row: r }, r.ref).then((ok) => {
    if (!ok) sentRouteSig.delete(r.ref);
  });
}
export function queueRoutesMirror(rows: RouteRow[]) {
  for (const row of rows) queueRouteMirror(row);
}

/** Borrado duro en Postgres (Eliminar = desaparecer, no solo en este PC). */
export function queueRouteDeleteMirror(ref: string) {
  const clean = (ref || "").trim();
  if (!clean || typeof window === "undefined") return;
  sentRouteSig.delete(clean);
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
  // PCE- no cabe en day_closes (check ^CIE-). Encolarlos solo genera 502 y tapa el flush.
  if (String(c.ref || "").startsWith("PCE-")) return;
  // Reconstruido desde planilla: no es saldo sellado, nunca sube.
  if (c.provisional) return;
  void persistKind(Q_CLOSES, { kind: "day_close", row: c }, c.ref);
}
/** Cola + subida esperada del CIE-. `true` solo si la nube lo escribió de verdad. */
export async function mirrorDayCloseNow(c: CollectorDayCloseRecord): Promise<boolean> {
  if (!String(c.ref || "").startsWith("CIE-") || c.provisional) return false;
  return persistKind(Q_CLOSES, { kind: "day_close", row: c }, c.ref);
}
/** Cola + subida esperada. true = el borrador ya está en Supabase. */
export function mirrorDayExpenseNow(d: CollectorDayExpenseDraft): Promise<boolean> {
  return persistKind(Q_EXPENSES, { kind: "day_expense", row: d }, d.ref);
}
export function queueDayExpenseMirror(d: CollectorDayExpenseDraft) {
  void mirrorDayExpenseNow(d);
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

/** ¿Hay CIE- local de ese cobrador+día? No subir hoja abierta encima. */
function localCieCoversAssignment(
  a: DailyCollectionAssignment,
  readCloses: () => CollectorDayCloseRecord[],
): boolean {
  if (a.dayClosedAt) return false;
  const date = normalizeHistoryDate(a.dispatchDate) || a.dispatchDate;
  if (!date || !a.collectorRef) return false;
  return readCloses().some(
    (row) =>
      row.collectorRef === a.collectorRef &&
      (normalizeHistoryDate(row.date) || row.date) === date,
  );
}

function readLocalDayCloses() {
  return readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []);
}

export function queueAssignmentMirror(
  a: DailyCollectionAssignment,
  readCloses: () => CollectorDayCloseRecord[] = readLocalDayCloses,
) {
  // No encolar planilla abierta si este PC ya tiene el CIE- del día (evita reabrir en nube).
  if (localCieCoversAssignment(a, readCloses)) return;
  const ref = `${a.dispatchDate}::${a.itemId}`;
  const sig = assignmentMirrorSig(a);
  if (sentAssignmentSig.get(ref) === sig) return;
  sentAssignmentSig.set(ref, sig);
  void persistKind(Q_ASSIGN, { kind: "assignment", row: a }, ref).then((ok) => {
    if (!ok) sentAssignmentSig.delete(ref);
  });
}

export function queueAssignmentsMirror(rows: DailyCollectionAssignment[]) {
  // Un lote = una lectura de CIE- (antes se parseaba por cada visita abierta).
  let closes: CollectorDayCloseRecord[] | null = null;
  const readCloses = () => (closes ??= readLocalDayCloses());
  for (const row of rows) queueAssignmentMirror(row, readCloses);
}

export async function flushOpsMirrorQueues(): Promise<{ flushed: number; left: number }> {
  if (typeof window === "undefined") return { flushed: 0, left: 0 };

  pruneOpenAssignmentQueueAgainstLocalCloses();

  // PCE- colados en la cola de cierres: basura irrecuperable (schema solo CIE-).
  {
    const closes = readDemoJson<{ ref: string }[]>(Q_CLOSES, []);
    const withoutPce = closes.filter((row) => !String(row.ref || "").startsWith("PCE-"));
    if (withoutPce.length !== closes.length) {
      writeDemoJson(Q_CLOSES, withoutPce);
    }
  }

  let flushed = 0;

  // Primero deletes (si no, un upsert viejo las revive).
  const routeDeletes = readDemoJson<{ ref: string }[]>(Q_ROUTE_DELETES, []);
  const routeDeletesSent: { ref: string }[] = [];
  for (const row of routeDeletes) {
    try {
      const { res, json } = await postMirror("/api/ops/mirror", {
        kind: "route_delete",
        row: { ref: row.ref },
      });
      if (res.ok && shouldDropFromMirrorQueue(json)) {
        flushed += 1;
        routeDeletesSent.push(row);
      }
    } catch {
      /* queda en cola */
    }
  }
  dequeueSent(Q_ROUTE_DELETES, routeDeletesSent);

  const collectorDeletes = readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, []);
  const collectorDeletesSent: { ref: string }[] = [];
  for (const row of collectorDeletes) {
    try {
      const { res, json } = await postMirror("/api/ops/mirror", {
        kind: "collector_delete",
        row: { ref: row.ref },
      });
      if (res.ok && shouldDropFromMirrorQueue(json)) {
        flushed += 1;
        collectorDeletesSent.push(row);
      }
    } catch {
      /* queda en cola */
    }
  }
  dequeueSent(Q_COLLECTOR_DELETES, collectorDeletesSent);

  const deleted = new Set(listDeletedRouteRefs());
  const deletedCollectors = new Set(
    readDemoJson<{ ref: string }[]>(Q_COLLECTOR_DELETES, []).map((row) => row.ref),
  );
  /** `gone`: fila de algo ya borrado — sale de la cola sin subir. */
  const jobs: Array<{ key: string; kind: string; gone?: (ref: string) => boolean }> = [
    { key: Q_COLLECTORS, kind: "collector", gone: (ref) => deletedCollectors.has(ref) },
    { key: Q_ROUTES, kind: "route", gone: (ref) => deleted.has(ref) },
    { key: Q_CLOSES, kind: "day_close" },
    { key: Q_EXPENSES, kind: "day_expense" },
    { key: Q_MISC, kind: "misc_payment" },
    { key: Q_ASSIGN, kind: "assignment" },
  ];
  const localAssignByKey = new Map<string, DailyCollectionAssignment>(
    readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []).map((row) => {
      const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
      return [`${date}::${row.itemId}`, row];
    }),
  );
  for (const job of jobs) {
    const sent: { ref: string }[] = [];
    for (const row of readDemoJson<{ ref: string }[]>(job.key, [])) {
      if (job.gone?.(row.ref)) {
        sent.push(row);
        continue;
      }
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
        if (res.ok && shouldDropFromMirrorQueue(json)) {
          flushed += 1;
          sent.push(row);
        }
      } catch {
        /* queda en cola */
      }
    }
    dequeueSent(job.key, sent);
  }
  emitMirrorQueueChanged();
  const left = [Q_ROUTE_DELETES, Q_COLLECTOR_DELETES, ...jobs.map((job) => job.key)].reduce(
    (sum, key) => sum + readDemoJson<{ ref: string }[]>(key, []).length,
    0,
  );
  return { flushed, left };
}

export type OpsBundleBody = {
  ok?: boolean;
  skipped?: boolean;
  error?: string;
  collectors?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
  day_closes?: Record<string, unknown>[];
  day_expenses?: Record<string, unknown>[];
  misc_payments?: Record<string, unknown>[];
  daily_assignments?: Record<string, unknown>[];
};

export type PullOpsResult = {
  ok: boolean;
  changed: boolean;
  reason?: string;
  /** Bundle ya bajado: reconcile no vuelve a pedir /api/ops/bundle. */
  bundle?: OpsBundleBody;
};

/**
 * C6.1 — crítico: CIE / gastos / planilla / rutas que viven solo en un
 * navegador deben subir a Postgres. Sin esto el saldo de rutas diverge
 * entre PC y celular (mismo bug que los PG- huérfanos).
 *
 * Si `prefetched` viene del pull, no se descarga el bundle otra vez (latencia PC).
 */
export async function reconcileLocalOpsToRemote(
  prefetched?: OpsBundleBody,
): Promise<{
  pushed: number;
  failed: number;
}> {
  if (typeof window === "undefined") return { pushed: 0, failed: 0 };

  try {
    let body: OpsBundleBody;
    if (prefetched?.ok && !prefetched.skipped) {
      body = prefetched;
    } else {
      const res = await fetch("/api/ops/bundle", { cache: "no-store" });
      body = (await res.json()) as OpsBundleBody;
      if (!res.ok || !body.ok || body.skipped) return { pushed: 0, failed: 0 };
    }

    const remoteCollector = new Set(
      (body.collectors ?? [])
        .map((r) => String(r.ref || ""))
        .filter(Boolean),
    );
    const remoteRoute = new Set(
      (body.routes ?? []).map((r) => String(r.ref || "")).filter(Boolean),
    );
    const remoteClose = new Map<string, number>();
    for (const r of body.day_closes ?? []) {
      const ref = String(r.ref || "").trim();
      if (!ref) continue;
      remoteClose.set(ref, Number(r.cash_float) || 0);
    }
    const remoteExpense = new Set(
      (body.day_expenses ?? []).map((r) => String(r.ref || "")).filter(Boolean),
    );
    const remoteMisc = new Set(
      (body.misc_payments ?? []).map((r) => String(r.ref || "")).filter(Boolean),
    );
    const remoteAssignMeta = new Map<string, { closed: boolean }>();
    for (const r of body.daily_assignments ?? []) {
      const date =
        normalizeHistoryDate(String(r.dispatch_date || "")) || String(r.dispatch_date || "");
      const itemId = String(r.item_id || "");
      if (!date || !itemId) continue;
      remoteAssignMeta.set(`${date}::${itemId}`, {
        closed: Boolean(r.day_closed_at),
      });
    }
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
      if (!row?.ref) continue;
      // PCE- aún no caben en day_closes (check ^CIE-) hasta migración.
      if (String(row.ref).startsWith("PCE-") || row.provisional) continue;
      // Solo huérfanos. Si la nube ya tiene el CIE-, su saldo manda y entra por pull;
      // un saldo local distinto nunca se re-sube solo (así volvía el 2.090.000).
      if (!remoteClose.has(row.ref)) {
        jobs.push({ kind: "day_close", row, key: row.ref });
      }
    }
    // PCE- locales: solo cuando el esquema acepte ref ^(CIE|PCE)-.
    // Mientras tanto no encolar (evita 502 day_closes_ref_format).
    const expenseSince = businessDaysAgoIso(90);
    const assignSince = planillaWindowStartIso();
    for (const row of readDemoJson<CollectorDayExpenseDraft[]>(
      DEMO_COLLECTOR_DAY_EXPENSES_KEY,
      [],
    )) {
      if (!row?.ref || remoteExpense.has(row.ref)) continue;
      const d = normalizeHistoryDate(row.date) || row.date;
      // Fuera de ventana del bundle: no tratar como huérfano (evita re-push eterno).
      if (d && d < expenseSince) continue;
      jobs.push({ kind: "day_expense", row, key: row.ref });
    }
    for (const row of readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, [])) {
      if (row?.ref && !remoteMisc.has(row.ref)) {
        jobs.push({ kind: "misc_payment", row, key: row.ref });
      }
    }
    let localCloses: CollectorDayCloseRecord[] | null = null;
    const readCloses = () => (localCloses ??= readLocalDayCloses());
    for (const row of readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, [])) {
      const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
      const key = `${date}::${row.itemId}`;
      // No subir hoja abierta «huérfana» si ya hay CIE- local: reabriría el día en la nube.
      if (localCieCoversAssignment(row, readCloses)) continue;
      if (!row?.itemId || !date) continue;
      const remote = remoteAssignMeta.get(key);
      const localSealed = Boolean(row.dayClosedAt);
      // Historia fuera de ventana: no re-subir como huérfano.
      if (!remote && date < assignSince) continue;
      // Subir si no está en nube, o si este PC ya selló y la nube sigue abierta.
      if (!remote || (localSealed && !remote.closed)) {
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
        if (mirrorRes.ok && shouldDropFromMirrorQueue(json) && !json.skipped) {
          pushed += 1;
        } else if (mirrorRes.ok && shouldDropFromMirrorQueue(json) && json.skipped) {
          // Skip intencional (CIE nube gana): no es fallo de red.
        } else {
          // Dejar en cola para el flush de fondo.
          if (job.kind === "day_close") {
            enqueue(Q_CLOSES, { ref: job.key, ...(job.row as object) } as { ref: string });
          } else if (job.kind === "day_expense") {
            enqueue(Q_EXPENSES, { ref: job.key, ...(job.row as object) } as { ref: string });
          } else if (job.kind === "misc_payment") {
            enqueue(Q_MISC, { ref: job.key, ...(job.row as object) } as { ref: string });
          } else if (job.kind === "assignment") {
            enqueue(Q_ASSIGN, { ref: job.key, ...(job.row as object) } as { ref: string });
          } else if (job.kind === "collector") {
            enqueue(Q_COLLECTORS, { ref: job.key, ...(job.row as object) } as { ref: string });
          } else if (job.kind === "route") {
            enqueue(Q_ROUTES, { ref: job.key, ...(job.row as object) } as { ref: string });
          }
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    emitMirrorQueueChanged();
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
    const body = (await res.json()) as OpsBundleBody;
    if (!res.ok || !body.ok) {
      return { ok: false, changed: false, reason: body.error || `http_${res.status}` };
    }
    if (body.skipped) return { ok: true, changed: false, reason: "skipped", bundle: body };

    const holdMoney = isVirginRemoteHoldActive();
    let changed = false;
    // Lo que no entró al aparato no cuenta como bajado: el monitor lo muestra y el
    // siguiente ciclo vuelve a intentarlo (sin esto el pull decía OK y la pantalla
    // seguía leyendo el CIE viejo del disco).
    const unsaved: string[] = [];
    const persist = (key: string, value: unknown) => {
      if (!writeDemoJson(key, value)) unsaved.push(key);
    };

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
      persist(DEMO_COLLECTORS_KEY, cMerge.merged);
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
    // La nube ya tiene estas rutas: un push posterior solo sube la que cambie de verdad.
    for (const route of routes) sentRouteSig.set(route.ref, routeMirrorSig(route));
    if (rMerge.changed || localRoutes.length !== readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, []).length) {
      persist(DEMO_ROUTES_KEY, rMerge.merged);
      changed = true;
    }

    if (holdMoney) {
      return unsaved.length
        ? { ok: false, changed, reason: unsavedReason(unsaved), bundle: body }
        : { ok: true, changed, reason: "virgin_hold_skip_money", bundle: body };
    }

    const closes = (body.day_closes ?? [])
      .map(rowToDayClose)
      .filter((r): r is CollectorDayCloseRecord => Boolean(r));
    const clMerge = mergeDayClosesRemote(
      readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
      closes,
    );
    if (clMerge.changed) {
      persist(DEMO_COLLECTOR_DAY_CLOSES_KEY, clMerge.merged);
      changed = true;
    }
    // CIE- de nube → PCE-T local (Inicial M = misma cifra en todos los aparatos).
    {
      const before = readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []);
      const projected = projectPceTFromDayCloses(
        ensureManualTLaunchClose(before),
        clMerge.merged,
      );
      const beforeSig = before.map((r) => `${r.ref}:${r.closingCash}`).sort().join("|");
      const afterSig = projected.map((r) => `${r.ref}:${r.closingCash}`).sort().join("|");
      if (beforeSig !== afterSig) {
        persist(DEMO_PLANILLA_CASH_CLOSES_KEY, projected);
        changed = true;
      }
    }

    const expenses = (body.day_expenses ?? [])
      .map(rowToDayExpense)
      .filter((r): r is CollectorDayExpenseDraft => Boolean(r));
    const eMerge = mergeDayExpensesPreferRicher(
      readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
      expenses,
    );
    if (eMerge.changed) {
      persist(DEMO_COLLECTOR_DAY_EXPENSES_KEY, eMerge.merged);
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
      persist(DEMO_MISC_PAYMENTS_KEY, mMerge.merged);
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
    const deletedRefs = readDeletedIdSet();
    for (const row of remoteAssign) {
      const key = `${row.dispatchDate}::${row.itemId}`;
      // Visita abierta de un préstamo dado de baja: no vuelve a la planilla.
      if (
        !row.dayClosedAt &&
        !String(row.paymentRef || "").trim() &&
        isDeletedRef(row.loanRef || "", deletedRefs)
      ) {
        continue;
      }
      // La nube ya tiene esta firma: un push posterior solo sube filas que cambien de verdad.
      // Sin esto, cada "Actualizar planillas" encolaba toda la hoja, la cola escudaba filas
      // sin cambios contra el N/P del cobrador y luego las pisaba en la nube.
      const prev = assignMap.get(key);
      if (!prev) {
        assignMap.set(key, row);
        sentAssignmentSig.set(key, assignmentMirrorSig(row));
        assignChanged = true;
        continue;
      }
      if (sig(prev) === sig(row)) {
        sentAssignmentSig.set(key, assignmentMirrorSig(row));
        continue;
      }
      // Cierre hecho en otro celular: gana siempre. La cola local de hoja "abierta"
      // no puede escudar ese cierre ni volver a subirlo al flush (amigo cerrado / yo abierto).
      const remoteClosedLocalOpen = Boolean(row.dayClosedAt) && !prev.dayClosedAt;
      // N/P u cobro ya en nube: el PC no puede seguir mostrando «por cobrar» por cola
      // de planilla abierta (regen / Actualizar) que escuda el pull.
      const remoteSealedVisit =
        row.visitStatus === "omitido" ||
        row.visitStatus === "cobrado" ||
        Boolean(String(row.paymentRef || "").trim());
      const localOpenVisit =
        (prev.visitStatus === "pendiente" ||
          !prev.visitStatus ||
          prev.visitStatus === "parcial") &&
        !String(prev.paymentRef || "").trim() &&
        !prev.dayClosedAt;
      const remoteSealedLocalOpen = remoteSealedVisit && localOpenVisit;
      if (
        pendingAssign.has(key) &&
        !remoteClosedLocalOpen &&
        !remoteSealedLocalOpen
      ) {
        continue;
      }
      if ((remoteClosedLocalOpen || remoteSealedLocalOpen) && pendingAssign.has(key)) {
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
      sentAssignmentSig.set(key, assignmentMirrorSig(row));
      assignChanged = true;
    }
    // Segunda pasada: N/P y cobros de la nube siempre ganan sobre pendiente local
    // (aunque la primera pasada haya salido por cola u otra guarda).
    for (const row of remoteAssign) {
      const key = `${row.dispatchDate}::${row.itemId}`;
      const prev = assignMap.get(key);
      const remoteSealed =
        row.visitStatus === "omitido" ||
        row.visitStatus === "cobrado" ||
        Boolean(String(row.paymentRef || "").trim());
      if (!remoteSealed) continue;
      if (prev?.dayClosedAt && !row.dayClosedAt) continue;
      const localOpen =
        !prev ||
        ((prev.visitStatus === "pendiente" ||
          !prev.visitStatus ||
          prev.visitStatus === "parcial") &&
          !String(prev.paymentRef || "").trim());
      if (!localOpen && prev && sig(prev) === sig(row)) continue;
      if (!localOpen && prev?.visitStatus === "omitido" && row.visitStatus === "cobrado") {
        // Cobro real gana sobre N/P.
      } else if (!localOpen) {
        continue;
      }
      if (pendingAssign.has(key)) {
        dequeue(Q_ASSIGN, key);
        pendingAssign.delete(key);
      }
      assignMap.set(key, row);
      sentAssignmentSig.set(key, assignmentMirrorSig(row));
      assignChanged = true;
    }
    const stamped = reconcilePaymentsOntoPlanilla(
      [...assignMap.values()],
      readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
    );
    // Si el CIE- ya llegó y la planilla local sigue abierta (cola / flush a medias), sellar.
    const healed = assignmentsInPlanillaWindow(
      applyDayCloseRecordsToAssignments(stamped, clMerge.merged),
    );
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
      persist(DEMO_DAILY_ASSIGNMENTS_KEY, healed);
      changed = true;
    }

    if (unsaved.length) return { ok: false, changed, reason: unsavedReason(unsaved), bundle: body };
    return { ok: true, changed, bundle: body };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      reason: err instanceof Error ? err.message : "ops_pull_failed",
    };
  }
}

export type ForceCloudSyncResult = {
  ok: boolean;
  pushed: number;
  failed: number;
  clearedQueue: number;
  closes: Array<{ ref: string; cashFloat: number; ok: boolean; error?: string }>;
  error?: string;
};

/**
 * Taller PC → nube: pisa `day_closes` (CIE-) con el cash_float local.
 * Usa `/api/ops/force-sync` (service role) y vacía la cola de cierres.
 * No sube PCE- (el esquema solo acepta CIE-).
 */
export async function forcePushLocalDayClosesToCloud(): Promise<ForceCloudSyncResult> {
  if (typeof window === "undefined") {
    return { ok: false, pushed: 0, failed: 0, clearedQueue: 0, closes: [], error: "ssr" };
  }

  const local = readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, [])
    .filter((row) => row?.ref && String(row.ref).startsWith("CIE-") && !row.provisional);

  if (!local.length) {
    return {
      ok: false,
      pushed: 0,
      failed: 0,
      clearedQueue: 0,
      closes: [],
      error: "sin_cie_local",
    };
  }

  try {
    const res = await fetch("/api/ops/force-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        day_closes: local.map((row) => dayCloseToRow(row)),
      }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      error?: string;
      results?: Array<{ ref: string; cash_float?: number; ok: boolean; error?: string }>;
    };
    if (!res.ok || !body.ok) {
      return {
        ok: false,
        pushed: 0,
        failed: local.length,
        clearedQueue: 0,
        closes: [],
        error: body.error || `http_${res.status}`,
      };
    }

    const closes = (body.results ?? []).map((row) => ({
      ref: row.ref,
      cashFloat: Number(row.cash_float) || 0,
      ok: Boolean(row.ok),
      error: row.error,
    }));
    const pushed = closes.filter((row) => row.ok).length;
    const failed = closes.filter((row) => !row.ok).length;

    // Limpiar cola de cierres (conflictos viejos) y alinear PCE-T local al CIE subido.
    const queued = readDemoJson<{ ref: string }[]>(Q_CLOSES, []);
    const clearedQueue = queued.length;
    writeDemoJson(Q_CLOSES, []);
    const projected = projectPceTFromDayCloses(
      ensureManualTLaunchClose(
        readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
      ),
      local,
    );
    writeDemoJson(DEMO_PLANILLA_CASH_CLOSES_KEY, projected);
    emitMirrorQueueChanged();

    // Vaciar resto de colas pendientes (cobros / planilla / etc.).
    try {
      const { flushAllMirrorQueues } = await import("@/lib/supabase/mirror-queue");
      await flushAllMirrorQueues({ attempts: 2 });
    } catch {
      /* el CIE ya fue forzado */
    }

    return {
      ok: failed === 0,
      pushed,
      failed,
      clearedQueue,
      closes,
    };
  } catch (err) {
    return {
      ok: false,
      pushed: 0,
      failed: local.length,
      clearedQueue: 0,
      closes: [],
      error: err instanceof Error ? err.message : "force_sync_failed",
    };
  }
}
