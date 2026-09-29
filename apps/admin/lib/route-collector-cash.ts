/**
 * Caja del cobrador de la ruta para cobros registrados en el panel del taller
 * (Pagar cuota / Abono con destino «cobrador», Pago tardío).
 *
 * - Efectivo → suma a la caja de hoy del cobrador (libro del día, lado M o T según la ruta del cliente).
 * - Nequi / banco → queda en el Nequi de esa ruta (lo ve el supervisor); no entra a «En caja».
 * - Nunca entra a una caja ya cerrada hoy.
 */
import { normalizeHistoryDate, type CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { isCollectorDayClosedForPayments } from "@/lib/collector-day-auto-close";
import { sameRoute } from "@/lib/client-route-order";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isPlanillaCashCloseRef } from "@/lib/planilla-cash-chain";
import {
  catalogRoutes,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type RouteRow,
} from "@/lib/mock-data";

type LoanRef = Pick<LoanRow, "ref" | "clientRef">;

function assignmentTouchesLoan(row: DailyCollectionAssignment, loan: LoanRef) {
  return row.loanRef === loan.ref || (Boolean(loan.clientRef) && row.clientRef === loan.clientRef);
}

/** Cobrador de la visita en la planilla de ese día (si existe). */
export function planillaCollectorRef(
  assignments: DailyCollectionAssignment[],
  loan: LoanRef,
  date: string,
): string {
  return (
    assignments.find(
      (row) => row.dispatchDate === date && Boolean(row.collectorRef) && assignmentTouchesLoan(row, loan),
    )?.collectorRef || ""
  );
}

/** Cobrador dueño del cliente hoy: el de la planilla del día; si no, el fijo de su ruta. */
export function routeCollectorForLoan(input: {
  loan: LoanRef;
  clients: ClientRow[];
  routes: RouteRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  date: string;
}): CollectorRow | null {
  const fromPlanilla = planillaCollectorRef(input.assignments, input.loan, input.date);
  const client = input.clients.find((row) => row.ref === input.loan.clientRef);
  const fromRoute = client?.route
    ? catalogRoutes(input.routes).find((row) => sameRoute(row.name, client.route))?.collectorRef || ""
    : "";
  const ref = fromPlanilla || fromRoute;
  return input.collectors.find((row) => row.ref === ref) ?? null;
}

/** ¿La caja de ese cobrador ya cerró ese día (cierre manual, CIE- o corte 23:30)? */
export function collectorCashClosedOn(input: {
  collectorRef: string;
  loan: LoanRef;
  dayCloses: CollectorDayCloseRecord[];
  assignments: DailyCollectionAssignment[];
  date: string;
  now: Date;
}): boolean {
  if (isCollectorDayClosedForPayments(input.date, input.now)) return true;
  const sealed = input.dayCloses.some(
    (row) =>
      row.collectorRef === input.collectorRef &&
      !isPlanillaCashCloseRef(row.ref) &&
      !row.provisional &&
      (normalizeHistoryDate(row.date) || row.date) === input.date,
  );
  if (sealed) return true;
  return input.assignments.some(
    (row) =>
      row.collectorRef === input.collectorRef &&
      row.dispatchDate === input.date &&
      Boolean(row.dayClosedAt) &&
      assignmentTouchesLoan(row, input.loan),
  );
}

export type RouteCollectorCashTarget =
  | { ok: true; collector: CollectorRow }
  | { ok: false; collector: CollectorRow | null; error: string };

/** Destino «cobrador de la ruta» para un cobro del panel hoy. */
export function routeCollectorCashTarget(input: {
  loan: LoanRef;
  clients: ClientRow[];
  routes: RouteRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  date: string;
  now: Date;
}): RouteCollectorCashTarget {
  const collector = routeCollectorForLoan(input);
  if (!collector) {
    return { ok: false, collector: null, error: "La ruta de este cliente no tiene cobrador asignado." };
  }
  const closed = collectorCashClosedOn({ ...input, collectorRef: collector.ref });
  if (closed) {
    return {
      ok: false,
      collector,
      error: `La caja de hoy de ${collector.name} ya cerró. La plata no puede entrar a una caja cerrada.`,
    };
  }
  return { ok: true, collector };
}
