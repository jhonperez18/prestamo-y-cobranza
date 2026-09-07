import {
  assignmentsForCollector,
  assignmentsForCollectorDate,
  dispatchRouteRef,
} from "@/lib/collector-dispatch-sync";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow, RouteRow } from "@/lib/mock-data";
import { paymentsForCollector } from "@/lib/mock-data";
import { normalizePaymentMethod } from "@/lib/payment-method";

export type CollectorMobileQueue = {
  date: string;
  dateLabel: string;
  routeRef: string | null;
  routeName: string;
  /** Cobros ya enviados al móvil */
  dispatched: DailyCollectionAssignment[];
  pending: DailyCollectionAssignment[];
  done: DailyCollectionAssignment[];
  /** Asignados pero aún no enviados desde Cobranza */
  awaitingDispatch: DailyCollectionAssignment[];
  closed: boolean;
};

export type CollectorMobileRouteOption = {
  date: string;
  dateLabel: string;
  routeRef: string;
  routeName: string;
  pending: number;
  done: number;
  total: number;
  closed: boolean;
};

export function collectorMobileQueue(
  collectorRef: string,
  date: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  routes: RouteRow[] = [],
): CollectorMobileQueue {
  const dayItems = assignmentsForCollectorDate(assignments, collectorRef, date, loans, clients);
  const dispatched = dayItems.filter((row) => row.dispatched);
  const awaitingDispatch = dayItems.filter((row) => !row.dispatched);
  const pending = dispatched.filter(
    (row) => row.visitStatus === "pendiente" || row.visitStatus === "parcial" || !row.visitStatus,
  );
  const done = dispatched.filter(
    (row) =>
      row.visitStatus === "cobrado" ||
      row.visitStatus === "omitido" ||
      (row.visitStatus === "parcial" && Boolean(row.paymentRef)),
  );
  const routeRef = dispatchRouteRef(collectorRef, date);
  const route = routes.find((row) => row.ref === routeRef) ?? null;
  const dayClosed = Boolean(dispatched.length && dispatched.every((row) => row.dayClosedAt));
  // Solo cierra si oficina/cobrador cerró el día, o ya no hay pendientes.
  // No usar solo route.status === "Cerrada": un pago no debe bloquear el resto.
  const closed = dayClosed || (dispatched.length > 0 && pending.length === 0);

  return {
    date,
    dateLabel: isoToDispatchLabel(date),
    routeRef: route?.ref ?? null,
    routeName: route?.name ?? `Cobros · ${isoToDispatchLabel(date)}`,
    dispatched,
    pending,
    done,
    awaitingDispatch,
    closed,
  };
}

/** Rutas enviadas al cobrador (una por fecha de despacho). */
export function collectorMobileRoutes(
  collectorRef: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  routes: RouteRow[] = [],
): CollectorMobileRouteOption[] {
  const dispatchedRows = assignmentsForCollector(assignments, collectorRef, loans, clients).filter(
    (row) => row.dispatched,
  );
  const dates = [...new Set(dispatchedRows.map((row) => row.dispatchDate))].sort((a, b) =>
    b.localeCompare(a),
  );

  return dates.map((date) => {
    const queue = collectorMobileQueue(collectorRef, date, assignments, loans, clients, routes);
    return {
      date,
      dateLabel: queue.dateLabel,
      routeRef: queue.routeRef ?? dispatchRouteRef(collectorRef, date),
      routeName: queue.routeName,
      pending: queue.pending.length,
      done: queue.done.length,
      total: queue.dispatched.length,
      closed: queue.closed,
    };
  });
}

export function defaultMobileRouteDate(
  options: CollectorMobileRouteOption[],
  fallback = "",
): string {
  if (!options.length) return fallback;
  const withPending = options.find((row) => row.pending > 0);
  if (withPending) return withPending.date;
  return options[0].date;
}

/** Suma de cobros del día por medio (efectivo / Nequi) para que el cobrador cuadre su caja. */
export function collectorRecaudoBreakdown(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  collectors: CollectorRow[] = [],
) {
  let efectivo = 0;
  let nequi = 0;
  let count = 0;
  for (const row of paymentsForCollector(collectorRef, collectors, payments)) {
    if (row.paidDate !== date) continue;
    count += 1;
    if (normalizePaymentMethod(row.method) === "nequi") nequi += row.amount;
    else efectivo += row.amount;
  }
  return { efectivo, nequi, total: efectivo + nequi, count };
}

export function collectorRecaudoForDate(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  collectors: CollectorRow[] = [],
) {
  return collectorRecaudoBreakdown(collectorRef, date, payments, collectors).total;
}

export function visitStatusLabel(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "Cobrado";
  if (status === "parcial") return "Parcial";
  if (status === "omitido") return "sin cobro";
  return "Pendiente";
}

export function visitStatusKind(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "paid" as const;
  if (status === "parcial") return "partial" as const;
  if (status === "omitido") return "overdue" as const;
  return "pending" as const;
}
