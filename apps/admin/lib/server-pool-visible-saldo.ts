/**
 * Saldo visible Banco / Nequi (M+T+N−Gastos / A−Gastos) calculado en el servidor
 * con el libro completo desde ROUTE_CASH_BOOK_FROM. Una sola cifra para app, Informe y correo.
 */
import type { BankAccount } from "@/lib/bank";
import { poolVisibleSaldo } from "@/lib/digital-pools";
import type { MiscPayment } from "@/lib/misc-payments";
import { businessTodayIso } from "@/lib/business-timezone";
import { ROUTE_CASH_BOOK_FROM } from "@/lib/planilla-cash-chain";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";
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
      /** Si pidieron `openIso`: saldo al cierre de ese día (Inicio de semana). */
      openIso?: string;
      openBanco?: number;
      openNequi?: number;
    }
  | { ok: false; error: string };

export async function readPoolVisibleSaldo(options?: {
  toIso?: string;
  /** Segundo corte en la misma bajada (p. ej. víspera del inicio de semana). */
  openIso?: string;
}): Promise<PoolVisibleSaldoResult> {
  const today = businessTodayIso();
  const toIso = isoDay(options?.toIso, today);
  const openIso = options?.openIso ? isoDay(options.openIso, "") : "";
  const fromIso = ROUTE_CASH_BOOK_FROM;

  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const [miscT, accountsT] = await Promise.all([
    fetchOpsTable("misc_payments"),
    fetchBankAccountsFromSupabase(),
  ]);
  if (!miscT.ok) {
    return {
      ok: false,
      error: `misc_payments: ${"error" in miscT ? miscT.error : "fetch_failed"}`,
    };
  }
  if (!accountsT.ok) return { ok: false, error: accountsT.error };

  const miscPayments = (miscT.rows ?? [])
    .map(rowToMisc)
    .filter((row): row is MiscPayment => Boolean(row));
  const accounts = accountsT.accounts as BankAccount[];
  const shared = {
    payments: loaded.state.payments,
    loans: loaded.state.loans,
    clients: loaded.state.clients,
    dayCloses: loaded.state.dayCloses,
    miscPayments,
    accounts,
    fromIso,
  };

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
