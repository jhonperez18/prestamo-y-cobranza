/**
 * Detalle GAS- del día desde la base («Lo que gastó» / «Lo que prestó»).
 * Si el celular no trae el GAS-, esta lectura lo completa sin recalcular caja.
 */
import { sameRoute } from "@/lib/client-route-order";
import type { CollectorDayExpenseDraft, RouteExpenseLine } from "@/lib/collector-day-close";
import {
  isOwnPlanillaOperativeLine,
  isPrestamoRutaExpense,
  isSecondaryOperativeLine,
  loanClientOnSide,
  type ChainRouteSplit,
} from "@/lib/expense-lines";
import type { ClientRow, LoanRow } from "@/lib/mock-data";
import {
  INDEPENDENT_OWN_LOANS_FROM,
  INDEPENDENT_SALDO_ROUTES,
  isPlanillaCashChainPrimary,
  isPlanillaCashChainRoute,
  isPlanillaCashChainSecondary,
  PLANILLA_CASH_CHAIN_SECONDARY,
} from "@/lib/planilla-cash-chain";

function isIndependentSaldoRoute(route: string | null | undefined): boolean {
  if (!route || isPlanillaCashChainRoute(route)) return false;
  return INDEPENDENT_SALDO_ROUTES.some((name) => sameRoute(route, name));
}

function chainSplitFromClients(clients: ClientRow[]): ChainRouteSplit {
  const secondaryClientRefs = new Set<string>();
  const ownCashClientRefs = new Set<string>();
  for (const client of clients) {
    const route = String(client.route || "").trim();
    if (!route) continue;
    if (sameRoute(route, PLANILLA_CASH_CHAIN_SECONDARY)) secondaryClientRefs.add(client.ref);
    if (isIndependentSaldoRoute(route)) ownCashClientRefs.add(client.ref);
  }
  return {
    side: "primary",
    secondaryRoute: PLANILLA_CASH_CHAIN_SECONDARY,
    secondaryClientRefs,
    ownCashClientRefs,
    ownCashFrom: INDEPENDENT_OWN_LOANS_FROM,
  };
}

function clientRefOfPrestamoLine(
  line: RouteExpenseLine,
  loans: LoanRow[],
  clients: ClientRow[],
): string {
  const loanRef = String(line.loanRef || "").trim();
  if (loanRef) {
    const hit = loans.find((row) => row.ref === loanRef);
    if (hit?.clientRef) return hit.clientRef;
  }
  const hint = String(line.label || "")
    .replace(/^Préstamo\s*·\s*/i, "")
    .replace(/P-pend-[a-z0-9]+/gi, " ")
    .replace(/P-\d+/gi, " ")
    .replace(/[·\-_|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!hint) return "";
  const matches = clients.filter((client) => {
    const name = `${client.name} ${client.lastName}`.replace(/\s+/g, " ").trim().toLowerCase();
    return name === hint || name.includes(hint) || hint.includes(name);
  });
  return matches.length === 1 ? matches[0].ref : "";
}

const byKey = new Map<string, CollectorDayExpenseDraft[]>();
const listeners = new Set<() => void>();

function keyOf(collectorRef: string, date: string) {
  return `${collectorRef.trim()}|${date}`;
}

function notify() {
  for (const fn of listeners) fn();
}

/** React: re-pintar cuando llega el GAS- de la base. */
export function subscribeCloudDayExpenses(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCloudDayExpenses(
  collectorRef: string,
  date: string,
): CollectorDayExpenseDraft[] | null {
  const hit = byKey.get(keyOf(collectorRef, date));
  return hit ? hit.map((row) => ({ ...row, expenses: [...row.expenses] })) : null;
}

function linesFromDrafts(
  drafts: CollectorDayExpenseDraft[] | null | undefined,
  kind: "operative" | "prestamo",
): RouteExpenseLine[] {
  if (!drafts?.length) return [];
  const out: RouteExpenseLine[] = [];
  for (const row of drafts) {
    for (const line of row.expenses || []) {
      if ((Number(line.amount) || 0) <= 0) continue;
      const isLoan = isPrestamoRutaExpense(line);
      if (kind === "operative" ? isLoan : !isLoan) continue;
      out.push(line);
    }
  }
  return out;
}

export function cloudOperativeExpenseLines(
  collectorRef: string,
  date: string,
): RouteExpenseLine[] {
  return linesFromDrafts(getCloudDayExpenses(collectorRef, date), "operative");
}

export function cloudPrestamoExpenseLines(
  collectorRef: string,
  date: string,
): RouteExpenseLine[] {
  return linesFromDrafts(getCloudDayExpenses(collectorRef, date), "prestamo");
}

/** Filtra renglones ya bajados (respuesta API) — no depende de otra lectura. */
export function operativeExpenseLinesForRouteFromDrafts(
  drafts: CollectorDayExpenseDraft[],
  route: string | null | undefined,
  chainCollector: boolean,
): RouteExpenseLine[] {
  return filterOperativeForRoute(linesFromDrafts(drafts, "operative"), route, chainCollector);
}

export function prestamoExpenseLinesForRouteFromDrafts(
  drafts: CollectorDayExpenseDraft[],
  route: string | null | undefined,
  clients: ClientRow[],
  loans: LoanRow[],
  date: string,
): RouteExpenseLine[] {
  return filterPrestamoForRoute(linesFromDrafts(drafts, "prestamo"), route, clients, loans, date);
}

function filterOperativeForRoute(
  all: RouteExpenseLine[],
  route: string | null | undefined,
  chainCollector: boolean,
): RouteExpenseLine[] {
  if (!all.length || !route) return all;
  if (isIndependentSaldoRoute(route)) {
    if (sameRoute(route, "N") || !chainCollector) return all;
    return all.filter((line) => sameRoute(line.route, route));
  }
  if (isPlanillaCashChainSecondary(route)) {
    return all.filter((line) => isSecondaryOperativeLine(line, PLANILLA_CASH_CHAIN_SECONDARY));
  }
  if (isPlanillaCashChainPrimary(route)) {
    return all.filter(
      (line) =>
        !isOwnPlanillaOperativeLine(line) &&
        !isSecondaryOperativeLine(line, PLANILLA_CASH_CHAIN_SECONDARY),
    );
  }
  return all;
}

function filterPrestamoForRoute(
  all: RouteExpenseLine[],
  route: string | null | undefined,
  clients: ClientRow[],
  loans: LoanRow[],
  date: string,
): RouteExpenseLine[] {
  if (!all.length || !route) return all;
  if (isIndependentSaldoRoute(route)) {
    return all.filter((line) => {
      if (sameRoute(line.route, route)) return true;
      const clientRef = clientRefOfPrestamoLine(line, loans, clients);
      const client = clients.find((row) => row.ref === clientRef);
      return sameRoute(client?.route, route);
    });
  }
  const base = chainSplitFromClients(clients);
  const split: ChainRouteSplit = {
    ...base,
    side: isPlanillaCashChainSecondary(route) ? "secondary" : "primary",
  };
  return all.filter((line) =>
    loanClientOnSide(clientRefOfPrestamoLine(line, loans, clients), split, date),
  );
}

/**
 * Misma regla que el libro: A/N con cobrador de cadena solo lo marcado;
 * N sola = todos; M = sin marca T/A/N; T = solo marca T.
 */
export function cloudOperativeExpenseLinesForRoute(
  collectorRef: string,
  date: string,
  route: string | null | undefined,
  chainCollector: boolean,
): RouteExpenseLine[] {
  return filterOperativeForRoute(
    cloudOperativeExpenseLines(collectorRef, date),
    route,
    chainCollector,
  );
}

/**
 * Préstamos en efectivo del GAS- por planilla (cliente de la ruta = dueño del renglón).
 */
export function cloudPrestamoExpenseLinesForRoute(
  collectorRef: string,
  date: string,
  route: string | null | undefined,
  clients: ClientRow[],
  loans: LoanRow[],
): RouteExpenseLine[] {
  return filterPrestamoForRoute(
    cloudPrestamoExpenseLines(collectorRef, date),
    route,
    clients,
    loans,
    date,
  );
}

export async function refreshCloudDayExpenses(
  collectorRef: string,
  date: string,
): Promise<CollectorDayExpenseDraft[] | null> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(
      `/api/ops/day-expenses?collectorRef=${encodeURIComponent(ref)}&date=${encodeURIComponent(date)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      expenses?: CollectorDayExpenseDraft[];
    };
    if (!res.ok || !body.ok || !Array.isArray(body.expenses)) return getCloudDayExpenses(ref, date);
    byKey.set(keyOf(ref, date), body.expenses);
    notify();
    // Persistir en el aparato (fallar aquí no debe tapar la lista en pantalla).
    if (body.expenses.length > 0) {
      try {
        const { BIG_DEMO_STORE_CHANGED_EVENT } = await import("@/lib/big-demo-store");
        const { DEMO_COLLECTOR_DAY_EXPENSES_KEY, readDemoJson, writeDemoJson } = await import(
          "@/lib/demo-persist"
        );
        const local = readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []);
        const map = new Map(local.filter((row) => row?.ref).map((row) => [row.ref, row]));
        let changed = false;
        for (const row of body.expenses) {
          if (!row?.ref) continue;
          const prev = map.get(row.ref);
          const prevLines = Array.isArray(prev?.expenses) ? prev!.expenses.length : 0;
          const nextLines = Array.isArray(row.expenses) ? row.expenses.length : 0;
          if (
            !prev ||
            nextLines > prevLines ||
            (Number(row.expensesTotal) || 0) > (Number(prev.expensesTotal) || 0)
          ) {
            map.set(row.ref, row);
            changed = true;
          }
        }
        if (changed) {
          writeDemoJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, [...map.values()]);
          window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));
        }
      } catch (persistError) {
        console.error("refreshCloudDayExpenses.persist", persistError);
      }
    }
    return body.expenses;
  } catch (error) {
    console.error("refreshCloudDayExpenses", error);
    return getCloudDayExpenses(ref, date);
  }
}
