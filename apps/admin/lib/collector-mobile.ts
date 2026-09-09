import {
  assignmentsForCollector,
  assignmentsForCollectorDate,
  dispatchRouteRef,
} from "@/lib/collector-dispatch-sync";
import { normalizeHistoryDate, type CollectorDayCloseRecord } from "@/lib/collector-day-close";
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
  /** Cierre formal del cobrador/oficina (dayClosedAt o CIE-). */
  closed: boolean;
  /** Ya no quedan visitas pendientes (puede faltar el cierre formal). */
  allDone: boolean;
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
  allDone: boolean;
};

function hasDayCloseRecord(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  date: string,
) {
  const norm = normalizeHistoryDate(date);
  return dayCloses.some(
    (row) => row.collectorRef === collectorRef && normalizeHistoryDate(row.date) === norm,
  );
}

export function collectorMobileQueue(
  collectorRef: string,
  date: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  routes: RouteRow[] = [],
  dayCloses: CollectorDayCloseRecord[] = [],
): CollectorMobileQueue {
  const dayItems = assignmentsForCollectorDate(assignments, collectorRef, date, loans, clients);
  const closedByCie = hasDayCloseRecord(dayCloses, collectorRef, date);
  // Si el CIE ya existe, toda la hoja del día cuenta aunque falte flag dispatched.
  const sheet = closedByCie ? dayItems : dayItems.filter((row) => row.dispatched);
  const awaitingDispatch = closedByCie
    ? []
    : dayItems.filter((row) => !row.dispatched);
  const closedByVisits =
    sheet.length > 0 && sheet.every((row) => Boolean(row.dayClosedAt));
  const closed = closedByCie || closedByVisits;

  const pending = closed
    ? []
    : sheet.filter((row) => {
        if (row.visitStatus === "cobrado" || row.visitStatus === "omitido") return false;
        if (row.visitStatus === "parcial" && row.paymentRef) return false;
        return row.visitStatus === "pendiente" || row.visitStatus === "parcial" || !row.visitStatus;
      });
  const done = closed
    ? sheet
    : sheet.filter(
        (row) =>
          row.visitStatus === "cobrado" ||
          row.visitStatus === "omitido" ||
          (row.visitStatus === "parcial" && Boolean(row.paymentRef)),
      );
  const routeRef = dispatchRouteRef(collectorRef, date);
  const route = routes.find((row) => row.ref === routeRef) ?? null;
  const allDone = closed || (sheet.length > 0 && pending.length === 0);

  return {
    date,
    dateLabel: isoToDispatchLabel(date),
    routeRef: route?.ref ?? null,
    routeName: route?.name ?? `Cobros · ${isoToDispatchLabel(date)}`,
    dispatched: sheet,
    pending,
    done,
    awaitingDispatch,
    closed,
    allDone,
  };
}

/** Rutas enviadas al cobrador (una por fecha de despacho). */
export function collectorMobileRoutes(
  collectorRef: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  routes: RouteRow[] = [],
  dayCloses: CollectorDayCloseRecord[] = [],
): CollectorMobileRouteOption[] {
  const dispatchedRows = assignmentsForCollector(assignments, collectorRef, loans, clients).filter(
    (row) => row.dispatched || row.dayClosedAt,
  );
  const dates = [
    ...new Set([
      ...dispatchedRows.map((row) => normalizeHistoryDate(row.dispatchDate) || row.dispatchDate),
      ...dayCloses
        .filter((row) => row.collectorRef === collectorRef)
        .map((row) => normalizeHistoryDate(row.date))
        .filter(Boolean),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  return dates.map((date) => {
    const queue = collectorMobileQueue(
      collectorRef,
      date,
      assignments,
      loans,
      clients,
      routes,
      dayCloses,
    );
    return {
      date,
      dateLabel: queue.dateLabel,
      routeRef: queue.routeRef ?? dispatchRouteRef(collectorRef, date),
      routeName: queue.routeName,
      pending: queue.pending.length,
      done: queue.done.length,
      total: queue.dispatched.length,
      closed: queue.closed,
      allDone: queue.allDone,
    };
  });
}

export function defaultMobileRouteDate(
  options: CollectorMobileRouteOption[],
  fallback = "",
): string {
  if (!options.length) return fallback;
  // Prioriza días abiertos formales atrasados, luego con pendientes, luego hoy.
  const openPast = options.find((row) => !row.closed && row.date < fallback);
  if (openPast) return openPast.date;
  const withPending = options.find((row) => row.pending > 0);
  if (withPending) return withPending.date;
  const openToday = options.find((row) => !row.closed && row.date === fallback);
  if (openToday) return openToday.date;
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
  const norm = normalizeHistoryDate(date) || date;
  for (const row of paymentsForCollector(collectorRef, collectors, payments)) {
    if (normalizeHistoryDate(row.paidDate || "") !== norm) continue;
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
  if (status === "cobrado") return "Pago";
  if (status === "parcial") return "Parcial";
  if (status === "omitido") return "sin cobro";
  return "Pendiente";
}

/** Etiqueta corta para planillas densas (app supervisor / tablas compactas). */
export function visitStatusLabelShort(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "pago";
  if (status === "parcial") return "Parc.";
  if (status === "omitido") return "S/C";
  return "Pend.";
}

export function visitStatusKind(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "ok" as const;
  if (status === "parcial") return "partial" as const;
  if (status === "omitido") return "overdue" as const;
  return "pending" as const;
}
