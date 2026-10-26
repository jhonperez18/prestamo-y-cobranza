/**
 * Caja de A leída en la base. Solo lee. No escribe y no toca el CIE de M y T.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RouteABoxResult =
  | { ok: true; saldo: number }
  | { ok: false; error: string };

export async function readRouteABox(collectorRef: string, date: string): Promise<RouteABoxResult> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "dato_invalido" };
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };
  const { data, error } = await client.rpc("route_a_box", {
    p_collector_ref: ref,
    p_date: date,
  });
  if (error) return { ok: false, error: error.message };
  const body = data as { ok?: boolean; saldo?: number; error?: string } | null;
  const saldo = Number(body?.saldo);
  if (!body || body.ok !== true || !Number.isFinite(saldo)) {
    return { ok: false, error: body?.error || "sin_caja" };
  }
  return { ok: true, saldo: Math.trunc(saldo) };
}
