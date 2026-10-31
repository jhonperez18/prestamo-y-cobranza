/**
 * Orden adjust_day_cash en la base (Fase 4.3).
 * T escribe cash_float; A/N/pools solo AJUSTE@ruta.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AdjustDayCashInput = {
  collectorRef: string;
  date: string;
  real: number;
  by: string;
  reason: string;
  route?: string;
  key?: string;
  calculated?: number;
};

export type AdjustDayCashResult =
  | {
      ok: true;
      ref: string;
      cashFloat: number;
      calculated: number;
      real: number;
      route: string | null;
      idempotent?: boolean;
    }
  | { ok: false; error: string };

export async function callAdjustDayCash(
  input: AdjustDayCashInput,
): Promise<AdjustDayCashResult> {
  const ref = input.collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: "dato_invalido" };
  }
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };

  const { data, error } = await client.rpc("adjust_day_cash", {
    p_collector_ref: ref,
    p_date: input.date,
    p_real: Math.trunc(Number(input.real)),
    p_by: input.by.trim(),
    p_reason: input.reason.trim(),
    p_route: (input.route || "").trim().toUpperCase() || null,
    p_key: input.key?.trim() || null,
    p_calculated:
      input.calculated == null || !Number.isFinite(Number(input.calculated))
        ? null
        : Math.trunc(Number(input.calculated)),
  });
  if (error) return { ok: false, error: error.message };

  const body = data as {
    ok?: boolean;
    error?: string;
    ref?: string;
    cash_float?: number;
    calculated?: number;
    real?: number;
    route?: string | null;
    idempotent?: boolean;
  } | null;

  if (!body || body.ok !== true) {
    return { ok: false, error: body?.error || "adjust_failed" };
  }

  return {
    ok: true,
    ref: String(body.ref || ""),
    cashFloat: Math.trunc(Number(body.cash_float) || 0),
    calculated: Math.trunc(Number(body.calculated) || 0),
    real: Math.trunc(Number(body.real) || 0),
    route: body.route ?? null,
    idempotent: body.idempotent,
  };
}
