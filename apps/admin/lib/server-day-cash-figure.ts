/**
 * Caja del día leída en la base (Fase 3.2). Solo lee. No escribe CIE.
 */
import {
  createSupabaseAdminClient,
  resetSupabaseAdminClient,
} from "@/lib/supabase/admin";

export type DayCashFigureResult =
  | {
      ok: true;
      ready: true;
      chain: boolean;
      opening: number;
      mClosing: number;
      dayFinal: number;
      cie: number | null;
      saldo: number;
      mEfectivo: number;
      mPrestamos: number;
      mGastos: number;
      tEfectivo: number;
      tPrestamos: number;
      tGastos: number;
      priorCieRef?: string;
      priorCieDate?: string;
    }
  | {
      ok: true;
      ready: false;
      error: string;
      missingDay?: string;
    }
  | { ok: false; error: string };

function isTransientFetchError(message: string) {
  return /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_|network/i.test(message);
}

async function rpcDayCashFigure(ref: string, date: string) {
  const client = createSupabaseAdminClient();
  if (!client) return { data: null, errorMessage: "sin_servicio" as string | null };
  try {
    const { data, error } = await client.rpc("day_cash_figure", {
      p_collector_ref: ref,
      p_date: date,
    });
    return { data, errorMessage: error?.message ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "day_cash_figure_failed";
    return { data: null, errorMessage: message };
  }
}

export async function readDayCashFigure(
  collectorRef: string,
  date: string,
): Promise<DayCashFigureResult> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "dato_invalido" };
  }

  let { data, errorMessage } = await rpcDayCashFigure(ref, date);
  if (errorMessage && isTransientFetchError(errorMessage)) {
    console.error("day-cash-figure-fetch-failed-retry", errorMessage);
    resetSupabaseAdminClient();
    ({ data, errorMessage } = await rpcDayCashFigure(ref, date));
  }
  if (errorMessage) return { ok: false, error: errorMessage };

  const body = data as {
    ok?: boolean;
    ready?: boolean;
    chain?: boolean;
    opening?: number;
    m_closing?: number;
    day_final?: number;
    cie?: number | null;
    saldo?: number;
    m_efectivo?: number;
    m_prestamos?: number;
    m_gastos?: number;
    t_efectivo?: number;
    t_prestamos?: number;
    t_gastos?: number;
    error?: string;
    missing_day?: string;
    prior_cie_ref?: string;
    prior_cie_date?: string;
  } | null;

  if (!body || body.ok !== true) {
    return { ok: false, error: body?.error || "sin_caja" };
  }
  if (body.ready !== true) {
    return {
      ok: true,
      ready: false,
      error: body.error || "no_listo",
      missingDay: body.missing_day,
    };
  }

  return {
    ok: true,
    ready: true,
    chain: Boolean(body.chain),
    opening: Math.trunc(Number(body.opening) || 0),
    mClosing: Math.trunc(Number(body.m_closing) || 0),
    dayFinal: Math.trunc(Number(body.day_final) || 0),
    cie: body.cie == null ? null : Math.trunc(Number(body.cie)),
    saldo: Math.trunc(Number(body.saldo) || 0),
    mEfectivo: Math.trunc(Number(body.m_efectivo) || 0),
    mPrestamos: Math.trunc(Number(body.m_prestamos) || 0),
    mGastos: Math.trunc(Number(body.m_gastos) || 0),
    tEfectivo: Math.trunc(Number(body.t_efectivo) || 0),
    tPrestamos: Math.trunc(Number(body.t_prestamos) || 0),
    tGastos: Math.trunc(Number(body.t_gastos) || 0),
    priorCieRef: body.prior_cie_ref,
    priorCieDate: body.prior_cie_date,
  };
}
