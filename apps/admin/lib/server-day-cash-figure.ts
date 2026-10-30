/**
 * Caja del día leída en la base (Fase 3.2). Solo lee. No escribe CIE.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export async function readDayCashFigure(
  collectorRef: string,
  date: string,
): Promise<DayCashFigureResult> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "dato_invalido" };
  }
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };

  const { data, error } = await client.rpc("day_cash_figure", {
    p_collector_ref: ref,
    p_date: date,
  });
  if (error) return { ok: false, error: error.message };

  const body = data as {
    ok?: boolean;
    ready?: boolean;
    chain?: boolean;
    opening?: number;
    m_closing?: number;
    day_final?: number;
    cie?: number | null;
    saldo?: number;
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
    priorCieRef: body.prior_cie_ref,
    priorCieDate: body.prior_cie_date,
  };
}
