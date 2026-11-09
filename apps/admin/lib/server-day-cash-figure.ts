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

type PrestamoSides = { m: number; t: number };

/**
 * Préstamos del GAS de este cobrador. La plata salió de SU caja.
 * Cliente en T → T; M / A / N / vacío → M (no puede quedar en 0: caso P-717 N).
 */
async function gasPrestamoTotals(
  collectorRef: string,
  date: string,
): Promise<PrestamoSides> {
  const empty = { m: 0, t: 0 };
  const client = createSupabaseAdminClient();
  if (!client) return empty;
  try {
    const { data: rows, error } = await client
      .from("day_expenses")
      .select("expenses")
      .eq("collector_ref", collectorRef)
      .eq("expense_date", date)
      .limit(5);
    if (error || !rows?.length) return empty;
    const lines: Array<{ amount?: number; category?: string; id?: string; loanRef?: string; route?: string }> =
      [];
    for (const row of rows) {
      const exp = (row as { expenses?: unknown }).expenses;
      if (!Array.isArray(exp)) continue;
      for (const line of exp) {
        if (line && typeof line === "object") {
          lines.push(line as (typeof lines)[number]);
        }
      }
    }
    const prestamoLines = lines.filter(
      (line) =>
        String(line.category || "") === "prestamo_ruta" || String(line.id || "") === "prestamo",
    );
    if (!prestamoLines.length) return empty;
    const loanRefs = [
      ...new Set(prestamoLines.map((line) => String(line.loanRef || "").trim()).filter(Boolean)),
    ];
    const routeByLoan = new Map<string, string>();
    if (loanRefs.length) {
      const { data: loans } = await client
        .from("loans")
        .select("ref,client_ref")
        .in("ref", loanRefs);
      const clientRefs = [
        ...new Set(
          (loans || []).map((row) => String((row as { client_ref?: string }).client_ref || "").trim()),
        ),
      ].filter(Boolean);
      const { data: clients } = clientRefs.length
        ? await client.from("clients").select("ref,route").in("ref", clientRefs)
        : { data: [] as Array<{ ref?: string; route?: string }> };
      const routeByClient = new Map(
        (clients || []).map((row) => [
          String(row.ref || ""),
          String(row.route || "")
            .trim()
            .toUpperCase(),
        ]),
      );
      for (const loan of loans || []) {
        const ref = String((loan as { ref?: string }).ref || "");
        const cRef = String((loan as { client_ref?: string }).client_ref || "");
        routeByLoan.set(ref, routeByClient.get(cRef) || "");
      }
    }
    const out = { m: 0, t: 0 };
    for (const line of prestamoLines) {
      const amount = pesos(line.amount);
      if (!(amount > 0)) continue;
      const marked = String(line.route || "")
        .trim()
        .toUpperCase();
      const fromLoan = routeByLoan.get(String(line.loanRef || "").trim()) || "";
      const pin = marked || fromLoan;
      if (pin === "T") out.t += amount;
      else out.m += amount;
    }
    return out;
  } catch (error) {
    console.error("day-cash-figure-gas-prestamos", error);
    return empty;
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
      // Combinado: solo el tramo de caja cuenta aquí (banco va al pool).
      if (notes.includes("[[fb:combinado]]")) {
        return /\[\[split:efectivo:(\d+)\]\]/i.test(notes);
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
      const notes = String(loan.notes || "");
      let capital = pesos(loan.capital);
      if (notes.includes("[[fb:combinado]]")) {
        const match = notes.match(/\[\[split:efectivo:(\d+)\]\]/i);
        capital = match ? pesos(Number(match[1]) || 0) : 0;
      }
      if (capital <= 0) continue;
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
  const rpcMPrestamos = pesos(body.m_prestamos ?? 0);
  const rpcTPrestamos = pesos(body.t_prestamos ?? 0);
  let mPrestamos = rpcMPrestamos;
  let tPrestamos = rpcTPrestamos;
  const mEfectivo = pesos(body.m_efectivo ?? 0);
  const mGastos = pesos(body.m_gastos ?? 0);
  const tEfectivo = pesos(body.t_efectivo ?? 0);
  const tGastos = pesos(body.t_gastos ?? 0);
  const chain = Boolean(body.chain);
  const ownRoute = String(body.own_route || "")
    .trim()
    .toUpperCase();

  // 1) GAS de este cobrador: manda (cliente A/N no puede dejar m_prestamos en 0).
  const gasTotals = await gasPrestamoTotals(ref, date);
  if (gasTotals.m > mPrestamos) mPrestamos = gasTotals.m;
  if (gasTotals.t > tPrestamos) tPrestamos = gasTotals.t;

  // 2) Completa con fichas en efectivo del día (RPC vieja / CIE sin GAS).
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

  const prestamosBumped = mPrestamos > rpcMPrestamos || tPrestamos > rpcTPrestamos;
  // Si completamos préstamos, hay que rehacer caja (la RPC dejó m_closing sin ese Haber).
  const mClosing = prestamosBumped
    ? pesos(opening + mEfectivo - mGastos - mPrestamos)
    : body.m_closing != null && Number.isFinite(Number(body.m_closing))
      ? pesos(body.m_closing)
      : pesos(opening + mEfectivo - mGastos - mPrestamos);
  const dayFinal = prestamosBumped
    ? pesos(mClosing + tEfectivo - tGastos - tPrestamos)
    : body.day_final != null && Number.isFinite(Number(body.day_final))
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
