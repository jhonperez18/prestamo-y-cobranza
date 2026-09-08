import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import { dailyLogRef, type CollectorDailyLogRow } from "@/lib/collector-daily-log";
import type { DailyCollectionAssignment, DailyCollectionItem } from "@/lib/daily-collection-plan";
import {
  collectionAlertLabel,
  collectionChargeKind,
  loanCollectionAlerts,
} from "@/lib/collection-alerts";
import { isValidPlanillaAssignment } from "@/lib/planilla-eligibility";
import { dedupePlanillaAssignments } from "@/lib/planilla-dedupe";
import type {
  ClientRow,
  CollectorRow,
  LoanRow,
  PaymentRow,
  RouteRow,
  RouteStop,
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
    alertCount: item.alertCount,
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
    row.awaitingLoan
      ? 0
      : row.amountDue ??
        (loan?.installment && loan.installment > 0
          ? Math.min(loan.installment, loan.balance)
          : loan?.balance ?? 0);
  const alertCount = row.awaitingLoan
    ? 0
    : loan
      ? loanCollectionAlerts(loan)
      : Number(row.alertCount) || 0;
  const kind = row.awaitingLoan
    ? "cuota"
    : loan
      ? collectionChargeKind(alertCount)
      : row.kind ?? "cuota";
  return {
    ...row,
    clientRef: row.clientRef ?? client?.ref ?? "",
    clientName:
      row.clientName ?? (client ? `${client.name} ${client.lastName}`.trim() : loan?.client ?? "—"),
    clientRoute: row.clientRoute ?? client?.route ?? "—",
    address: row.address ?? client?.address,
    amountDue,
    alertCount,
    kind,
    chargeLabel: row.awaitingLoan
      ? "Completar"
      : collectionAlertLabel(alertCount) || row.chargeLabel || "Cuota",
    visitStatus: row.visitStatus ?? "pendiente",
    awaitingLoan: Boolean(row.awaitingLoan),
  };
}

export function assignmentsForCollectorDate(
  assignments: DailyCollectionAssignment[],
  collectorRef: string,
  date: string,
  loans: LoanRow[],
  clients: ClientRow[],
) {
  const orderOf = (clientRef: string) => {
    const client = clients.find((row) => row.ref === clientRef);
    return client?.routeOrder && client.routeOrder > 0
      ? client.routeOrder
      : Number.MAX_SAFE_INTEGER;
  };
  return dedupePlanillaAssignments(
    assignments
      .filter((row) => row.collectorRef === collectorRef && row.dispatchDate === date)
      .filter((row) => isValidPlanillaAssignment(row, clients, loans)),
  )
    .map((row) => hydrateAssignment(row, loans, clients))
    .sort(
      (a, b) =>
        orderOf(a.clientRef) - orderOf(b.clientRef) ||
        a.clientName.localeCompare(b.clientName, "es") ||
        a.loanRef.localeCompare(b.loanRef),
    );
}

export function assignmentsForCollector(
  assignments: DailyCollectionAssignment[],
  collectorRef: string,
  loans: LoanRow[],
  clients: ClientRow[],
) {
  return dedupePlanillaAssignments(
    assignments
      .filter((row) => row.collectorRef === collectorRef)
      .filter((row) => isValidPlanillaAssignment(row, clients, loans)),
  )
    .map((row) => hydrateAssignment(row, loans, clients))
    .sort(
      (a, b) =>
        b.dispatchDate.localeCompare(a.dispatchDate) || a.clientName.localeCompare(b.clientName),
    );
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
      (stop) =>
        stop.clientRef === item.clientRef &&
        (!stop.loanRef || !item.loanRef || stop.loanRef === item.loanRef),
    );
    // Preferir estado de la asignación (cobrado al pagar); no resucitar pendiente del stop viejo.
    const visitStatus = item.visitStatus ?? existing?.visitStatus ?? "pendiente";
    const paymentRef = item.paymentRef ?? existing?.paymentRef;
    return {
      clientRef: item.clientRef,
      visitOrder: index + 1,
      loanRef: item.loanRef || existing?.loanRef,
      amountDue:
        visitStatus === "cobrado" || visitStatus === "omitido"
          ? 0
          : item.amountDue ?? existing?.amountDue ?? 0,
      visitStatus,
      paymentRef,
    };
  });
  const zones = [...new Set(items.map((row) => row.clientRoute).filter((row) => row && row !== "—"))];
  const pending = stops.filter(
    (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
  ).length;
  // Si aún hay pendientes, la ruta sigue abierta (un cobro no la cierra).
  const closed = pending === 0 && stops.length > 0;

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
    status: closed ? "Cerrada" : "En curso",
    kind: closed ? ("paid" as const) : "pending",
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
  clientRef?: string,
) {
  const paymentLoanRef = payment.loanRef?.trim() || "";
  if (!paymentLoanRef) return assignments;

  const targetClient = clientRef?.trim() || "";
  const collectorRef = payment.collectorRef?.trim() || "";
  const dateHints = [...new Set([dispatchDate, payment.paidDate].filter(Boolean))] as string[];

  function rowMatches(row: DailyCollectionAssignment, date: string) {
    if (row.dispatchDate !== date) return false;
    if (row.visitStatus === "omitido") return false;
    if (collectorRef && row.collectorRef !== collectorRef) return false;
    if (row.loanRef && row.loanRef === paymentLoanRef) return true;
    if (targetClient && row.clientRef === targetClient) return true;
    return false;
  }

  let hit = false;
  const next = assignments.map((row) => {
    const dateHit = dateHints.some((date) => rowMatches(row, date));
    if (!dateHit) return row;
    hit = true;
    // Cobro registrado = visita hecha: sale de “Por cobrar”.
    return {
      ...row,
      loanRef: row.loanRef || paymentLoanRef,
      amountDue: 0,
      visitStatus: "cobrado" as const,
      paymentRef: payment.ref,
    };
  });
  if (hit) return next;

  // Fallback: misma visita abierta del cobrador/cliente sin importar desfase de fecha.
  return assignments.map((row) => {
    if (row.visitStatus === "omitido" || row.visitStatus === "cobrado") return row;
    if (row.dayClosedAt) return row;
    if (collectorRef && row.collectorRef !== collectorRef) return row;
    const loanOk = row.loanRef === paymentLoanRef;
    const clientOk = Boolean(targetClient) && row.clientRef === targetClient;
    if (!loanOk && !clientOk) return row;
    return {
      ...row,
      loanRef: row.loanRef || paymentLoanRef,
      amountDue: 0,
      visitStatus: "cobrado" as const,
      paymentRef: payment.ref,
    };
  });
}

/** Marca una visita no realizada (no localizado, enfermo, etc.). */
export function skipAssignmentVisit(
  assignments: DailyCollectionAssignment[],
  input: {
    collectorRef: string;
    dispatchDate: string;
    loanRef: string;
    clientRef?: string;
    reason?: string;
  },
): DailyCollectionAssignment[] {
  return assignments.map((row) => {
    if (row.dispatchDate !== input.dispatchDate) return row;
    if (row.collectorRef !== input.collectorRef) return row;
    if (row.loanRef !== input.loanRef) return row;
    if (input.clientRef && row.clientRef !== input.clientRef) return row;
    if (row.visitStatus === "cobrado") return row;
    return {
      ...row,
      visitStatus: "omitido" as const,
      skipReason: input.reason?.trim() || row.skipReason || "No pudo visitar",
    };
  });
}

export function applySkipToRoute(route: RouteRow, loanRef: string, clientRef?: string): RouteRow {
  const stops = route.stops.map((stop) => {
    if (stop.loanRef !== loanRef) return stop;
    if (clientRef && stop.clientRef !== clientRef) return stop;
    if (stop.visitStatus === "cobrado") return stop;
    return { ...stop, visitStatus: "omitido" as const };
  });
  const pending = stops.filter(
    (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
  ).length;
  return {
    ...route,
    stops,
    status: pending > 0 ? route.status : "Cerrada",
    kind: pending > 0 ? route.kind : "paid",
  };
}

export type CloseDayResult = {
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  logs: CollectorDailyLogRow[];
  skipped: number;
  /** Préstamos sin cobro al cerrar (para sumar alerta 1–4 / mora al 5). */
  missedLoanRefs: string[];
  collected: number;
  collectorsClosed: number;
};

/**
 * Cierre de jornada: pendientes → omitido; rutas → Cerrada; log con closedAt.
 * No envía a mora de una: las faltas se contabilizan como alertas (1–4) y mora al 5.º.
 */
export function closeDispatchDay(
  assignments: DailyCollectionAssignment[],
  routes: RouteRow[],
  logs: CollectorDailyLogRow[],
  date: string,
  collectors: CollectorRow[],
  loans: LoanRow[],
  clients: ClientRow[],
  collectorRef?: string,
): CloseDayResult {
  const closedAt = new Date().toLocaleTimeString("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const dispatched = assignments.filter(
    (row) =>
      row.dispatchDate === date &&
      row.dispatched &&
      (!collectorRef || row.collectorRef === collectorRef),
  );
  const collectorRefs = [...new Set(dispatched.map((row) => row.collectorRef))];

  let skipped = 0;
  const missedLoanRefs: string[] = [];
  const nextAssignments = assignments.map((row) => {
    if (row.dispatchDate !== date || !row.dispatched) return row;
    if (collectorRef && row.collectorRef !== collectorRef) return row;
    let next = { ...row, dayClosedAt: closedAt };
    if (row.visitStatus === "pendiente" || !row.visitStatus) {
      skipped += 1;
      if (row.loanRef) missedLoanRefs.push(row.loanRef);
      next = {
        ...next,
        visitStatus: "omitido" as const,
        skipReason: row.skipReason || "Cierre de jornada",
      };
    }
    return next;
  });

  let nextRoutes = routes;
  let nextLogs = logs;
  let collected = 0;

  for (const ref of collectorRefs) {
    const collector = collectors.find((row) => row.ref === ref);
    if (!collector) continue;
    const existing = nextRoutes.find((row) => row.ref === dispatchRouteRef(ref, date));
    const rebuilt = buildDispatchRoute(
      ref,
      collector.name,
      date,
      nextAssignments,
      loans,
      clients,
      existing,
    );
    const closedRoute: RouteRow = {
      ...rebuilt,
      status: "Cerrada",
      kind: "paid",
    };
    nextRoutes = upsertDispatchRoute(nextRoutes, closedRoute);

    const visitsSkipped = closedRoute.stops.filter((s) => s.visitStatus === "omitido").length;
    const visitsDone = closedRoute.stops.filter((s) => s.visitStatus === "cobrado").length;
    const visitsPartial = closedRoute.stops.filter((s) => s.visitStatus === "parcial").length;
    const logRef = dailyLogRef(ref, date);
    const existingLog = nextLogs.find((row) => row.ref === logRef);
    collected += existingLog?.collected ?? 0;

    const closedLog: CollectorDailyLogRow = {
      ref: logRef,
      collectorRef: ref,
      date,
      dateLabel: isoToDispatchLabel(date),
      routeRef: closedRoute.ref,
      routeName: closedRoute.name,
      zone: closedRoute.zone,
      visitsPlanned: closedRoute.stops.length,
      visitsDone,
      visitsPartial,
      visitsPending: 0,
      collected: existingLog?.collected ?? 0,
      paymentsCount: existingLog?.paymentsCount ?? 0,
      startedAt: existingLog?.startedAt ?? closedAt,
      closedAt,
      status: "Cerrada",
      kind: "paid",
      summary: [
        existingLog?.paymentsCount
          ? `${existingLog.paymentsCount} cobro${existingLog.paymentsCount === 1 ? "" : "s"}`
          : null,
        visitsDone ? `${visitsDone} cobrado${visitsDone === 1 ? "" : "s"}` : null,
        visitsPartial ? `${visitsPartial} parcial${visitsPartial === 1 ? "" : "es"}` : null,
        visitsSkipped
          ? `${visitsSkipped} sin cobro → alerta`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Jornada cerrada",
    };
    nextLogs = [closedLog, ...nextLogs.filter((row) => row.ref !== logRef)].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }

  return {
    assignments: nextAssignments,
    routes: nextRoutes,
    logs: nextLogs,
    skipped,
    missedLoanRefs: [...new Set(missedLoanRefs)],
    collected,
    collectorsClosed: collectorRefs.length,
  };
}

export type ReopenDayResult = {
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  logs: CollectorDailyLogRow[];
  restored: number;
  collectorsReopened: number;
};

/**
 * Reabre la jornada: quita dayClosedAt y recupera omitidos del cierre → pendiente.
 * Cobros ya registrados (cobrado/parcial) se conservan.
 */
export function reopenDispatchDay(
  assignments: DailyCollectionAssignment[],
  routes: RouteRow[],
  logs: CollectorDailyLogRow[],
  date: string,
  collectors: CollectorRow[],
  loans: LoanRow[],
  clients: ClientRow[],
  collectorRef?: string,
): ReopenDayResult {
  let restored = 0;
  const nextAssignments = assignments.map((row) => {
    if (row.dispatchDate !== date || !row.dispatched) return row;
    if (collectorRef && row.collectorRef !== collectorRef) return row;
    if (!row.dayClosedAt) return row;

    const closedSkip =
      row.visitStatus === "omitido" && row.skipReason === "Cierre de jornada";

    if (closedSkip) {
      restored += 1;
      return {
        ...row,
        dayClosedAt: undefined,
        visitStatus: "pendiente" as const,
        skipReason: undefined,
      };
    }

    const { dayClosedAt: _removed, ...rest } = row;
    return { ...rest };
  });

  let nextRoutes = routes;
  let nextLogs = logs;
  const collectorRefs = [
    ...new Set(
      nextAssignments
        .filter(
          (row) =>
            row.dispatchDate === date &&
            row.dispatched &&
            (!collectorRef || row.collectorRef === collectorRef),
        )
        .map((row) => row.collectorRef),
    ),
  ];

  for (const ref of collectorRefs) {
    const collector = collectors.find((row) => row.ref === ref);
    if (!collector) continue;
    const existing = nextRoutes.find((row) => row.ref === dispatchRouteRef(ref, date));
    const rebuilt = buildDispatchRoute(
      ref,
      collector.name,
      date,
      nextAssignments,
      loans,
      clients,
      existing,
    );
    nextRoutes = upsertDispatchRoute(nextRoutes, rebuilt);

    const logRef = dailyLogRef(ref, date);
    nextLogs = nextLogs.map((row) =>
      row.ref === logRef
        ? {
            ...row,
            closedAt: undefined,
            status: rebuilt.status,
            kind: rebuilt.kind,
            visitsPending: rebuilt.stops.filter(
              (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
            ).length,
            summary: "Jornada reabierta · sigue cobrando",
          }
        : row,
    );
  }

  return {
    assignments: nextAssignments,
    routes: nextRoutes,
    logs: nextLogs,
    restored,
    collectorsReopened: collectorRefs.length,
  };
}

export function dayCloseSummary(
  assignments: DailyCollectionAssignment[],
  date: string,
) {
  const day = assignments.filter((row) => row.dispatchDate === date && row.dispatched);
  const pending = day.filter((row) => row.visitStatus === "pendiente" || !row.visitStatus).length;
  const partial = day.filter((row) => row.visitStatus === "parcial").length;
  const collected = day.filter((row) => row.visitStatus === "cobrado").length;
  const skipped = day.filter((row) => row.visitStatus === "omitido").length;
  const collectors = new Set(day.map((row) => row.collectorRef)).size;
  const alreadyClosed = day.length > 0 && day.every((row) => Boolean(row.dayClosedAt));
  return {
    total: day.length,
    pending,
    partial,
    collected,
    skipped,
    collectors,
    canClose: day.length > 0 && !alreadyClosed,
    alreadyClosed,
  };
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
