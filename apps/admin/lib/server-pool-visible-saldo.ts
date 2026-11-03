/**
 * Saldo visible Banco / Nequi (M+T+N−Gastos / A−Gastos) calculado en el servidor.
 * Mes sellado → lee el sello (con tope). Mes vivo → sello del mes anterior + delta.
 * Tope duro: nunca deja la petición colgada (el Saldo en «…» eterno).
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

const CACHE_TTL_MS = 90_000;
const SEAL_TTL_MS = 6 * 60 * 60_000;
const cache = new Map<string, { at: number; result: Extract<PoolVisibleSaldoResult, { ok: true }> }>();
const sealCache = new Map<string, { at: number; banco: number; nequi: number }>();

function cacheKey(toIso: string, openIso: string) {
  return `${toIso}|${openIso}`;
}

function rememberSeal(period: string, banco: number, nequi: number) {
  sealCache.set(period, { at: Date.now(), banco, nequi });
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
  const warm = sealCache.get(period);
  if (warm && Date.now() - warm.at < SEAL_TTL_MS) {
    return { banco: warm.banco, nequi: warm.nequi };
  }
  const [gen, ang] = await Promise.all([
    readInformeSnapshot("general", period),
    readInformeSnapshot("angelica", period),
  ]);
  if (!gen.ok || !ang.ok) return null;
  const banco = poolLineFromSnapshot(gen.snapshot, "Banco");
  const nequi = poolLineFromSnapshot(ang.snapshot, "Nequi");
  if (banco == null || nequi == null) return null;
  rememberSeal(period, banco, nequi);
  return { banco, nequi };
}

/**
 * Solo lo que suma `poolVisibleSaldo` (cobros desde `paymentsFromIso` + catálogo +
 * misc/cuentas). Sin planilla/cierres/gastos de ruta: eso colgaba el Saldo vivo.
 */
async function loadPoolShared(paymentsFromIso: string) {
  const [paymentsT, clientsT, loansT, miscT, accountsT] = await Promise.all([
    fetchPaymentsFromSupabase({ evidence: false, fromDate: paymentsFromIso }),
    fetchClientsFromSupabase(),
    fetchLoansFromSupabase(),
    fetchOpsTable("misc_payments"),
    fetchBankAccountsFromSupabase(),
  ]);
  if (!paymentsT.ok) {
    return { ok: false as const, error: paymentsT.error || "payments_fetch_failed" };
  }
  if (!clientsT.ok) {
    return { ok: false as const, error: clientsT.error || "clients_fetch_failed" };
  }
  if (!loansT.ok) {
    return { ok: false as const, error: loansT.error || "loans_fetch_failed" };
  }
  if (!miscT.ok) {
    return {
      ok: false as const,
      error: `misc_payments: ${"error" in miscT ? miscT.error : "fetch_failed"}`,
    };
  }
  if (!accountsT.ok) return { ok: false as const, error: accountsT.error };

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

/** Mes vivo: sello del mes anterior + neto del mes (cobros solo desde el 1). */
async function liveMonthFromSeal(toIso: string): Promise<PoolVisibleSaldoResult | null> {
  const period = toIso.slice(0, 7);
  const todayPeriod = businessTodayIso().slice(0, 7);
  if (period !== todayPeriod) return null;

  const prev = previousPeriod(period);
  const sealed = await withTimeout(sealedMonthPools(prev), 5_000);
  if (!sealed) return null;

  const monthStart = `${period}-01`;
  const fromIso = monthStart >= ROUTE_CASH_BOOK_FROM ? monthStart : ROUTE_CASH_BOOK_FROM;
  const loaded = await withTimeout(loadPoolShared(fromIso), 12_000);
  if (!loaded?.ok) return loaded && !loaded.ok ? loaded : null;

  const deltaBanco = poolVisibleSaldo({
    ...loaded.shared,
    pool: "banco",
    fromIso,
    toIso,
  });
  const deltaNequi = poolVisibleSaldo({
    ...loaded.shared,
    pool: "nequi",
    fromIso,
    toIso,
  });

  return {
    ok: true,
    banco: Math.trunc(sealed.banco + deltaBanco),
    nequi: Math.trunc(sealed.nequi + deltaNequi),
    fromIso: ROUTE_CASH_BOOK_FROM,
    toIso,
  };
}

async function sealedPeriodPools(toIso: string): Promise<PoolVisibleSaldoResult | null> {
  const period = toIso.slice(0, 7);
  const todayPeriod = businessTodayIso().slice(0, 7);
  if (period >= todayPeriod) return null;
  const last = lastCalendarDayOfPeriod(period);
  if (!last || toIso !== last) return null;

  const sealed = await withTimeout(sealedMonthPools(period), 6_000);
  if (!sealed) return null;
  return {
    ok: true,
    banco: sealed.banco,
    nequi: sealed.nequi,
    fromIso: ROUTE_CASH_BOOK_FROM,
    toIso,
  };
}

async function fullBookPools(
  toIso: string,
  openIso: string,
): Promise<PoolVisibleSaldoResult> {
  const fromIso = ROUTE_CASH_BOOK_FROM;
  const loaded = await loadPoolShared(fromIso);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const shared = { ...loaded.shared, fromIso };
  const result: Extract<PoolVisibleSaldoResult, { ok: true }> = {
    ok: true,
    banco: poolVisibleSaldo({ ...shared, pool: "banco", toIso }),
    nequi: poolVisibleSaldo({ ...shared, pool: "nequi", toIso }),
    fromIso,
    toIso,
  };

  if (openIso) {
    result.openIso = openIso;
    result.openBanco = poolVisibleSaldo({ ...shared, pool: "banco", toIso: openIso });
    result.openNequi = poolVisibleSaldo({ ...shared, pool: "nequi", toIso: openIso });
  }
  return result;
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
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  // Semanal (openIso): una bajada; con tope para no colgar el worker.
  if (openIso) {
    const full = await withTimeout(fullBookPools(toIso, openIso), 45_000);
    if (full?.ok) {
      cache.set(key, { at: Date.now(), result: full });
      return full;
    }
    if (hit) return hit.result;
    return { ok: false, error: full && !full.ok ? full.error : "pool_visible_timeout" };
  }

  const sealed = await sealedPeriodPools(toIso);
  if (sealed?.ok) {
    rememberSeal(toIso.slice(0, 7), sealed.banco, sealed.nequi);
    cache.set(key, { at: Date.now(), result: sealed });
    return sealed;
  }

  const live = await liveMonthFromSeal(toIso);
  if (live?.ok) {
    cache.set(key, { at: Date.now(), result: live });
    return live;
  }
  if (live && !live.ok) return live;

  // Sin sello / sin delta: NO bajar el libro entero (cuelga el worker). Caché o error corto.
  if (hit) return hit.result;
  return { ok: false, error: "pool_visible_unavailable" };
}
