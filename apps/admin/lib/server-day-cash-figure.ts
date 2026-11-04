/**
 * Caja del día leída en la base (Fase 3.2). Solo lee. No escribe CIE.
 * Si el CIE/GAS no trae renglones «Préstamo», completa con fichas en efectivo
 * del día (start_date + ruta). Caso 03/11: P-664 Nelson Jefe 300.000 en M.
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

function pesos(n: number) {
  return Math.trunc(Number(n) || 0);
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

/** Capital en efectivo del día por ruta (ficha), sin nequi/banco/cartera. */
async function cashLoanTotalsByRoute(date: string): Promise<{
  m: number;
  t: number;
  a: number;
  n: number;
}> {
  const empty = { m: 0, t: 0, a: 0, n: 0 };
  const client = createSupabaseAdminClient();
  if (!client) return empty;
  try {
    const { data: loans, error } = await client
      .from("loans")
      .select("ref,client_ref,capital,status,notes,deleted_at")
      .eq("start_date", date)
      .limit(500);
    if (error || !loans?.length) return empty;
    const live = loans.filter((row) => {
      if (row.deleted_at) return false;
      const status = String(row.status || "")
        .trim()
        .toLowerCase();
      if (status === "eliminado" || status === "cancelado") return false;
      const notes = String(row.notes || "");
      if (notes.includes("[[fb:nequi]]") || notes.includes("[[fb:banco]]") || notes.includes("[[fb:cartera]]")) {
        return false;
      }
      return pesos(row.capital) > 0;
    });
    if (!live.length) return empty;
    const refs = [...new Set(live.map((row) => String(row.client_ref || "").trim()).filter(Boolean))];
    const { data: clients } = await client
      .from("clients")
      .select("ref,route")
      .in("ref", refs.length ? refs : ["__none__"]);
    const routeBy = new Map(
      (clients || []).map((row) => [
        String((row as { ref?: string }).ref || ""),
        String((row as { route?: string }).route || "")
          .trim()
          .toUpperCase(),
      ]),
    );
    const out = { ...empty };
    for (const loan of live) {
      const pin = routeBy.get(String(loan.client_ref || "").trim()) || "";
      const capital = pesos(loan.capital);
      if (pin === "M") out.m += capital;
      else if (pin === "T") out.t += capital;
      else if (pin === "A") out.a += capital;
      else if (pin === "N") out.n += capital;
    }
    return out;
  } catch (error) {
    console.error("day-cash-figure-loan-totals", error);
    return empty;
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
    own_route?: string | null;
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
    own_prestamos?: number;
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

  const opening = pesos(body.opening ?? 0);
  let mPrestamos = pesos(body.m_prestamos ?? 0);
  let tPrestamos = pesos(body.t_prestamos ?? 0);
  const mEfectivo = pesos(body.m_efectivo ?? 0);
  const mGastos = pesos(body.m_gastos ?? 0);
  const tEfectivo = pesos(body.t_efectivo ?? 0);
  const tGastos = pesos(body.t_gastos ?? 0);
  const chain = Boolean(body.chain);
  const ownRoute = String(body.own_route || "")
    .trim()
    .toUpperCase();

  // Completa préstamos si la RPC vieja / CIE sin GAS dejó 0 con fichas en efectivo.
  const loanTotals = await cashLoanTotalsByRoute(date);
  if (chain) {
    if (loanTotals.m > mPrestamos) mPrestamos = loanTotals.m;
    if (loanTotals.t > tPrestamos) tPrestamos = loanTotals.t;
  } else if (ownRoute === "A" && loanTotals.a > mPrestamos) {
    // own_prestamos vive en campos m_* cuando no es cadena en lecturas viejas;
    // bookIndependent usa route_own_box. Aquí solo cadena importa al historial M/T.
  } else if (ownRoute === "N" && loanTotals.n > mPrestamos) {
    /* N: route_own_box */
  }

  // Preferir m_closing de la RPC (fuente de Inicial T). Recalcular solo si falta.
  const mClosing =
    body.m_closing != null && Number.isFinite(Number(body.m_closing))
      ? pesos(body.m_closing)
      : pesos(opening + mEfectivo - mGastos - mPrestamos);
  const dayFinal =
    body.day_final != null && Number.isFinite(Number(body.day_final))
      ? pesos(body.day_final)
      : pesos(mClosing + tEfectivo - tGastos - tPrestamos);
  const cie = body.cie == null ? null : pesos(body.cie);

  return {
    ok: true,
    ready: true,
    chain,
    opening,
    mClosing,
    dayFinal,
    cie,
    saldo: cie != null ? cie : dayFinal,
    mEfectivo,
    mPrestamos,
    mGastos,
    tEfectivo,
    tPrestamos,
    tGastos,
    priorCieRef: body.prior_cie_ref,
    priorCieDate: body.prior_cie_date,
  };
}
