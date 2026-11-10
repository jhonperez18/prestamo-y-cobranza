/**
 * Préstamo del supervisor / admin con origen «Caja de la ruta»: lo hace el supervisor,
 * pero lo asume la ruta del cliente. Mismo renglón que un préstamo en efectivo del cobrador:
 * «Préstamo · P-…» en el GAS- de hoy del cobrador de la ruta → KPI Préstamo, lista de la
 * ruta y resta de su caja (libro M/T por ruta del cliente). Nunca entra a una caja cerrada.
 */
import {
  appendCashDisbursementExpense,
  buildDayExpenseDraft,
  dayExpenseDraftRef,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
  type RouteExpenseLine,
} from "@/lib/collector-day-close";
import { sameRoute } from "@/lib/client-route-order";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isPrestamoRutaExpense } from "@/lib/expense-lines";
import { displayToIso } from "@/lib/loan-preview";
import {
  defaultFundedByForRoute,
  disbursementAllowedOnRoute,
  loanFundedByEfectivo,
} from "@/lib/nequi-pool";
import {
  catalogRoutes,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type RouteRow,
} from "@/lib/mock-data";
import { routeCollectorCashTarget } from "@/lib/route-collector-cash";

export type SupervisorLoanOrigin = "nequi" | "banco" | "efectivo" | "combinado";

/**
 * Supervisor / admin: Nequi (solo A), Banco (M/T/N), Caja o Combinado.
 * Sin origen → digital de la ruta (A→Nequi; resto→Banco).
 */
export function supervisorLoanOrigin(
  origin: string | undefined,
  route?: string | null,
): SupervisorLoanOrigin {
  if (origin === "efectivo" || origin === "combinado") return origin;
  if (
    (origin === "banco" || origin === "nequi") &&
    disbursementAllowedOnRoute(origin, route)
  ) {
    return origin;
  }
  const fallback = defaultFundedByForRoute(route, "supervisor");
  return fallback === "banco" || fallback === "nequi" || fallback === "efectivo" || fallback === "combinado"
    ? fallback
    : "efectivo";
}

export type RouteCashLoanSources = {
  clients: ClientRow[];
  routes: RouteRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  date: string;
  now: Date;
};

export type RouteCashLoanTarget =
  | { ok: true; collector: CollectorRow; routeRef: string }
  | { ok: false; error: string };

/** Cobrador que asume el préstamo hoy (planilla del día o fijo de la ruta), con caja abierta. */
export function routeCashLoanTarget(
  clientRef: string,
  src: RouteCashLoanSources,
): RouteCashLoanTarget {
  const target = routeCollectorCashTarget({ ...src, loan: { ref: "", clientRef } });
  if (!target.ok) return { ok: false, error: target.error };
  const client = src.clients.find((row) => row.ref === clientRef);
  const routeRef = client?.route
    ? catalogRoutes(src.routes).find((row) => sameRoute(row.name, client.route))?.ref || ""
    : "";
  return { ok: true, collector: target.collector, routeRef };
}

/**
 * Candado: un renglón «Préstamo · P-…» solo vive en el GAS del cobrador de la ruta del cliente.
 * Si el cliente es de N, no puede quedar en el GAS de Edgar (caso P-717 doble).
 * Sin ficha/ruta conocida no se toca (no inventar bajas).
 */
export function prestamoLineBelongsToCollector(
  line: Pick<RouteExpenseLine, "category" | "id" | "loanRef">,
  collectorRef: string,
  clients: ClientRow[],
  loans: LoanRow[],
  routes: RouteRow[],
): boolean {
  if (!isPrestamoRutaExpense(line)) return true;
  const loanRef = String(line.loanRef || "").trim();
  if (!loanRef) return true;
  const loan = loans.find((row) => row.ref === loanRef);
  const clientRef = String(loan?.clientRef || "").trim();
  if (!clientRef) return true;
  const client = clients.find((row) => row.ref === clientRef);
  const routeName = String(client?.route || "").trim();
  if (!routeName) return true;
  const owner = String(
    catalogRoutes(routes).find((row) => sameRoute(row.name, routeName))?.collectorRef || "",
  ).trim();
  if (!owner) return true;
  return owner === String(collectorRef || "").trim();
}

/** Suelta del GAS los Haber de préstamo que no son de la ruta de ese cobrador. */
export function scrubForeignPrestamoExpenses(
  draft: CollectorDayExpenseDraft,
  clients: ClientRow[],
  loans: LoanRow[],
  routes: RouteRow[],
): CollectorDayExpenseDraft {
  const expenses = (draft.expenses || []).filter((line) =>
    prestamoLineBelongsToCollector(line, draft.collectorRef, clients, loans, routes),
  );
  if (expenses.length === (draft.expenses || []).length) return draft;
  return buildDayExpenseDraft({
    collectorRef: draft.collectorRef,
    collectorName: draft.collectorName,
    date: draft.date,
    routeRef: draft.routeRef,
    expenses,
  });
}

export type RouteCashLoanCommit =
  | {
      ok: true;
      collector: CollectorRow;
      drafts: CollectorDayExpenseDraft[];
      draft: CollectorDayExpenseDraft;
    }
  | { ok: false; error: string };

/**
 * Préstamo de hoy pasado a «Caja de la ruta» (Modificar préstamo) que aún no tiene su
 * renglón en ningún GAS-: hay que cargarlo a la caja de la ruta. Días pasados no se tocan.
 */
export function routeCashLoanLineMissing(
  loan: Pick<LoanRow, "ref" | "date" | "fundedBy" | "notes" | "capital" | "cashOut" | "bankOut">,
  drafts: CollectorDayExpenseDraft[],
  date: string,
): boolean {
  // Efectivo puro o tramo de caja del combinado.
  if (!loanFundedByEfectivo(loan) || displayToIso(loan.date) !== date) return false;
  return !drafts.some((draft) =>
    draft.expenses.some((line) => line.loanRef === loan.ref && isPrestamoRutaExpense(line)),
  );
}

/**
 * Con `topUp`: anexo — capital sumado a un préstamo cuyo día de desembolso ya cerró. Sale hoy
 * de la caja de la ruta del cliente, como si el cobrador hiciera el préstamo hoy.
 */
export function commitRouteCashLoan(
  loan: Pick<
    LoanRow,
    "ref" | "client" | "capital" | "clientRef" | "fundedBy" | "notes" | "cashOut" | "bankOut"
  >,
  drafts: CollectorDayExpenseDraft[],
  src: RouteCashLoanSources,
  topUp?: number,
): RouteCashLoanCommit {
  const target = routeCashLoanTarget(loan.clientRef, src);
  if (!target.ok) return target;
  const next = appendCashDisbursementExpense(drafts, {
    collectorRef: target.collector.ref,
    collectorName: target.collector.name,
    date: src.date,
    routeRef: target.routeRef,
    loan,
    topUp,
  });
  const ref = dayExpenseDraftRef(target.collector.ref, src.date);
  const draft = next.find((row) => row.ref === ref);
  if (!draft) {
    return {
      ok: false,
      error: `No se pudo anotar el ${topUp !== undefined ? "anexo" : "préstamo"} en la caja de la ruta.`,
    };
  }
  return { ok: true, collector: target.collector, drafts: next, draft };
}
