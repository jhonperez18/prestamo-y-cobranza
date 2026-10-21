/**
 * Guarda el informe del mes cuando la última ruta del último día de cobro ya cerró.
 * Corre en el sellado de las 23:35 y, si esa noche no quedó, en la revisión de la mañana.
 * No toca la caja ni el Inicial. Una copia guardada no se reemplaza.
 */
import { buildInformeMonthSnapshots } from "@/lib/server-informe-month-snapshot";
import {
  informeMonthReady,
  informePeriodName,
  informeSnapshotDay,
} from "@/lib/informe-month-snapshot";
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";
import { fetchOpsTable, rowToMisc } from "@/lib/supabase/ops-mirror";
import {
  readInformeSnapshot,
  writeInformeSnapshotOnce,
} from "@/lib/supabase/informe-snapshot-mirror";
import type { MiscPayment } from "@/lib/misc-payments";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";

export type InformeSealResult = {
  attempted: boolean;
  ok: boolean;
  day?: string;
  skipped?: "already" | "not_ready";
  saved?: boolean;
  error?: string;
};

export async function maybeSealInformeMonth(input: {
  businessDate: string;
  state?: OperationalDayState;
}): Promise<InformeSealResult> {
  const day = informeSnapshotDay(input.businessDate);
  if (!day) return { attempted: false, ok: true };

  const period = day.slice(0, 7);
  const [general, angelica] = await Promise.all([
    readInformeSnapshot("general", period),
    readInformeSnapshot("angelica", period),
  ]);
  if (!general.ok) return { attempted: true, ok: false, day, error: general.error };
  if (!angelica.ok) return { attempted: true, ok: false, day, error: angelica.error };
  if (general.snapshot && angelica.snapshot) {
    return { attempted: true, ok: true, day, skipped: "already" };
  }

  const loaded = input.state ? { ok: true as const, state: input.state } : await loadOperationalStateFromCloud();
  if (!loaded.ok) return { attempted: true, ok: false, day, error: loaded.error };
  if (!informeMonthReady(loaded.state.assignments, loaded.state.clients, day)) {
    return { attempted: true, ok: true, day, skipped: "not_ready" };
  }

  const [miscT, accountsT] = await Promise.all([
    fetchOpsTable("misc_payments"),
    fetchBankAccountsFromSupabase(),
  ]);
  if (!miscT.ok) {
    return {
      attempted: true,
      ok: false,
      day,
      error: `misc_payments: ${"error" in miscT ? miscT.error : "fetch_failed"}`,
    };
  }
  if (!accountsT.ok) return { attempted: true, ok: false, day, error: accountsT.error };

  const miscPayments = (miscT.rows ?? [])
    .map(rowToMisc)
    .filter((row): row is MiscPayment => Boolean(row));
  const built = buildInformeMonthSnapshots({
    state: loaded.state,
    sealedOn: day,
    miscPayments,
    accounts: accountsT.accounts,
  });
  const writes = await Promise.all([
    general.snapshot ? Promise.resolve({ ok: true as const, kept: true as const }) : writeInformeSnapshotOnce(built.general),
    angelica.snapshot
      ? Promise.resolve({ ok: true as const, kept: true as const })
      : writeInformeSnapshotOnce(built.angelica),
  ]);
  const failed = writes.find((row) => !row.ok);
  if (failed && !failed.ok) return { attempted: true, ok: false, day, error: failed.error };
  return { attempted: true, ok: true, day, saved: true };
}

export function informeSealDetail(result: InformeSealResult) {
  if (!result.day) return "";
  const name = informePeriodName(result.day.slice(0, 7));
  if (result.saved) return `${name} quedó guardado.`;
  if (result.skipped === "already") return `${name} ya estaba guardado.`;
  if (result.skipped === "not_ready") return `${name}: todavía falta cerrar una ruta.`;
  return result.error || `${name}: no se pudo guardar.`;
}
