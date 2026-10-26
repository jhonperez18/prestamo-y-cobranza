/**
 * El supervisor lee la base. La copia del celular no arma otra cifra.
 * Cobros: desde el libro (01/10) hasta hoy. Gastos de Banco: los PV- de la nube.
 * Lo que está en cola (aún no subió) se conserva.
 */
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { businessTodayIso } from "@/lib/business-timezone";
import {
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";
import type { MiscPayment } from "@/lib/misc-payments";
import type { PaymentRow } from "@/lib/mock-data";
import { ROUTE_CASH_BOOK_FROM } from "@/lib/planilla-cash-chain";
import {
  DEMO_PAYMENT_MIRROR_QUEUE_KEY,
  mirrorRowToPaymentRow,
  type PaymentMirrorRow,
} from "@/lib/supabase/payment-mirror";

const MISC_QUEUE_KEY = "nexo-demo-ops-misc-queue";

/** Cada lado, una vez por apertura. Si uno falla, el siguiente ciclo reintenta solo ese. */
let paymentsLoadedThisOpen = false;
let miscLoadedThisOpen = false;

export type SupervisorBook = {
  payments: PaymentRow[];
  misc: MiscPayment[];
};

function payDay(row: PaymentRow): string {
  return normalizeHistoryDate(row.paidDate || "") || String(row.paidDate || "").slice(0, 10);
}

function queuedPayments(): PaymentRow[] {
  return readDemoJson<PaymentRow[]>(DEMO_PAYMENT_MIRROR_QUEUE_KEY, []).filter((row) => row?.ref);
}

function queuedMisc(): MiscPayment[] {
  return readDemoJson<MiscPayment[]>(MISC_QUEUE_KEY, []).filter((row) => row?.ref && row.paidDate);
}

const BOOK_DAY_KEY = "nexo-supervisor-book-day";

export async function loadSupervisorBookFromCloud(): Promise<SupervisorBook | null> {
  if (typeof window === "undefined" || (paymentsLoadedThisOpen && miscLoadedThisOpen)) return null;
  const today = businessTodayIso();
  let bookDay = "";
  try {
    bookDay = localStorage.getItem(BOOK_DAY_KEY) || "";
  } catch {
    bookDay = "";
  }
  if (bookDay === today && readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []).length > 0) {
    paymentsLoadedThisOpen = true;
  }
  const [payRes, miscRes] = await Promise.all([
    paymentsLoadedThisOpen
      ? Promise.resolve(null)
      : fetch(
          `/api/payments?fromDate=${encodeURIComponent(ROUTE_CASH_BOOK_FROM)}&toDate=${encodeURIComponent(today)}`,
          { cache: "no-store" },
        ),
    miscLoadedThisOpen
      ? Promise.resolve(null)
      : fetch("/api/ops/misc-payments", { cache: "no-store" }),
  ]);
  let payments: PaymentRow[] | null = null;
  let misc: MiscPayment[] | null = null;
  try {
    if (payRes && payRes.ok) {
      const body = (await payRes.json()) as {
        ok?: boolean;
        skipped?: boolean;
        payments?: PaymentMirrorRow[];
      };
      if (body.ok && !body.skipped && Array.isArray(body.payments) && body.payments.length > 0) {
        payments = body.payments
          .map((row) => mirrorRowToPaymentRow(row))
          .filter((row): row is PaymentRow => Boolean(row));
        if (payments.length === 0) payments = null;
      }
    }
  } catch (error) {
    console.error("supervisor-book-payments", error);
  }
  try {
    if (miscRes && miscRes.ok) {
      const body = (await miscRes.json()) as { ok?: boolean; skipped?: boolean; rows?: MiscPayment[] };
      if (body.ok && !body.skipped && Array.isArray(body.rows) && body.rows.length > 0) {
        misc = body.rows.filter((row) => row?.ref);
        if (misc.length === 0) misc = null;
      }
    }
  } catch (error) {
    console.error("supervisor-book-misc", error);
  }
  if (!payments && !misc) return null;

  const localPayments = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const nextPayments = payments
    ? mergeBookPayments(localPayments, payments, queuedPayments())
    : localPayments;
  const nextMisc = misc ? mergeBookMisc(misc, queuedMisc()) : readDemoJson<MiscPayment[]>(DEMO_MISC_PAYMENTS_KEY, []);

  if (payments) {
    writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments);
    paymentsLoadedThisOpen = true;
    try {
      localStorage.setItem(BOOK_DAY_KEY, today);
    } catch {
      /* el día siguiente lo vuelve a bajar */
    }
  }
  if (misc) {
    writeDemoJson(DEMO_MISC_PAYMENTS_KEY, nextMisc);
    miscLoadedThisOpen = true;
  }
  return { payments: nextPayments, misc: nextMisc };
}

function mergeBookPayments(
  local: PaymentRow[],
  remote: PaymentRow[],
  queued: PaymentRow[],
): PaymentRow[] {
  const remoteRefs = new Set(remote.map((row) => row.ref));
  const queuedRefs = new Set(queued.map((row) => row.ref));
  const before = local.filter((row) => {
    const day = payDay(row);
    return !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < ROUTE_CASH_BOOK_FROM;
  });
  const pending = queued.filter((row) => !remoteRefs.has(row.ref));
  const seen = new Set<string>();
  const merged: PaymentRow[] = [];
  for (const row of [...before, ...remote, ...pending]) {
    if (!row.ref || seen.has(row.ref)) continue;
    if (queuedRefs.has(row.ref)) {
      const fresh = queued.find((item) => item.ref === row.ref);
      merged.push(fresh ?? row);
    } else {
      merged.push(row);
    }
    seen.add(row.ref);
  }
  return merged;
}

let historyPaymentsCache: PaymentRow[] | null = null;
let historyPaymentsDay = "";

/**
 * Cobros del libro (desde el 01/10) para el Historial del supervisor.
 * No escribe el disco ni la cola. Si el libro de hoy ya está en el aparato, lo reutiliza.
 */
export async function loadSupervisorHistoryPayments(): Promise<PaymentRow[] | null> {
  if (typeof window === "undefined") return null;
  const today = businessTodayIso();
  if (historyPaymentsCache && historyPaymentsDay === today) return historyPaymentsCache;
  if (paymentsLoadedThisOpen) {
    let bookDay = "";
    try {
      bookDay = localStorage.getItem(BOOK_DAY_KEY) || "";
    } catch {
      bookDay = "";
    }
    if (bookDay === today) {
      const stored = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []).filter((row) => row?.ref);
      if (stored.length > 0) {
        historyPaymentsCache = stored;
        historyPaymentsDay = today;
        return stored;
      }
    }
  }
  try {
    const res = await fetch(
      `/api/payments?fromDate=${encodeURIComponent(ROUTE_CASH_BOOK_FROM)}&toDate=${encodeURIComponent(today)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      payments?: PaymentMirrorRow[];
    };
    if (!body.ok || body.skipped || !Array.isArray(body.payments) || body.payments.length === 0) {
      return null;
    }
    const rows = body.payments
      .map((row) => mirrorRowToPaymentRow(row))
      .filter((row): row is PaymentRow => Boolean(row));
    if (rows.length === 0) return null;
    historyPaymentsCache = rows;
    historyPaymentsDay = today;
    return rows;
  } catch (error) {
    console.error("supervisor-history-payments", error);
    return null;
  }
}

function mergeBookMisc(remote: MiscPayment[], queued: MiscPayment[]): MiscPayment[] {
  const remoteRefs = new Set(remote.map((row) => row.ref));
  const pending = queued.filter((row) => !remoteRefs.has(row.ref));
  const byQueued = new Map(queued.map((row) => [row.ref, row]));
  return [...remote.map((row) => byQueued.get(row.ref) ?? row), ...pending];
}
