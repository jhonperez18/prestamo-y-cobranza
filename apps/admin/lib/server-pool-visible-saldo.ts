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
import { ROUTE_CASH_BOOK_FROM } from "@/lib/planilla-cash-chain";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";
import { readInformeSnapshot } from "@/lib/supabase/informe-snapshot-mirror";
import { fetchOpsTable, rowToMisc } from "@/lib/supabase/ops-mirror";

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
  const [gen, ang] = await Promise.all([
    readInformeSnapshot("general", period),
    readInformeSnapshot("angelica", period),
  ]);
  if (!gen.ok || !ang.ok) return null;
  const banco = poolLineFromSnapshot(gen.snapshot, "Banco");
  const nequi = poolLineFromSnapshot(ang.snapshot, "Nequi");
  if (banco == null || nequi == null) return null;
  return { banco, nequi };
}

async function loadPoolShared(paymentsFromIso: string) {
  const loaded = await loadOperationalStateFromCloud({ paymentsFromIso });
  if (!loaded.ok) return { ok: false as const, error: loaded.error };

  const [miscT, accountsT] = await Promise.all([
    fetchOpsTable("misc_payments"),
    fetchBankAccountsFromSupabase(),
  ]);
  if (!miscT.ok) {
    return {
      ok: false as const,
      error: `misc_payments: ${"error" in miscT ? miscT.error : "fetch_failed"}`,
    };
  }
  if (!accountsT.ok) return { ok: false as const, error: accountsT.error };

  const miscPayments = (miscT.rows ?? [])
    .map(rowToMisc)
    .filter((row): row is MiscPayment => Boolean(row));
  const accounts = accountsT.accounts as BankAccount[];
  return {
    ok: true as const,
    shared: {
      payments: loaded.state.payments,
      loans: loaded.state.loans,
      clients: loaded.state.clients,
      dayCloses: loaded.state.dayCloses,
      miscPayments,
      accounts,
    },
  };
}

/** Mes vivo: sello del mes anterior + neto del mes (cobros solo desde el 1). */
async function liveMonthFromSeal(toIso: string): Promise<PoolVisibleSaldoResult | null> {
  const period = toIso.slice(0, 7);
  const todayPeriod = businessTodayIso().slice(0, 7);
  if (period !== todayPeriod) return null;

  const prev = previousPeriod(period);
  const sealed = await withTimeout(sealedMonthPools(prev), 6_000);
  if (!sealed) return null;

  const monthStart = `${period}-01`;
  const fromIso = monthStart >= ROUTE_CASH_BOOK_FROM ? monthStart : ROUTE_CASH_BOOK_FROM;
  const loaded = await withTimeout(loadPoolShared(fromIso), 20_000);
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
    cache.set(key, { at: Date.now(), result: sealed });
    return sealed;
  }

  const live = await liveMonthFromSeal(toIso);
  if (live?.ok) {
    cache.set(key, { at: Date.now(), result: live });
    return live;
  }
  if (live && !live.ok) return live;

  // Último recurso: libro desde ROUTE_CASH_BOOK_FROM, con tope (no «…» eterno).
  const full = await withTimeout(fullBookPools(toIso, ""), 25_000);
  if (full?.ok) {
    cache.set(key, { at: Date.now(), result: full });
    return full;
  }
  if (hit) return hit.result;
  return { ok: false, error: full && !full.ok ? full.error : "pool_visible_timeout" };
}
