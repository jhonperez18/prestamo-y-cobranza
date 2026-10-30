/**
 * Totales Banco / Nequi leídos en la base (Fase 3.3). Solo lee.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type DigitalPoolBalancesResult =
  | { ok: true; banco: number; nequi: number }
  | { ok: false; error: string };

export async function readDigitalPoolBalances(): Promise<DigitalPoolBalancesResult> {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };
  const { data, error } = await client.rpc("digital_pool_balances");
  if (error) return { ok: false, error: error.message };
  const body = data as { ok?: boolean; banco?: number; nequi?: number } | null;
  const banco = Number(body?.banco);
  const nequi = Number(body?.nequi);
  if (!body || body.ok !== true || !Number.isFinite(banco) || !Number.isFinite(nequi)) {
    return { ok: false, error: "sin_pools" };
  }
  return { ok: true, banco: Math.trunc(banco), nequi: Math.trunc(nequi) };
}
