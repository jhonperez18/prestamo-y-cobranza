/**
 * El supervisor lee la base. La copia del celular no arma otra cifra.
 * Ciclo vivo: no guarda el libro de cobros (01/10→hoy) en disco.
 * Historial: cobros del período pedido solo en RAM; al salir se sueltan.
 * Gastos Banco (PV-): catálogo chico, sí puede vivir en el aparato.
 */
import {
  collectorLiveDayIso,
  isSupervisorLiveDevice,
  supervisorLiveFromIso,
} from "@/lib/collector-live-window";
import {
  normalizeHistoryDate,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import type { MiscPayment } from "@/lib/misc-payments";
import type { PaymentRow } from "@/lib/mock-data";
import { ROUTE_CASH_BOOK_FROM } from "@/lib/planilla-cash-chain";
import { mirrorRowToPaymentRow, type PaymentMirrorRow } from "@/lib/supabase/payment-mirror";

const MISC_QUEUE_KEY = "nexo-demo-ops-misc-queue";
const PAY_QUEUE_KEY = "nexo-demo-payment-mirror-queue";
const ASSIGN_QUEUE_KEY = "nexo-demo-ops-assignments-queue";
const EXPENSE_QUEUE_KEY = "nexo-demo-ops-day-expenses-queue";

/** Una vez por apertura: PV- de Banco. Los cobros históricos ya no se bajan aquí. */
let miscLoadedThisOpen = false;

export type SupervisorBook = {
  payments: PaymentRow[];
  misc: MiscPayment[];
};

function queuedMisc(): MiscPayment[] {
  return readDemoJson<MiscPayment[]>(MISC_QUEUE_KEY, []).filter((row) => row?.ref && row.paidDate);
}

/**
 * Solo misc (PV-). Ya no escribe el libro de cobros en DEMO_PAYMENTS_KEY
 * (eso hinchaba IDB y la salida Supabase en cada apertura del supervisor).
 */
export async function loadSupervisorBookFromCloud(): Promise<SupervisorBook | null> {
  if (typeof window === "undefined" || miscLoadedThisOpen) return null;
  let misc: MiscPayment[] | null = null;
  try {
    const miscRes = await fetch("/api/ops/misc-payments", { cache: "no-store" });
    if (miscRes.ok) {
      const body = (await miscRes.json()) as { ok?: boolean; skipped?: boolean; rows?: MiscPayment[] };
      if (body.ok && !body.skipped && Array.isArray(body.rows) && body.rows.length > 0) {
        misc = body.rows.filter((row) => row?.ref);
        if (misc.length === 0) misc = null;
      }
    }
  } catch (error) {
    console.error("supervisor-book-misc", error);
  }
  if (!misc) return null;

  const nextMisc = mergeBookMisc(misc, queuedMisc());
  writeDemoJson(DEMO_MISC_PAYMENTS_KEY, nextMisc);
  miscLoadedThisOpen = true;
  return {
    payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
    misc: nextMisc,
  };
}

let historyPaymentsCache: PaymentRow[] | null = null;
let historyPaymentsKey = "";

/**
 * Cobros de un período (mes / rango) para Historial del supervisor.
 * Solo RAM: no escribe disco ni cola. Al cambiar de período o salir, el caller limpia.
 */
export async function loadSupervisorHistoryPayments(
  fromDate?: string,
  toDate?: string,
): Promise<PaymentRow[] | null> {
  if (typeof window === "undefined") return null;
  const from =
    fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && fromDate >= ROUTE_CASH_BOOK_FROM
      ? fromDate
      : ROUTE_CASH_BOOK_FROM;
  const to = toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate) ? toDate : from;
  if (to < from) return null;
  const cacheKey = `${from}|${to}`;
  if (historyPaymentsCache && historyPaymentsKey === cacheKey) return historyPaymentsCache;
  try {
    const res = await fetch(
      `/api/payments?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      payments?: PaymentMirrorRow[];
    };
    if (!body.ok || body.skipped || !Array.isArray(body.payments)) {
      return null;
    }
    const rows = body.payments
      .map((row) => mirrorRowToPaymentRow(row))
      .filter((row): row is PaymentRow => Boolean(row))
      .filter((row) => {
        const day = normalizeHistoryDate(row.paidDate || "") || String(row.paidDate || "").slice(0, 10);
        return day >= from && day <= to;
      });
    historyPaymentsCache = rows;
    historyPaymentsKey = cacheKey;
    return rows;
  } catch (error) {
    console.error("supervisor-history-payments", error);
    return null;
  }
}

/** Suelta la caché RAM del historial (al salir de Historial / desmontar). */
export function clearSupervisorHistoryPaymentsCache(): void {
  historyPaymentsCache = null;
  historyPaymentsKey = "";
}

/**
 * Libro que pinta BANCO / NEQUI / historial.
 * Dueño: la bajada del período. El día oficial pisa lo de hoy.
 * La copia del disco no entra. Solo se suma un cobro que aún está en la cola.
 */
export function supervisorPeriodBook(
  history: readonly PaymentRow[] | null,
  today: string,
  todayOfficial: readonly PaymentRow[],
): PaymentRow[] | null {
  if (history == null) return null;
  const byRef = new Map<string, PaymentRow>();
  for (const row of history) {
    if (row.ref) byRef.set(row.ref, row);
  }
  if (todayOfficial.length > 0) {
    for (const [ref, row] of byRef) {
      const day =
        normalizeHistoryDate(row.paidDate || "") || String(row.paidDate || "").slice(0, 10);
      if (day === today) byRef.delete(ref);
    }
    for (const row of todayOfficial) {
      if (row.ref) byRef.set(row.ref, row);
    }
  }
  for (const row of readDemoJson<PaymentRow[]>(PAY_QUEUE_KEY, [])) {
    if (!row?.ref || byRef.has(row.ref)) continue;
    byRef.set(row.ref, row);
  }
  return [...byRef.values()];
}

/**
 * Cobros que pinta el supervisor. La bajada de hoy es la lista.
 * Un cobro solo local entra si sigue en la cola. Lo de días anteriores se queda
 * en la ventana viva (ayer); no se rellena hoy con una copia que la base no tiene.
 */
export function supervisorTodayPayments(
  local: readonly PaymentRow[],
  official: readonly PaymentRow[] | null,
  today: string,
): PaymentRow[] {
  if (!official) return [...local];
  const older = local.filter((row) => {
    const day = normalizeHistoryDate(row.paidDate || "") || String(row.paidDate || "").slice(0, 10);
    return day !== today;
  });
  const seen = new Set(older.map((row) => row.ref).filter(Boolean));
  const byRef = new Map<string, PaymentRow>();
  for (const row of official) {
    if (!row.ref || seen.has(row.ref)) continue;
    byRef.set(row.ref, row);
  }
  for (const row of readDemoJson<PaymentRow[]>(PAY_QUEUE_KEY, [])) {
    if (!row?.ref || byRef.has(row.ref) || seen.has(row.ref)) continue;
    byRef.set(row.ref, row);
  }
  return [...older, ...byRef.values()];
}

function expenseDraftRichness(row: CollectorDayExpenseDraft) {
  const total = Number(row.expensesTotal) || 0;
  const lines = Array.isArray(row.expenses) ? row.expenses.length : 0;
  const prestamos = Array.isArray(row.expenses)
    ? row.expenses.filter(
        (line) => line.category === "prestamo_ruta" || line.id === "prestamo",
      ).length
    : 0;
  const at = Date.parse(String(row.updatedAt || "")) || 0;
  return { total, lines, prestamos, at };
}

/** Gana el que trae más desembolsos / total (un pull viejo no borra Préstamos). */
function preferRicherExpenseDraft(
  prev: CollectorDayExpenseDraft,
  next: CollectorDayExpenseDraft,
): boolean {
  const a = expenseDraftRichness(prev);
  const b = expenseDraftRichness(next);
  if (b.prestamos !== a.prestamos) return b.prestamos > a.prestamos;
  if (b.total !== a.total) return b.total > a.total;
  if (b.lines !== a.lines) return b.lines > a.lines;
  return b.at >= a.at;
}

/**
 * Gastos de hoy del supervisor. La bajada es la lista.
 * Uno solo local entra si sigue en la cola. Los días anteriores de la ventana se quedan.
 * Un official vacío o más pobre no borra desembolsos locales (lista Préstamos en 0).
 */
export function supervisorTodayExpenses(
  local: readonly CollectorDayExpenseDraft[],
  official: readonly CollectorDayExpenseDraft[] | null,
  today: string,
): CollectorDayExpenseDraft[] {
  if (!official) return [...local];
  const older = local.filter((row) => row.date !== today);
  const seen = new Set(older.map((row) => row.ref).filter(Boolean));
  const byRef = new Map<string, CollectorDayExpenseDraft>();
  for (const row of local) {
    if (!row?.ref || row.date !== today || seen.has(row.ref)) continue;
    byRef.set(row.ref, row);
  }
  for (const row of official) {
    if (!row.ref || seen.has(row.ref)) continue;
    const prev = byRef.get(row.ref);
    if (!prev || preferRicherExpenseDraft(prev, row)) byRef.set(row.ref, row);
  }
  for (const row of readDemoJson<CollectorDayExpenseDraft[]>(EXPENSE_QUEUE_KEY, [])) {
    if (!row?.ref || seen.has(row.ref)) continue;
    const prev = byRef.get(row.ref);
    if (!prev || preferRicherExpenseDraft(prev, row)) byRef.set(row.ref, row);
  }
  return [...older, ...byRef.values()];
}

/**
 * Hoja de hoy del supervisor. Si la base ya mandó visitas, esas son la hoja.
 * Una visita solo local entra si sigue en la cola. El resto (Prestar fantasma,
 * fila vieja) no se pinta. Sin bajada, se deja la copia: la red pudo fallar.
 */
export function supervisorTodaySheet(
  local: readonly DailyCollectionAssignment[],
  official: readonly DailyCollectionAssignment[] | null,
  today: string,
): DailyCollectionAssignment[] {
  if (!official || official.length === 0) return [...local];
  const queued = new Set<string>();
  for (const row of readDemoJson<{ ref?: string; itemId?: string; dispatchDate?: string }[]>(
    ASSIGN_QUEUE_KEY,
    [],
  )) {
    if (row.ref) queued.add(row.ref);
    if (row.itemId) queued.add(row.itemId);
    if (row.dispatchDate && row.itemId) queued.add(`${row.dispatchDate}::${row.itemId}`);
  }
  const older = local.filter((row) => row.dispatchDate !== today);
  const byKey = new Map<string, DailyCollectionAssignment>();
  for (const row of official) {
    if (!row.itemId) continue;
    const date = row.dispatchDate || today;
    byKey.set(`${date}::${row.itemId}`, row);
  }
  for (const row of local) {
    if (row.dispatchDate !== today || !row.itemId) continue;
    const key = `${today}::${row.itemId}`;
    if (byKey.has(key)) continue;
    if (queued.has(key) || queued.has(row.itemId)) byKey.set(key, row);
  }
  return [...older, ...byKey.values()];
}

/**
 * Poda inmediata del disco del supervisor a hoy+ayer.
 * No toca colas. No pide red. Así un celular gordo adelgaza en la 1.ª sync
 * sin esperar la completa horaria.
 */
export function trimSupervisorLiveLocalCache(): boolean {
  if (typeof window === "undefined" || !isSupervisorLiveDevice()) return false;
  const from = supervisorLiveFromIso();
  const to = collectorLiveDayIso();
  let changed = false;

  const queuedPay = new Set(
    readDemoJson<{ ref?: string }[]>(PAY_QUEUE_KEY, [])
      .map((row) => row.ref)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const payments = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const nextPay = payments.filter((row) => {
    if (!row?.ref) return false;
    if (queuedPay.has(row.ref)) return true;
    const day = normalizeHistoryDate(row.paidDate || "") || String(row.paidDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
    return day >= from && day <= to;
  });
  if (nextPay.length !== payments.length) {
    writeDemoJson(DEMO_PAYMENTS_KEY, nextPay);
    changed = true;
  }

  const queuedAssign = new Set(
    readDemoJson<{ ref?: string }[]>(ASSIGN_QUEUE_KEY, [])
      .map((row) => row.ref)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const assigns = readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []);
  const nextAssign = assigns.filter((row) => {
    const key = `${row.dispatchDate}::${row.itemId}`;
    if (queuedAssign.has(key) || queuedAssign.has(row.itemId)) return true;
    const day = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
    return day >= from && day <= to;
  });
  if (nextAssign.length !== assigns.length) {
    writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, nextAssign);
    changed = true;
  }

  const queuedExpense = new Set(
    readDemoJson<{ ref?: string }[]>(EXPENSE_QUEUE_KEY, [])
      .map((row) => row.ref)
      .filter((ref): ref is string => Boolean(ref)),
  );
  const expenses = readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []);
  const nextExpense = expenses.filter((row) => {
    if (queuedExpense.has(row.ref)) return true;
    const day = normalizeHistoryDate(row.date) || row.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true;
    return day >= from && day <= to;
  });
  if (nextExpense.length !== expenses.length) {
    writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, nextExpense);
    changed = true;
  }

  return changed;
}

function mergeBookMisc(remote: MiscPayment[], queued: MiscPayment[]): MiscPayment[] {
  const remoteRefs = new Set(remote.map((row) => row.ref));
  const pending = queued.filter((row) => !remoteRefs.has(row.ref));
  const byQueued = new Map(queued.map((row) => [row.ref, row]));
  return [...remote.map((row) => byQueued.get(row.ref) ?? row), ...pending];
}
