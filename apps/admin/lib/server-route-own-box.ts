/**
 * Caja propia A/N leída en la base (Fase 3.3). Solo lee. No escribe CIE.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RouteOwnBoxResult =
  | {
      ok: true;
      route: "A" | "N";
      saldo: number;
      opening: number;
      efectivo: number;
      prestamos: number;
      gastos: number;
      anchor: string | null;
      anchorReal: number | null;
    }
  | { ok: false; error: string };

export async function readRouteOwnBox(
  collectorRef: string,
  date: string,
  route: string,
): Promise<RouteOwnBoxResult> {
  const ref = collectorRef.trim();
  const pin = route.trim().toUpperCase();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (pin !== "A" && pin !== "N")) {
    return { ok: false, error: "dato_invalido" };
  }
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };
  const { data, error } = await client.rpc("route_own_box", {
    p_collector_ref: ref,
    p_date: date,
    p_route: pin,
  });
  if (error) return { ok: false, error: error.message };
  const body = data as {
    ok?: boolean;
    route?: string;
    saldo?: number;
    opening?: number;
    efectivo?: number;
    prestamos?: number;
    gastos?: number;
    anchor?: string;
    anchor_real?: number;
    error?: string;
  } | null;
  const saldo = Number(body?.saldo);
  if (!body || body.ok !== true || !Number.isFinite(saldo)) {
    return { ok: false, error: body?.error || "sin_caja" };
  }
  const efectivo = Math.trunc(Number(body.efectivo) || 0);
  const prestamos = Math.trunc(Number(body.prestamos) || 0);
  const gastos = Math.trunc(Number(body.gastos) || 0);
  const openingRaw = Number(body.opening);
  const opening = Number.isFinite(openingRaw)
    ? Math.trunc(openingRaw)
    : Math.trunc(saldo) - efectivo + prestamos + gastos;
  return {
    ok: true,
    route: pin,
    saldo: Math.trunc(saldo),
    opening,
    efectivo,
    prestamos,
    gastos,
    anchor: body.anchor ? String(body.anchor).slice(0, 10) : null,
    anchorReal:
      body.anchor_real == null || !Number.isFinite(Number(body.anchor_real))
        ? null
        : Math.trunc(Number(body.anchor_real)),
  };
}
