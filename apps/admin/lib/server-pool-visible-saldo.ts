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

export type PoolVisibleSaldoResult =
  | {
      ok: true;
      banco: number;
      nequi: number;
      fromIso: string;
      toIso: string;
    }
  | { ok: false; error: string };

export async function readPoolVisibleSaldo(options?: {
  toIso?: string;
}): Promise<PoolVisibleSaldoResult> {
  const toIso = options?.toIso && /^\d{4}-\d{2}-\d{2}$/.test(options.toIso)
    ? options.toIso
    : businessTodayIso();
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
    toIso,
  };

  return {
    ok: true,
    banco: poolVisibleSaldo({ ...shared, pool: "banco" }),
    nequi: poolVisibleSaldo({ ...shared, pool: "nequi" }),
    fromIso,
    toIso,
  };
}
