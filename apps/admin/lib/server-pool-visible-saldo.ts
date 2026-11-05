/**
 * Saldo visible Banco / Nequi. Mes sellado → sello (disco / Storage).
 * Mes vivo → sello del mes anterior + delta del mes (cobros desde el 1).
 */
import type { BankAccount } from "@/lib/bank";
import { lastCalendarDayOfPeriod, previousPeriod } from "@/lib/collector-day-close";
import { poolVisibleSaldo } from "@/lib/digital-pools";
import type { InformeMonthSnapshot } from "@/lib/informe-month-snapshot";
import type { MiscPayment } from "@/lib/misc-payments";
import { businessTodayIso } from "@/lib/business-timezone";
import type { CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { ROUTE_CASH_BOOK_FROM } from "@/lib/planilla-cash-chain";
import {
  clearLivePoolSnap,
  readPoolSeal,
  writePoolSeal,
} from "@/lib/pool-seal-store";
import {
  fetchClientsFromSupabase,
  fetchLoansFromSupabase,
  isClientDeletedStatus,
  isLoanDeletedStatus,
  mirrorToClientRow,
  mirrorToLoanRow,
} from "@/lib/supabase/catalog-mirror";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";
import { readInformeSnapshot } from "@/lib/supabase/informe-snapshot-mirror";
import { fetchOpsTable, rowToMisc } from "@/lib/supabase/ops-mirror";
import { fetchPaymentsFromSupabase, mirrorRowToPaymentRow } from "@/lib/supabase/payment-mirror";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

function isoDay(raw: string | undefined, fallback: string): string {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

export type PoolVisibleSaldoResult =
  | {
      ok: true;
      banco: number;
      nequi: number;
      fromIso: string;
      toIso: string;
      openIso?: string;
      openBanco?: number;
      openNequi?: number;
    }
  | { ok: false; error: string };

/** Solo mes sellado (cifra fija). Día vivo: cero TTL — siempre libro fresco. */
const SEALED_CACHE_TTL_MS = 120_000;
const cache = new Map<string, { at: number; result: Extract<PoolVisibleSaldoResult, { ok: true }> }>();

function cacheKey(toIso: string, openIso: string) {
  return `${toIso}|${openIso}`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => value).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function poolLineFromSnapshot(
  snapshot: InformeMonthSnapshot | null | undefined,
  label: "Banco" | "Nequi",
): number | null {
  if (!snapshot) return null;
  for (const row of snapshot.rows) {
    if (row.kind === "line" && row.label === label && Number.isFinite(row.value)) {
      return Math.trunc(Number(row.value));
    }
  }
  return null;
}

async function sealedMonthPools(
  period: string,
): Promise<{ banco: number; nequi: number } | null> {
  const disk = await readPoolSeal(period);
  if (disk) return { banco: disk.banco, nequi: disk.nequi };

  const packed = await withTimeout(
    Promise.all([
      readInformeSnapshot("general", period),
      readInformeSnapshot("angelica", period),
    ]),
    6_000,
  );
  if (!packed) return null;
  const [gen, ang] = packed;
  if (!gen.ok || !ang.ok) return null;
  const banco = poolLineFromSnapshot(gen.snapshot, "Banco");
  const nequi = poolLineFromSnapshot(ang.snapshot, "Nequi");
  if (banco == null || nequi == null) return null;
  void writePoolSeal(period, banco, nequi, lastCalendarDayOfPeriod(period) || undefined);
  return { banco, nequi };
}

async function fetchPaymentsResilient(paymentsFromIso: string) {
  // Primero intento corto; si el frío de Supabase gana, un segundo con más aire.
  const first = await withTimeout(
    fetchPaymentsFromSupabase({ evidence: false, fromDate: paymentsFromIso }),
    10_000,
  );
  if (first?.ok) return first;
  return withTimeout(
    fetchPaymentsFromSupabase({ evidence: false, fromDate: paymentsFromIso }),
    16_000,
  );
}

async function loadPoolShared(paymentsFromIso: string) {
  const pieceMs = 12_000;
  const [paymentsT, clientsT, loansT, miscT, accountsT] = await Promise.all([
    fetchPaymentsResilient(paymentsFromIso),
    withTimeout(fetchClientsFromSupabase(), pieceMs),
    withTimeout(fetchLoansFromSupabase(), pieceMs),
    withTimeout(fetchOpsTable("misc_payments"), pieceMs),
    withTimeout(fetchBankAccountsFromSupabase(), pieceMs),
  ]);
  if (!paymentsT?.ok) {
    return { ok: false as const, error: paymentsT && "error" in paymentsT ? String(paymentsT.error) : "payments_timeout" };
  }
  if (!clientsT?.ok) {
    return { ok: false as const, error: clientsT && "error" in clientsT ? String(clientsT.error) : "clients_timeout" };
  }
  if (!loansT?.ok) {
    return { ok: false as const, error: loansT && "error" in loansT ? String(loansT.error) : "loans_timeout" };
  }
  if (!miscT?.ok) {
    return { ok: false as const, error: "misc_timeout" };
  }
  if (!accountsT?.ok) {
    return { ok: false as const, error: accountsT && "error" in accountsT ? String(accountsT.error) : "accounts_timeout" };
  }

  const payments: PaymentRow[] = (paymentsT.rows ?? [])
    .map(mirrorRowToPaymentRow)
    .filter((row): row is PaymentRow => Boolean(row));
  const clients: ClientRow[] = (clientsT.rows ?? [])
    .map(mirrorToClientRow)
    .filter((row): row is ClientRow => Boolean(row) && !isClientDeletedStatus(row));
  const loans: LoanRow[] = (loansT.rows ?? [])
    .map(mirrorToLoanRow)
    .filter((row): row is LoanRow => Boolean(row) && !isLoanDeletedStatus(row));
  const miscPayments = (miscT.rows ?? [])
    .map(rowToMisc)
    .filter((row): row is MiscPayment => Boolean(row));
  const accounts = accountsT.accounts as BankAccount[];
  const dayCloses: CollectorDayCloseRecord[] = [];
  return {
    ok: true as const,
    shared: { payments, loans, clients, dayCloses, miscPayments, accounts },
  };
}

/**
 * Saldo Banco/Nequi al cierre de `toIso`.
 * Mes sellado (último día) → sello. Cualquier día → sello del mes anterior + movimiento
 * desde el 1 (o desde ROUTE_CASH_BOOK_FROM). Así el Semanal puede pedir `open=` de
 * un día del mes pasado sin quedarse en «Leyendo…».
 */
async function poolBalanceAt(toIso: string): Promise<PoolVisibleSaldoResult | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toIso) || toIso < ROUTE_CASH_BOOK_FROM) {
    return {
      ok: true,
      banco: 0,
      nequi: 0,
      fromIso: ROUTE_CASH_BOOK_FROM,
      toIso,
    };
  }

  const sealedEnd = await sealedPeriodPools(toIso);
  if (sealedEnd?.ok) return sealedEnd;

  const period = toIso.slice(0, 7);
  const monthStart = `${period}-01`;
  const fromIso = monthStart >= ROUTE_CASH_BOOK_FROM ? monthStart : ROUTE_CASH_BOOK_FROM;
  const prev = previousPeriod(period);
  const sealed = await sealedMonthPools(prev);
  // Primer mes del libro sin sello previo: arranca en 0 + movimiento.
  if (!sealed && monthStart > ROUTE_CASH_BOOK_FROM) return null;

  const baseBanco = sealed?.banco ?? 0;
  const baseNequi = sealed?.nequi ?? 0;
  if (toIso < fromIso) {
    return {
      ok: true,
      banco: Math.trunc(baseBanco),
      nequi: Math.trunc(baseNequi),
      fromIso: ROUTE_CASH_BOOK_FROM,
      toIso,
    };
  }

  const loaded = await loadPoolShared(fromIso);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  return {
    ok: true,
    banco: Math.trunc(
      baseBanco + poolVisibleSaldo({ ...loaded.shared, pool: "banco", fromIso, toIso }),
    ),
    nequi: Math.trunc(
      baseNequi + poolVisibleSaldo({ ...loaded.shared, pool: "nequi", fromIso, toIso }),
    ),
    fromIso: ROUTE_CASH_BOOK_FROM,
    toIso,
  };
}

/** Mes vivo (hoy): mismo cálculo; se mantiene el nombre que usa el refresco en fondo. */
async function liveMonthFromSeal(toIso: string): Promise<PoolVisibleSaldoResult | null> {
  const period = toIso.slice(0, 7);
  const todayPeriod = businessTodayIso().slice(0, 7);
  if (period !== todayPeriod) return null;
  return poolBalanceAt(toIso);
}

async function sealedPeriodPools(toIso: string): Promise<PoolVisibleSaldoResult | null> {
  const period = toIso.slice(0, 7);
  const todayPeriod = businessTodayIso().slice(0, 7);
  if (period >= todayPeriod) return null;
  const last = lastCalendarDayOfPeriod(period);
  if (!last || toIso !== last) return null;

  const sealed = await sealedMonthPools(period);
  if (!sealed) return null;
  return {
    ok: true,
    banco: sealed.banco,
    nequi: sealed.nequi,
    fromIso: ROUTE_CASH_BOOK_FROM,
    toIso,
  };
}

export async function readPoolVisibleSaldo(options?: {
  toIso?: string;
  openIso?: string;
}): Promise<PoolVisibleSaldoResult> {
  const today = businessTodayIso();
  const toIso = isoDay(options?.toIso, today);
  const openIso = options?.openIso ? isoDay(options.openIso, "") : "";
  const key = cacheKey(toIso, openIso);
  const hit = cache.get(key);

  if (openIso) {
    // Semanal pide cierre de semana (`to`) + saldo del día previo (`open`),
    // que a menudo cae en el mes anterior: no limitar a liveMonthFromSeal.
    const [liveTo, liveOpen] = await Promise.all([
      poolBalanceAt(toIso),
      poolBalanceAt(openIso),
    ]);
    if (liveTo?.ok && liveOpen?.ok) {
      const result: Extract<PoolVisibleSaldoResult, { ok: true }> = {
        ...liveTo,
        openIso,
        openBanco: liveOpen.banco,
        openNequi: liveOpen.nequi,
      };
      return result;
    }
    const err =
      (liveTo && !liveTo.ok && liveTo.error) ||
      (liveOpen && !liveOpen.ok && liveOpen.error) ||
      "pool_visible_open_unavailable";
    return { ok: false, error: err };
  }

  const sealed = await sealedPeriodPools(toIso);
  if (sealed?.ok) {
    void writePoolSeal(toIso.slice(0, 7), sealed.banco, sealed.nequi, toIso);
    cache.set(key, { at: Date.now(), result: sealed });
    return sealed;
  }

  // Mes sellado en caché corta (cifra fija del sello). Día vivo no entra aquí.
  if (
    hit &&
    Date.now() - hit.at < SEALED_CACHE_TTL_MS &&
    hit.result.toIso === toIso &&
    toIso.slice(0, 7) < today.slice(0, 7)
  ) {
    return hit.result;
  }

  // Día vivo: siempre libro fresco. Prohibido devolver pool-live.json /
  // memoria vieja mientras “refresca atrás” (caso 6.766 vs 7.013).
  void clearLivePoolSnap();
  cache.delete(key);
  const live = await liveMonthFromSeal(toIso);
  if (live?.ok) return live;
  if (live && !live.ok) return live;
  return { ok: false, error: "pool_visible_unavailable" };
}
