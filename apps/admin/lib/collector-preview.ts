import {
  collectedByCollectorRef,
  collectorFieldStatus,
  money,
  paymentsForCollector,
  roleByRef,
  routesForCollector,
  userForCollector,
  ZONES,
  type ActivityRow,
  type ClientRow,
  type CollectorRow,
  type PaymentRow,
  type RoleRow,
  type RouteRow,
  type StatusKind,
  type UserRow,
} from "@/lib/mock-data";
import { mobileAccessLabel } from "@/lib/access-preview";
import { normalizePaymentMethod, paymentMethodLabel } from "@/lib/payment-method";
import { paymentHasReceipt } from "@/lib/payment-evidence";

export type CollectorTab = "ficha" | "rutas" | "cobros" | "historial" | "actividad" | "acceso";

export type CollectorListItem = CollectorRow & {
  routeLabel: string;
  collected: number;
  statusLabel: string;
  statusKind: StatusKind;
  accessLabel: string;
  roleName: string;
};

export type ZoneSummary = {
  zone: string;
  collectors: CollectorRow[];
  routes: RouteRow[];
  activeRoutes: number;
  clients: number;
  collected: number;
};

export type ActivityFeedItem = {
  ref: string;
  when: string;
  collectorRef: string;
  collectorName: string;
  title: string;
  detail: string;
  kind: StatusKind;
  gps?: boolean;
};

export function enrichCollector(
  collector: CollectorRow,
  routes: RouteRow[],
  payments: PaymentRow[],
  allCollectors: CollectorRow[],
  users: UserRow[] = [],
  roles: RoleRow[] = [],
): CollectorListItem {
  const route = routesForCollector(collector.ref, routes)[0];
  const status = collectorFieldStatus(collector, routes);
  const user = userForCollector(collector.ref, users);
  const role = user ? roleByRef(user.roleRef, roles) : roleByRef("ROL-1", roles);
  return {
    ...collector,
    routeLabel: route ? `${route.name} · ${route.clients}` : "—",
    collected: collectedByCollectorRef(collector.ref, allCollectors, payments),
    statusLabel: status.label,
    statusKind: status.kind,
    accessLabel: mobileAccessLabel(collector),
    roleName: role?.name ?? "Cobrador",
  };
}

export function enrichCollectors(
  collectors: CollectorRow[],
  routes: RouteRow[],
  payments: PaymentRow[],
  users: UserRow[] = [],
  roles: RoleRow[] = [],
): CollectorListItem[] {
  return collectors.map((row) => enrichCollector(row, routes, payments, collectors, users, roles));
}

export function collectorsForView(viewId: string, rows: CollectorRow[]): CollectorRow[] {
  if (viewId === "activos") return rows.filter((row) => row.active);
  if (viewId === "inactivos") return rows.filter((row) => !row.active);
  return rows;
}

export function zoneSummaries(
  collectors: CollectorRow[],
  routes: RouteRow[],
  payments: PaymentRow[],
  clients: ClientRow[] = [],
): ZoneSummary[] {
  return ZONES.map((zone) => {
    const zoneRoutes = routes.filter((row) => row.zone === zone);
    const zoneCollectors = collectors.filter((row) =>
      zoneRoutes.some((route) => route.collectorRef === row.ref),
    );
    const activeRoutes = zoneRoutes.filter((row) => row.status !== "Cerrada").length;
    const clientCount = clients.filter((row) => row.route === zone).length;
    const collected = zoneCollectors.reduce(
      (sum, row) => sum + collectedByCollectorRef(row.ref, collectors, payments),
      0,
    );
    return {
      zone,
      collectors: zoneCollectors,
      routes: zoneRoutes,
      activeRoutes,
      clients: clientCount || zoneRoutes.reduce((sum, row) => sum + row.clients, 0),
      collected,
    };
  });
}

export function activityFeed(
  activities: ActivityRow[],
  payments: PaymentRow[],
  collectors: CollectorRow[],
  filter?: { collectorRef?: string; zone?: string },
): ActivityFeedItem[] {
  const collectorMap = new Map(collectors.map((row) => [row.ref, row]));

  const fromActivity = activities.map((row) => {
    const collector = collectorMap.get(row.collectorRef);
    return {
      ref: row.ref,
      when: row.when,
      collectorRef: row.collectorRef,
      collectorName: collector?.name ?? "—",
      title: row.label,
      detail: row.detail,
      kind: row.kind,
      gps: row.gps,
    };
  });

  const fromPayments = payments
    .filter((row) => row.collectorRef || row.collector)
    .map((row) => {
      const collector =
        (row.collectorRef ? collectorMap.get(row.collectorRef) : null) ??
        collectors.find((entry) => entry.name === row.collector);
      return {
        ref: row.ref,
        when: row.when,
        collectorRef: collector?.ref ?? row.collectorRef ?? "",
        collectorName: collector?.name ?? row.collector,
        title: row.type,
        detail: `${row.client} · ${money(row.amount)} · ${paymentMethodLabel(normalizePaymentMethod(row.method))}${paymentHasReceipt(row.evidence) ? " · comprobante" : ""}`,
        kind: row.kind,
        gps: true,
      };
    });

  const merged = [...fromActivity, ...fromPayments].filter((row) => {
    if (filter?.collectorRef && row.collectorRef !== filter.collectorRef) return false;
    return true;
  });

  return merged.sort((a, b) => b.when.localeCompare(a.when));
}

export function collectorPayments(
  collectorRef: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
): PaymentRow[] {
  return paymentsForCollector(collectorRef, collectors, payments);
}

export type DeleteGuard = {
  canDelete: boolean;
  reason: string | null;
};

export function collectorDeleteGuard(
  collectorRef: string,
  routes: RouteRow[],
  _payments: PaymentRow[],
  activities: ActivityRow[],
  _collectors: CollectorRow[],
): DeleteGuard {
  const assignedRoutes = routesForCollector(collectorRef, routes);
  const activeRoutes = assignedRoutes.some((route) => route.status === "En curso");
  const pendingVisits = assignedRoutes.some(
    (route) =>
      route.status === "En curso" &&
      route.stops.some(
        (stop) => stop.visitStatus === "pendiente" || stop.visitStatus === "parcial",
      ),
  );
  const pendingActivity = activities.some(
    (row) => row.collectorRef === collectorRef && row.kind === "pending",
  );

  if (pendingVisits || activeRoutes || pendingActivity) {
    return {
      canDelete: false,
      reason: "No se puede eliminar: tiene actividades o visitas pendientes en ruta.",
    };
  }
  return { canDelete: true, reason: null };
}

export function userDeleteGuard(
  user: UserRow,
  routes: RouteRow[],
  payments: PaymentRow[],
  activities: ActivityRow[],
  collectors: CollectorRow[],
): DeleteGuard {
  if (user.collectorRef) {
    return collectorDeleteGuard(user.collectorRef, routes, payments, activities, collectors);
  }
  return { canDelete: true, reason: null };
}
