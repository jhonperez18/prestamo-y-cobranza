/**
 * Préstamo del supervisor / admin con origen «Caja de la ruta»: lo hace el supervisor,
 * pero lo asume la ruta del cliente. Mismo renglón que un préstamo en efectivo del cobrador:
 * «Préstamo · P-…» en el GAS- de hoy del cobrador de la ruta → KPI Préstamo, lista de la
 * ruta y resta de su caja (libro M/T por ruta del cliente). Nunca entra a una caja cerrada.
 */
import {
  appendCashDisbursementExpense,
  dayExpenseDraftRef,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import { sameRoute } from "@/lib/client-route-order";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isPrestamoRutaExpense } from "@/lib/expense-lines";
import { displayToIso } from "@/lib/loan-preview";
import { loanFundedByEfectivo } from "@/lib/nequi-pool";
import {
  catalogRoutes,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type RouteRow,
} from "@/lib/mock-data";
import { routeCollectorCashTarget } from "@/lib/route-collector-cash";

export type SupervisorLoanOrigin = "nequi" | "banco" | "efectivo";

/** Supervisor / admin: Nequi, Banco o Caja de la ruta (efectivo). Sin origen → Nequi. */
export function supervisorLoanOrigin(origin: string | undefined): SupervisorLoanOrigin {
  return origin === "banco" || origin === "efectivo" ? origin : "nequi";
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
  loan: Pick<LoanRow, "ref" | "date" | "fundedBy" | "notes">,
  drafts: CollectorDayExpenseDraft[],
  date: string,
): boolean {
  if (!loanFundedByEfectivo(loan) || displayToIso(loan.date) !== date) return false;
  return !drafts.some((draft) =>
    draft.expenses.some((line) => line.loanRef === loan.ref && isPrestamoRutaExpense(line)),
  );
}

export function commitRouteCashLoan(
  loan: Pick<LoanRow, "ref" | "client" | "capital" | "clientRef">,
  drafts: CollectorDayExpenseDraft[],
  src: RouteCashLoanSources,
): RouteCashLoanCommit {
  const target = routeCashLoanTarget(loan.clientRef, src);
  if (!target.ok) return target;
  const next = appendCashDisbursementExpense(drafts, {
    collectorRef: target.collector.ref,
    collectorName: target.collector.name,
    date: src.date,
    routeRef: target.routeRef,
    loan,
  });
  const ref = dayExpenseDraftRef(target.collector.ref, src.date);
  const draft = next.find((row) => row.ref === ref);
  if (!draft) return { ok: false, error: "No se pudo anotar el préstamo en la caja de la ruta." };
  return { ok: true, collector: target.collector, drafts: next, draft };
}
