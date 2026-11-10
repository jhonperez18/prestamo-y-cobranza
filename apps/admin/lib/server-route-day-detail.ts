/**
 * Puerta única ruta+día (lectura).
 *
 * Ley: totales de gasto/préstamo y sus renglones salen JUNTOS del servidor.
 * El celular no arma detalle con copia soltada. Caja/Inicial siguen en
 * day_cash_figure / route_own_box (regla de inicio intacta).
 */
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rowToDayClose, rowToDayExpense } from "@/lib/supabase/ops-mirror";
import type { CollectorDayExpenseDraft } from "@/lib/collector-day-close";

/** Cobro liviano para lista de botones (efectivo / banco / nequi). */
export type RouteDayPayLine = {
  ref: string;
  client: string;
  amount: number;
  method: "efectivo" | "banco" | "nequi";
  loanRef?: string;
};

/** N/P liviano de la planilla sellada. */
export type RouteDayNpLine = {
  clientRef: string;
  clientName: string;
  loanRef?: string;
};

export type RouteDayDetailOk = {
  ok: true;
  ready: true;
  collectorRef: string;
  date: string;
  route: string;
  /** Suma de gastoLines (manda el detalle). */
  gastosTotal: number;
  /** Suma de prestamoLines (manda el detalle). */
  prestamosTotal: number;
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  /** Cobros efectivo de la ruta (incluye Caja/oficina). */
  efectivoTotal: number;
  cashPays: RouteDayPayLine[];
  /** Cobros digitales: A→Nequi; M/T/N→Banco. */
  digitalTotal: number;
  digitalPays: RouteDayPayLine[];
  digitalPool: "banco" | "nequi";
  /** N/P de la hoja (omitido real, no cierre ni renovado). */
  npCount: number;
  npRows: RouteDayNpLine[];
};

export type RouteDayDetailResult =
  | RouteDayDetailOk
  | { ok: true; ready: false; error: string }
  | { ok: false; error: string };

function pesos(n: number | null | undefined) {
  return Math.trunc(Number(n) || 0);
}

function pinOf(route: string | null | undefined) {
  return String(route || "")
    .trim()
    .toUpperCase();
}

function isPrestamoLine(line: RouteExpenseLine): boolean {
  return (
    String(line.category || "") === "prestamo_ruta" || String(line.id || "") === "prestamo"
  );
}

function isOperativeLine(line: RouteExpenseLine): boolean {
  return pesos(line.amount) > 0 && !isPrestamoLine(line);
}

function sumLines(lines: RouteExpenseLine[]) {
  return lines.reduce((sum, line) => sum + pesos(line.amount), 0);
}

/** Misma partición que el libro JS: M / T / A / N. */
function operativeBelongsToRoute(
  line: RouteExpenseLine,
  route: string,
): boolean {
  const pin = pinOf(route);
  const marked = pinOf(line.route);
  if (pin === "T") return marked === "T";
  if (pin === "A") return marked === "A";
  if (pin === "N") return marked === "N" || marked === "";
  // M: sin marca T/A/N
  return marked !== "T" && marked !== "A" && marked !== "N";
}

async function loadDraftLines(
  collectorRef: string,
  date: string,
): Promise<RouteExpenseLine[]> {
  const client = createSupabaseAdminClient();
  if (!client) return [];
  const [{ data: gasRows }, { data: cieRows }] = await Promise.all([
    client
      .from("day_expenses")
      .select("*")
      .eq("collector_ref", collectorRef)
      .eq("expense_date", date)
      .limit(5),
    client
      .from("day_closes")
      .select("*")
      .eq("collector_ref", collectorRef)
      .eq("close_date", date)
      .like("ref", "CIE-%")
      .limit(5),
  ]);

  let expenses = (gasRows || [])
    .map((row) => rowToDayExpense(row as Record<string, unknown>))
    .filter((row): row is CollectorDayExpenseDraft => Boolean(row));

  const gasOperative = expenses.reduce(
    (sum, row) => sum + (row.expenses || []).filter(isOperativeLine).length,
    0,
  );
  if (gasOperative === 0) {
    for (const raw of cieRows || []) {
      const cie = rowToDayClose(raw as Record<string, unknown>);
      if (!cie || cie.provisional) continue;
      const lines = (cie.expenses || []).filter((line) => pesos(line.amount) > 0);
      if (!lines.length) continue;
      expenses = [
        {
          ref: `GAS-${collectorRef}-${date}`,
          collectorRef,
          collectorName: cie.collectorName || "",
          date,
          routeRef: cie.routeRef || "",
          expenses: lines,
          expensesTotal: sumLines(lines),
          updatedAt: cie.updatedAt || cie.closedAt || new Date().toISOString(),
        },
      ];
      break;
    }
  }

  const out: RouteExpenseLine[] = [];
  for (const row of expenses) {
    for (const line of row.expenses || []) {
      if (pesos(line.amount) > 0) out.push(line);
    }
  }
  return out;
}

type LoanMeta = { ref: string; clientRef: string; clientName: string; route: string; capital: number };

/**
 * Fichas en efectivo del día por ruta (completa renglones si el GAS no los trajo).
 * Misma regla que cashLoanTotalsByRoute del day-cash-figure.
 */
async function cashLoanLinesForRoute(date: string, route: string): Promise<LoanMeta[]> {
  const pin = pinOf(route);
  if (!pin) return [];
  const client = createSupabaseAdminClient();
  if (!client) return [];
  try {
    const { data: loans, error } = await client
      .from("loans")
      .select("ref,client_ref,capital,status,notes,deleted_at,client_name")
      .eq("start_date", date)
      .limit(500);
    if (error || !loans?.length) return [];
    const live = loans.filter((row) => {
      if ((row as { deleted_at?: string | null }).deleted_at) return false;
      const status = String((row as { status?: string }).status || "")
        .trim()
        .toLowerCase();
      if (status === "eliminado" || status === "cancelado") return false;
      const notes = String((row as { notes?: string }).notes || "");
      if (
        notes.includes("[[fb:nequi]]") ||
        notes.includes("[[fb:banco]]") ||
        notes.includes("[[fb:cartera]]")
      ) {
        return false;
      }
      if (notes.includes("[[fb:combinado]]")) {
        return /\[\[split:efectivo:(\d+)\]\]/i.test(notes);
      }
      return pesos((row as { capital?: number }).capital) > 0;
    });
    if (!live.length) return [];
    const refs = [
      ...new Set(live.map((row) => String((row as { client_ref?: string }).client_ref || "").trim())),
    ].filter(Boolean);
    const { data: clients } = await client
      .from("clients")
      .select("ref,route,name,last_name")
      .in("ref", refs.length ? refs : ["__none__"]);
    const byClient = new Map(
      (clients || []).map((row) => [
        String((row as { ref?: string }).ref || ""),
        {
          route: pinOf((row as { route?: string }).route),
          name: `${String((row as { name?: string }).name || "")} ${String(
            (row as { last_name?: string }).last_name || "",
          )}`
            .replace(/\s+/g, " ")
            .trim(),
        },
      ]),
    );
    const out: LoanMeta[] = [];
    for (const loan of live) {
      const cRef = String((loan as { client_ref?: string }).client_ref || "").trim();
      const meta = byClient.get(cRef);
      if (!meta || meta.route !== pin) continue;
      const notes = String((loan as { notes?: string }).notes || "");
      let capital = pesos((loan as { capital?: number }).capital);
      if (notes.includes("[[fb:combinado]]")) {
        const match = notes.match(/\[\[split:efectivo:(\d+)\]\]/i);
        capital = match ? pesos(Number(match[1]) || 0) : 0;
      }
      if (capital <= 0) continue;
      const labelName =
        meta.name ||
        String((loan as { client_name?: string }).client_name || "").trim() ||
        cRef;
      out.push({
        ref: String((loan as { ref?: string }).ref || ""),
        clientRef: cRef,
        clientName: labelName,
        route: pin,
        capital,
      });
    }
    return out;
  } catch (error) {
    console.error("route-day-detail-loans", error);
    return [];
  }
}

async function resolvePrestamoRoutes(
  lines: RouteExpenseLine[],
): Promise<Map<string, string>> {
  const routeByLoan = new Map<string, string>();
  const loanRefs = [
    ...new Set(lines.map((line) => String(line.loanRef || "").trim()).filter(Boolean)),
  ];
  if (!loanRefs.length) return routeByLoan;
  const client = createSupabaseAdminClient();
  if (!client) return routeByLoan;
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
      String((row as { ref?: string }).ref || ""),
      pinOf((row as { route?: string }).route),
    ]),
  );
  for (const loan of loans || []) {
    const ref = String((loan as { ref?: string }).ref || "");
    const cRef = String((loan as { client_ref?: string }).client_ref || "");
    routeByLoan.set(ref, routeByClient.get(cRef) || "");
  }
  return routeByLoan;
}

function prestamoBelongsToRoute(
  line: RouteExpenseLine,
  route: string,
  routeByLoan: Map<string, string>,
): boolean {
  const pin = pinOf(route);
  const marked = pinOf(line.route);
  const fromLoan = routeByLoan.get(String(line.loanRef || "").trim()) || "";
  const owner = marked || fromLoan;
  return owner === pin;
}

const DAY_CLOSE_SKIP = "Cierre de jornada";
const LOAN_RENEWED = "Renovado hoy";

/** Solo los clientes pedidos (liviano: no baja el catálogo entero). */
async function clientNamesOnRoute(
  clientRefs: string[],
  route: string,
): Promise<Map<string, string>> {
  const pin = pinOf(route);
  const out = new Map<string, string>();
  const client = createSupabaseAdminClient();
  if (!client || !pin || !clientRefs.length) return out;
  const unique = [...new Set(clientRefs.filter(Boolean))];
  const { data } = await client
    .from("clients")
    .select("ref,name,last_name,route")
    .in("ref", unique);
  for (const row of data || []) {
    if (pinOf((row as { route?: string }).route) !== pin) continue;
    const ref = String((row as { ref?: string }).ref || "").trim();
    if (!ref) continue;
    const name = `${String((row as { name?: string }).name || "")} ${String(
      (row as { last_name?: string }).last_name || "",
    )}`
      .replace(/\s+/g, " ")
      .trim();
    out.set(ref, name || ref);
  }
  return out;
}

function methodForRoutePin(
  rawMethod: string,
  routePin: string,
): "efectivo" | "banco" | "nequi" {
  const m = String(rawMethod || "")
    .trim()
    .toLowerCase();
  if (m === "efectivo" || m === "cash" || m === "") return "efectivo";
  return routePin === "A" ? "nequi" : "banco";
}

async function clientRefByLoan(loanRefs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const client = createSupabaseAdminClient();
  const unique = [...new Set(loanRefs.filter(Boolean))];
  if (!client || !unique.length) return out;
  const { data } = await client.from("loans").select("ref,client_ref").in("ref", unique);
  for (const row of data || []) {
    const ref = String((row as { ref?: string }).ref || "").trim();
    const cRef = String((row as { client_ref?: string }).client_ref || "").trim();
    if (ref && cRef) out.set(ref, cRef);
  }
  return out;
}

async function loadRoutePayments(
  date: string,
  route: string,
): Promise<{ cash: RouteDayPayLine[]; digital: RouteDayPayLine[] }> {
  const pin = pinOf(route);
  const empty = { cash: [] as RouteDayPayLine[], digital: [] as RouteDayPayLine[] };
  const client = createSupabaseAdminClient();
  if (!client || !pin) return empty;
  const { data: pays, error } = await client
    .from("payments")
    .select("ref,client_ref,amount,method,loan_ref,payment_type,charge_label")
    .eq("paid_date", date)
    .limit(3000);
  if (error) {
    console.error("route-day-detail-payments", error.message);
    return empty;
  }
  if (!pays?.length) return empty;
  const loanRefs = [
    ...new Set(
      pays
        .map((row) => String((row as { loan_ref?: string }).loan_ref || "").trim())
        .filter(Boolean),
    ),
  ];
  const byLoan = await clientRefByLoan(loanRefs);
  const clientRefs = [
    ...new Set(
      pays
        .map((row) => {
          const direct = String((row as { client_ref?: string }).client_ref || "").trim();
          if (direct) return direct;
          const loanRef = String((row as { loan_ref?: string }).loan_ref || "").trim();
          return byLoan.get(loanRef) || "";
        })
        .filter(Boolean),
    ),
  ];
  const onRoute = await clientNamesOnRoute(clientRefs, pin);
  if (!onRoute.size) return empty;
  const cash: RouteDayPayLine[] = [];
  const digital: RouteDayPayLine[] = [];
  for (const row of pays) {
    const paymentType = String((row as { payment_type?: string }).payment_type || "").trim();
    const charge = String((row as { charge_label?: string }).charge_label || "");
    if (paymentType === "Anulado" || charge.startsWith("ANULADO:")) continue;
    const loanRef = String((row as { loan_ref?: string }).loan_ref || "").trim();
    const cRef =
      String((row as { client_ref?: string }).client_ref || "").trim() ||
      byLoan.get(loanRef) ||
      "";
    if (!cRef || !onRoute.has(cRef)) continue;
    const amount = pesos((row as { amount?: number }).amount);
    if (amount <= 0) continue;
    const method = methodForRoutePin(String((row as { method?: string }).method || ""), pin);
    const line: RouteDayPayLine = {
      ref: String((row as { ref?: string }).ref || ""),
      client: onRoute.get(cRef) || cRef,
      amount,
      method,
      loanRef: loanRef || undefined,
    };
    if (!line.ref) continue;
    if (method === "efectivo") cash.push(line);
    else digital.push(line);
  }
  return { cash, digital };
}

async function loadRouteNp(
  collectorRef: string,
  date: string,
  route: string,
): Promise<RouteDayNpLine[]> {
  const pin = pinOf(route);
  const client = createSupabaseAdminClient();
  if (!client || !pin) return [];
  const { data: rows, error } = await client
    .from("daily_assignments")
    .select("client_ref,client_name,loan_ref,visit_status,skip_reason,collector_ref")
    .eq("dispatch_date", date)
    .eq("collector_ref", collectorRef)
    .eq("visit_status", "omitido")
    .limit(3000);
  if (error || !rows?.length) return [];
  const refs = [
    ...new Set(
      rows.map((row) => String((row as { client_ref?: string }).client_ref || "").trim()).filter(Boolean),
    ),
  ];
  const onRoute = await clientNamesOnRoute(refs, pin);
  if (!onRoute.size) return [];
  const out: RouteDayNpLine[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const reason = String((row as { skip_reason?: string }).skip_reason || "").trim();
    if (reason === DAY_CLOSE_SKIP || reason === LOAN_RENEWED) continue;
    const cRef = String((row as { client_ref?: string }).client_ref || "").trim();
    if (!onRoute.has(cRef)) continue;
    const loanRef = String((row as { loan_ref?: string }).loan_ref || "").trim();
    const key = `${cRef}|${loanRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      clientRef: cRef,
      clientName:
        onRoute.get(cRef) ||
        String((row as { client_name?: string }).client_name || "").trim() ||
        cRef,
      loanRef: loanRef || undefined,
    });
  }
  return out;
}

/**
 * Detalle vivo de una planilla en un día: renglones + totales que suman esos renglones.
 * Incluye efectivo / banco|nequi / N/P. No toca CIE / Inicial / cash_float.
 */
export async function readRouteDayDetail(
  collectorRef: string,
  date: string,
  route: string,
): Promise<RouteDayDetailResult> {
  const ref = collectorRef.trim();
  const pin = pinOf(route);
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !pin) {
    return { ok: false, error: "dato_invalido" };
  }
  if (!createSupabaseAdminClient()) {
    return { ok: false, error: "sin_servicio" };
  }

  try {
    const allLines = await loadDraftLines(ref, date);
    const gastoLines = allLines.filter(
      (line) => isOperativeLine(line) && operativeBelongsToRoute(line, pin),
    );

    const prestamoFromGas = allLines.filter(isPrestamoLine);
    const routeByLoan = await resolvePrestamoRoutes(prestamoFromGas);
    const prestamoLines: RouteExpenseLine[] = [];
    const seenLoan = new Set<string>();
    for (const line of prestamoFromGas) {
      if (!prestamoBelongsToRoute(line, pin, routeByLoan)) continue;
      prestamoLines.push(line);
      const loanRef = String(line.loanRef || "").trim();
      if (loanRef) seenLoan.add(loanRef);
    }

    // Fichas en efectivo del día que el GAS no trajo (CIE huérfano / aparato sin renglón).
    const fichas = await cashLoanLinesForRoute(date, pin);
    for (const loan of fichas) {
      if (seenLoan.has(loan.ref)) continue;
      prestamoLines.push({
        id: "prestamo",
        label: `Préstamo · ${loan.clientName}`,
        amount: loan.capital,
        category: "prestamo_ruta",
        loanRef: loan.ref,
        route: pin,
      });
      seenLoan.add(loan.ref);
    }

    const [pays, npRows] = await Promise.all([
      loadRoutePayments(date, pin),
      loadRouteNp(ref, date, pin),
    ]);
    const digitalPool = pin === "A" ? ("nequi" as const) : ("banco" as const);

    return {
      ok: true,
      ready: true,
      collectorRef: ref,
      date,
      route: pin,
      gastoLines,
      prestamoLines,
      gastosTotal: sumLines(gastoLines),
      prestamosTotal: sumLines(prestamoLines),
      cashPays: pays.cash,
      efectivoTotal: pays.cash.reduce((sum, row) => sum + pesos(row.amount), 0),
      digitalPays: pays.digital,
      digitalTotal: pays.digital.reduce((sum, row) => sum + pesos(row.amount), 0),
      digitalPool,
      npRows,
      npCount: npRows.length,
    };
  } catch (error) {
    console.error("route-day-detail", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "route_day_detail_failed",
    };
  }
}
