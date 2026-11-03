/**
 * Saldo Nequi de la ruta A — misma puerta que BANCO/NEQUI e INFORME:
 * `poolVisibleSaldo` (A − gastos) con el libro completo.
 * Prohibido anclas de cuadre del pool o la RPC vieja de saldos (cifras distintas = datos dobles).
 */
import { digitalPoolSaldo } from "@/lib/digital-pools";
import type { BankAccount } from "@/lib/bank";
import type { MiscPayment } from "@/lib/misc-payments";
import { businessTodayIso } from "@/lib/business-timezone";
import { ROUTE_CASH_BOOK_FROM } from "@/lib/planilla-cash-chain";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";
import { fetchOpsTable, rowToMisc } from "@/lib/supabase/ops-mirror";

export type NequiSaldoResult =
  | { ok: true; cobrado: number; prestado: number; gastos: number; saldo: number }
  | { ok: false; error: string };

export async function readNequiSaldo(): Promise<NequiSaldoResult> {
  const toIso = businessTodayIso();
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
  const detail = digitalPoolSaldo({
    pool: "nequi",
    payments: loaded.state.payments,
    loans: loaded.state.loans,
    clients: loaded.state.clients,
    dayCloses: loaded.state.dayCloses,
    miscPayments,
    accounts,
    fromIso: ROUTE_CASH_BOOK_FROM,
    toIso,
  });
  // `rutas` = cobrado neto − capital prestado (misma suma que el Saldo).
  return {
    ok: true,
    cobrado: detail.rutas,
    prestado: 0,
    gastos: detail.gastos,
    saldo: detail.saldo,
  };
}
