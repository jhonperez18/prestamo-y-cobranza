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
};

export type RouteDayDetailResult =
  | RouteDayDetailOk
  | { ok: true; ready: false; error: string }
  | { ok: false; error: string };

function pesos(n: number) {
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

/**
 * Detalle vivo de una planilla en un día: renglones + totales que suman esos renglones.
 * No toca CIE / Inicial / cash_float.
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
    };
  } catch (error) {
    console.error("route-day-detail", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "route_day_detail_failed",
    };
  }
}
