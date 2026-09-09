import {
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type RouteStop,
  type StatusKind,
} from "@/lib/mock-data";
import {
  amountDueForClient,
  buildRouteStop,
  primaryLoanForClient,
  routePendingCount,
  routeTotalDue,
} from "@/lib/route-sync";

/** Fecha local del sistema en ISO (YYYY-MM-DD). */
export function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthStartIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function todayDispatchToken(now = new Date()) {
  return isoToDispatchToken(todayIso(now));
}

export function isoToDispatchToken(iso: string) {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export function isoToDispatchLabel(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function dispatchDateHint(iso: string, today = todayIso()) {
  if (iso === today) return "Hoy";
  if (iso > today) return "Programado";
  return "Histórico";
}

export type DispatchVisitRow = {
  id: string;
  routeRef: string;
  routeName: string;
  collectorRef: string;
  collector: string;
  zone: string;
  visitOrder: number;
  clientRef: string;
  clientName: string;
  loanRef?: string;
  amountDue: number;
  visitStatus: RouteStop["visitStatus"];
  address?: string;
  phone?: string;
};

export type DispatchSummary = {
  routes: number;
  visits: number;
  pendingVisits: number;
  totalDue: number;
  collectedToday: number;
  syncedRoutes: number;
};

export function clientDisplayName(client: ClientRow | undefined, clientRef: string) {
  if (!client) return clientRef;
  return `${client.name} ${client.lastName}`.trim();
}

export function visitStatusLabel(status: RouteStop["visitStatus"]) {
  if (status === "cobrado") return "Pago";
  if (status === "parcial") return "Parcial";
  if (status === "omitido") return "Omitido";
  return "Pendiente";
}

export function visitStatusLabelShort(status: RouteStop["visitStatus"]) {
  if (status === "cobrado") return "pago";
  if (status === "parcial") return "Parc.";
  if (status === "omitido") return "S/C";
  return "Pend.";
}

export function visitStatusKind(status: RouteStop["visitStatus"]): StatusKind {
  if (status === "cobrado") return "ok";
  if (status === "parcial") return "partial";
  if (status === "omitido") return "overdue";
  return "pending";
}

/** Recalcula montos del día desde préstamos activos (mantiene visitas ya cobradas). */
export function refreshRouteStops(
  route: RouteRow,
  loans: LoanRow[],
  clients: ClientRow[],
): RouteRow {
  const stops = route.stops.map((stop) => {
    if (stop.visitStatus === "cobrado") return stop;
    const client = clients.find((row) => row.ref === stop.clientRef);
    const fresh = buildRouteStop(stop.clientRef, stop.visitOrder, loans, {
      lat: client ? undefined : stop.lat,
      lng: client ? undefined : stop.lng,
    });
    const loan = primaryLoanForClient(stop.clientRef, loans);
    return {
      ...fresh,
      visitOrder: stop.visitOrder,
      visitStatus: stop.visitStatus === "parcial" ? stop.visitStatus : fresh.visitStatus,
      loanRef: loan?.ref ?? fresh.loanRef,
      amountDue:
        stop.visitStatus === "parcial"
          ? stop.amountDue
          : amountDueForClient(stop.clientRef, loans),
    };
  });
  const pending = routePendingCount(stops);
  return {
    ...route,
    stops,
    clients: stops.length,
    status: pending === 0 ? "Cerrada" : "En curso",
    kind: pending === 0 ? "paid" : "pending",
  };
}

export function refreshAllRoutes(routes: RouteRow[], loans: LoanRow[], clients: ClientRow[]) {
  return routes.map((route) => refreshRouteStops(route, loans, clients));
}

/** Lista de cobro para una fecha: en días futuros reinicia visitas pendientes. */
export function prepareRoutesForDate(
  routes: RouteRow[],
  loans: LoanRow[],
  clients: ClientRow[],
  selectedDate: string,
  today = todayIso(),
): RouteRow[] {
  const refreshed = refreshAllRoutes(routes, loans, clients);
  const isFuture = selectedDate > today;

  return refreshed.map((route) => {
    let stops = route.stops;
    if (isFuture) {
      stops = route.stops.map((stop) => {
        const due = amountDueForClient(stop.clientRef, loans);
        const loan = primaryLoanForClient(stop.clientRef, loans);
        if (due <= 0) {
          return { ...stop, amountDue: 0, visitStatus: "cobrado" as const };
        }
        return {
          ...stop,
          amountDue: due,
          visitStatus: "pendiente" as const,
          loanRef: loan?.ref ?? stop.loanRef,
          paymentRef: undefined,
        };
      });
    }
    const pending = routePendingCount(stops);
    return {
      ...route,
      stops,
      scheduledDate: selectedDate,
      clients: stops.length,
      status: isFuture ? "Programada" : pending === 0 ? "Cerrada" : "En curso",
      kind: isFuture ? "draft" : pending === 0 ? "paid" : "pending",
    };
  });
}

export function flattenDispatchVisits(
  routes: RouteRow[],
  clients: ClientRow[],
): DispatchVisitRow[] {
  const rows: DispatchVisitRow[] = [];
  for (const route of routes) {
    for (const stop of route.stops) {
      const client = clients.find((row) => row.ref === stop.clientRef);
      rows.push({
        id: `${route.ref}:${stop.clientRef}`,
        routeRef: route.ref,
        routeName: route.name,
        collectorRef: route.collectorRef,
        collector: route.collector,
        zone: route.zone,
        visitOrder: stop.visitOrder,
        clientRef: stop.clientRef,
        clientName: clientDisplayName(client, stop.clientRef),
        loanRef: stop.loanRef,
        amountDue: stop.amountDue,
        visitStatus: stop.visitStatus,
        address: client?.address,
        phone: client?.phone,
      });
    }
  }
  return rows.sort((a, b) => a.routeName.localeCompare(b.routeName) || a.visitOrder - b.visitOrder);
}

export function dispatchSummary(
  routes: RouteRow[],
  payments: PaymentRow[],
  todayToken = todayDispatchToken(),
): DispatchSummary {
  const visits = flattenDispatchVisits(routes, []);
  const pendingVisits = visits.filter(
    (row) => row.visitStatus === "pendiente" || row.visitStatus === "parcial",
  ).length;
  const totalDue = routes.reduce((sum, route) => sum + routeTotalDue(route.stops), 0);
  const collectedToday = payments
    .filter((row) => row.when.startsWith(todayToken))
    .reduce((sum, row) => sum + row.amount, 0);
  const syncedRoutes = routes.filter((route) => route.status === "En curso").length;

  return {
    routes: routes.length,
    visits: visits.length,
    pendingVisits,
    totalDue,
    collectedToday,
    syncedRoutes,
  };
}

export function paymentsForDay(payments: PaymentRow[], todayToken = todayDispatchToken(), now = new Date()) {
  const today = todayIso(now);
  return payments.filter((row) => {
    if (row.paidDate) return row.paidDate === today;
    return row.when.startsWith(todayToken) || row.when.startsWith(isoToDispatchLabel(today));
  });
}

export function assignRouteCollector(
  route: RouteRow,
  collectorRef: string,
  collectors: CollectorRow[],
): RouteRow {
  const collector = collectors.find((row) => row.ref === collectorRef);
  if (!collector) return route;
  return {
    ...route,
    collectorRef: collector.ref,
    collector: collector.name,
  };
}

export function markRoutesDispatched(routes: RouteRow[], selectedDate?: string) {
  return routes.map((route) => {
    if (selectedDate && route.scheduledDate && route.scheduledDate !== selectedDate) return route;
    const pending = routePendingCount(route.stops);
    if (pending === 0) {
      return { ...route, status: "Cerrada", kind: "paid" as const };
    }
    return { ...route, status: "En curso", kind: "pending" as const };
  });
}

/** Payload simplificado que recibiría la app móvil del cobrador. */
export function mobileDispatchPayload(route: RouteRow, clients: ClientRow[]) {
  return {
    routeRef: route.ref,
    routeName: route.name,
    collectorRef: route.collectorRef,
    collector: route.collector,
    zone: route.zone,
    status: route.status,
    totalDue: routeTotalDue(route.stops),
    pendingVisits: routePendingCount(route.stops),
    stops: route.stops.map((stop) => {
      const client = clients.find((row) => row.ref === stop.clientRef);
      return {
        clientRef: stop.clientRef,
        clientName: clientDisplayName(client, stop.clientRef),
        visitOrder: stop.visitOrder,
        loanRef: stop.loanRef,
        amountDue: stop.amountDue,
        visitStatus: stop.visitStatus,
        address: client?.address,
        phone: client?.phone,
      };
    }),
  };
}
