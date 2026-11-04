/**
 * Inicial M leído en la base (Fase 3.1). Solo lee. No escribe CIE ni cash_float.
 */
import {
  createSupabaseAdminClient,
  resetSupabaseAdminClient,
} from "@/lib/supabase/admin";

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

function isTransientFetchError(message: string) {
  return /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_|network/i.test(message);
}

function mapChainMOpeningBody(data: unknown): ChainMOpeningResult {
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

async function rpcChainMOpening(ref: string, date: string) {
  const client = createSupabaseAdminClient();
  if (!client) return { data: null, errorMessage: "sin_servicio" as string | null };
  try {
    const { data, error } = await client.rpc("chain_m_opening", {
      p_collector_ref: ref,
      p_date: date,
    });
    return { data, errorMessage: error?.message ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "chain_m_opening_failed";
    return { data: null, errorMessage: message };
  }
}

export async function readChainMOpening(
  collectorRef: string,
  date: string,
): Promise<ChainMOpeningResult> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "dato_invalido" };
  }

  let { data, errorMessage } = await rpcChainMOpening(ref, date);
  if (errorMessage && isTransientFetchError(errorMessage)) {
    console.error("chain-m-opening-fetch-failed-retry", errorMessage);
    resetSupabaseAdminClient();
    ({ data, errorMessage } = await rpcChainMOpening(ref, date));
  }
  if (errorMessage) return { ok: false, error: errorMessage };
  return mapChainMOpeningBody(data);
}
