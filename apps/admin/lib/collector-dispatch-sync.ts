import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import { dailyLogRef, type CollectorDailyLogRow } from "@/lib/collector-daily-log";
import type { DailyCollectionAssignment, DailyCollectionItem } from "@/lib/daily-collection-plan";
import {
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type RouteStop,
} from "@/lib/mock-data";

export function dispatchRouteRef(collectorRef: string, date: string) {
  return `RUT-D-${collectorRef}-${date}`;
}

export function assignmentFromItem(
  item: DailyCollectionItem,
  collector: CollectorRow,
  date: string,
): DailyCollectionAssignment {
  return {
    itemId: item.id,
    dispatchDate: date,
    loanRef: item.loanRef,
    clientRef: item.clientRef,
    clientName: item.clientName,
    clientRoute: item.clientRoute,
    address: item.address,
    chargeDate: item.chargeDate,
    amountDue: item.amountDue,
    chargeLabel: item.chargeLabel,
    kind: item.kind,
    collectorRef: collector.ref,
    collector: collector.name,
    assignedAt: new Date().toISOString(),
    visitStatus: "pendiente",
  };
}

export function hydrateAssignment(
  row: DailyCollectionAssignment,
  loans: LoanRow[],
  clients: ClientRow[],
): DailyCollectionAssignment {
  const loan = loans.find((entry) => entry.ref === row.loanRef);
  const client = clients.find((entry) => entry.ref === (row.clientRef || loan?.clientRef));
  const amountDue =
    row.amountDue ??
    (loan?.installment && loan.installment > 0
      ? Math.min(loan.installment, loan.balance)
      : loan?.balance ?? 0);
  return {
    ...row,
    clientRef: row.clientRef ?? client?.ref ?? "",
    clientName:
      row.clientName ?? (client ? `${client.name} ${client.lastName}`.trim() : loan?.client ?? "—"),
    clientRoute: row.clientRoute ?? client?.route ?? "—",
    address: row.address ?? client?.address,
    amountDue,
    chargeLabel: row.chargeLabel ?? (row.kind === "mora" ? "Mora" : "Cuota"),
    kind: row.kind ?? "cuota",
    visitStatus: row.visitStatus ?? "pendiente",
  };
}

export function assignmentsForCollectorDate(
  assignments: DailyCollectionAssignment[],
  collectorRef: string,
  date: string,
  loans: LoanRow[],
  clients: ClientRow[],
) {
  return assignments
    .filter((row) => row.collectorRef === collectorRef && row.dispatchDate === date)
    .map((row) => hydrateAssignment(row, loans, clients));
}

export function assignmentsForCollector(
  assignments: DailyCollectionAssignment[],
  collectorRef: string,
  loans: LoanRow[],
  clients: ClientRow[],
) {
  return assignments
    .filter((row) => row.collectorRef === collectorRef)
    .map((row) => hydrateAssignment(row, loans, clients))
    .sort((a, b) => b.dispatchDate.localeCompare(a.dispatchDate) || a.clientName.localeCompare(b.clientName));
}

export function buildDispatchRoute(
  collectorRef: string,
  collectorName: string,
  date: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  existingRoute?: RouteRow,
): RouteRow {
  const items = assignmentsForCollectorDate(assignments, collectorRef, date, loans, clients);
  const stops: RouteStop[] = items.map((item, index) => {
    const existing = existingRoute?.stops.find(
      (stop) => stop.clientRef === item.clientRef && stop.loanRef === item.loanRef,
    );
    if (existing) return { ...existing, visitOrder: index + 1 };
    return {
      clientRef: item.clientRef,
      visitOrder: index + 1,
      loanRef: item.loanRef,
      amountDue: item.amountDue,
      visitStatus: item.visitStatus ?? "pendiente",
      paymentRef: item.paymentRef,
    };
  });
  const zones = [...new Set(items.map((row) => row.clientRoute).filter((row) => row && row !== "—"))];
  const pending = stops.filter(
    (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
  ).length;

  return {
    ref: dispatchRouteRef(collectorRef, date),
    id: `cobros-${date}`,
    name: `Cobros del día · ${isoToDispatchLabel(date)}`,
    collectorRef,
    collector: collectorName,
    zone: zones.length === 1 ? zones[0]! : zones.length > 1 ? "Varias zonas" : "—",
    frequency: "Diario",
    stops,
    clients: stops.length,
    status: pending > 0 ? "En curso" : stops.length ? "Cerrada" : "En curso",
    kind: pending > 0 ? "pending" : stops.length ? "paid" : "draft",
    scheduledDate: date,
  };
}

export function upsertDispatchRoute(routes: RouteRow[], route: RouteRow) {
  const index = routes.findIndex((row) => row.ref === route.ref);
  if (index < 0) return [...routes, route];
  const next = [...routes];
  next[index] = route;
  return next;
}

export function markAssignmentsDispatched(
  assignments: DailyCollectionAssignment[],
  date: string,
  collectorRefs: string[],
  at: string,
) {
  const set = new Set(collectorRefs);
  return assignments.map((row) =>
    row.dispatchDate === date && set.has(row.collectorRef)
      ? { ...row, dispatched: true, dispatchedAt: at }
      : row,
  );
}

export function upsertDispatchDailyLog(
  logs: CollectorDailyLogRow[],
  route: RouteRow,
  date: string,
): CollectorDailyLogRow[] {
  const ref = dailyLogRef(route.collectorRef, date);
  const visitsPlanned = route.stops.length;
  const visitsDone = route.stops.filter((stop) => stop.visitStatus === "cobrado").length;
  const visitsPartial = route.stops.filter((stop) => stop.visitStatus === "parcial").length;
  const visitsPending = route.stops.filter(
    (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
  ).length;
  const existing = logs.find((row) => row.ref === ref);
  const next: CollectorDailyLogRow = {
    ref,
    collectorRef: route.collectorRef,
    date,
    dateLabel: isoToDispatchLabel(date),
    routeRef: route.ref,
    routeName: route.name,
    zone: route.zone,
    visitsPlanned,
    visitsDone,
    visitsPartial,
    visitsPending,
    collected: existing?.collected ?? 0,
    paymentsCount: existing?.paymentsCount ?? 0,
    startedAt: existing?.startedAt ?? new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
    closedAt: existing?.closedAt,
    status: route.status,
    kind: route.kind,
    summary:
      existing?.summary ||
      `${visitsPlanned} visita${visitsPlanned === 1 ? "" : "s"} programada${visitsPlanned === 1 ? "" : "s"}`,
  };
  const rest = logs.filter((row) => row.ref !== ref);
  return [next, ...rest].sort((a, b) => b.date.localeCompare(a.date));
}

export function isDispatchRoute(route: RouteRow) {
  return route.ref.startsWith("RUT-D-") || Boolean(route.scheduledDate);
}

export function collectorProgramDays(
  collectorRef: string,
  collectorName: string,
  assignments: DailyCollectionAssignment[],
  routes: RouteRow[],
  loans: LoanRow[],
  clients: ClientRow[],
): {
  date: string;
  dateLabel: string;
  dispatched: boolean;
  route: RouteRow | null;
  items: DailyCollectionAssignment[];
}[] {
  const items = assignmentsForCollector(assignments, collectorRef, loans, clients);
  const dates = [...new Set(items.map((row) => row.dispatchDate))].sort((a, b) => b.localeCompare(a));
  return dates.map((date) => {
    const dayItems = items.filter((row) => row.dispatchDate === date);
    const dispatched = dayItems.some((row) => row.dispatched);
    const existing = routes.find((row) => row.ref === dispatchRouteRef(collectorRef, date)) ?? null;
    const route =
      existing ??
      (dispatched
        ? buildDispatchRoute(collectorRef, collectorName, date, assignments, loans, clients)
        : null);
    return {
      date,
      dateLabel: isoToDispatchLabel(date),
      dispatched,
      route,
      items: dayItems,
    };
  });
}

export function collectorDispatchRoutes(collectorRef: string, routes: RouteRow[]): RouteRow[] {
  return collectorRoutesView(collectorRef, routes).filter(isDispatchRoute);
}

export function collectorRoutesView(
  collectorRef: string,
  routes: RouteRow[],
): RouteRow[] {
  return routes
    .filter((row) => row.collectorRef === collectorRef)
    .sort((a, b) => {
      const aDispatch = isDispatchRoute(a) ? 1 : 0;
      const bDispatch = isDispatchRoute(b) ? 1 : 0;
      if (aDispatch !== bDispatch) return bDispatch - aDispatch;
      return (b.scheduledDate ?? "").localeCompare(a.scheduledDate ?? "");
    });
}

export function applyPaymentToAssignments(
  assignments: DailyCollectionAssignment[],
  payment: PaymentRow,
  dispatchDate: string,
) {
  if (!payment.collectorRef || !payment.loanRef) return assignments;
  return assignments.map((row) => {
    if (row.dispatchDate !== dispatchDate) return row;
    if (row.collectorRef !== payment.collectorRef) return row;
    if (row.loanRef !== payment.loanRef) return row;
    const visitStatus =
      payment.amount >= row.amountDue ? "cobrado" : payment.amount > 0 ? "parcial" : row.visitStatus;
    return {
      ...row,
      visitStatus,
      paymentRef: payment.ref,
    };
  });
}

export function rebuildDispatchRoutes(
  routes: RouteRow[],
  assignments: DailyCollectionAssignment[],
  collectors: CollectorRow[],
  loans: LoanRow[],
  clients: ClientRow[],
) {
  let next = routes.filter((row) => !row.ref.startsWith("RUT-D-"));
  const dispatched = assignments.filter((row) => row.dispatched);
  const keys = new Set(dispatched.map((row) => `${row.collectorRef}::${row.dispatchDate}`));
  for (const key of keys) {
    const [collectorRef, date] = key.split("::");
    const collector = collectors.find((row) => row.ref === collectorRef);
    if (!collector) continue;
    const existing = routes.find((row) => row.ref === dispatchRouteRef(collectorRef, date));
    next = upsertDispatchRoute(
      next,
      buildDispatchRoute(collectorRef, collector.name, date, assignments, loans, clients, existing),
    );
  }
  return next;
}
