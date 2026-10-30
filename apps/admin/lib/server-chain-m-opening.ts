/**
 * Inicial M leído en la base (Fase 3.1). Solo lee. No escribe CIE ni cash_float.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ChainMOpeningResult =
  | {
      ok: true;
      ready: true;
      opening: number;
      priorCieRef: string;
      priorCieDate: string;
    }
  | {
      ok: true;
      ready: false;
      opening: null;
      error: string;
      missingDay?: string;
      priorCieRef?: string;
      priorCieDate?: string;
    }
  | { ok: false; error: string };

export async function readChainMOpening(
  collectorRef: string,
  date: string,
): Promise<ChainMOpeningResult> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "dato_invalido" };
  }
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };

  const { data, error } = await client.rpc("chain_m_opening", {
    p_collector_ref: ref,
    p_date: date,
  });
  if (error) return { ok: false, error: error.message };

  const body = data as {
    ok?: boolean;
    ready?: boolean;
    opening?: number | null;
    error?: string;
    missing_day?: string;
    prior_cie_ref?: string;
    prior_cie_date?: string;
  } | null;

  if (!body || body.ok !== true) {
    return { ok: false, error: body?.error || "sin_inicial" };
  }

  if (body.ready === true && body.opening != null && Number.isFinite(Number(body.opening))) {
    return {
      ok: true,
      ready: true,
      opening: Math.trunc(Number(body.opening)),
      priorCieRef: String(body.prior_cie_ref || ""),
      priorCieDate: String(body.prior_cie_date || ""),
    };
  }

  return {
    ok: true,
    ready: false,
    opening: null,
    error: body.error || "no_listo",
    missingDay: body.missing_day,
    priorCieRef: body.prior_cie_ref,
    priorCieDate: body.prior_cie_date,
  };
}
