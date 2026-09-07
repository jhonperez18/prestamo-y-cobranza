import {
  collectedByCollectorRef,
  collectorFieldStatus,
  catalogRoutes,
  clientsOnRouteListed,
  money,
  paymentsForCollector,
  roleByRef,
  routeIsActive,
  routesForCollector,
  userForCollector,
  type ActivityRow,
  type ClientRow,
  type CollectorRow,
  type PaymentRow,
  type RoleRow,
  type RouteRow,
  type StatusKind,
  type UserRow,
} from "@/lib/mock-data";
import { isOperationalClient } from "@/lib/client-review";
import { mobileAccessLabel } from "@/lib/access-preview";
import { paymentsForDay, todayDispatchToken, todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { dedupePlanillaAssignments } from "@/lib/planilla-dedupe";
import { normalizePaymentMethod, paymentMethodLabel } from "@/lib/payment-method";
import { paymentHasReceipt, paymentHasSignature } from "@/lib/payment-evidence";

export type CollectorTab = "ficha" | "rutas" | "cobros" | "historial" | "actividad" | "acceso";

export type CollectorListItem = CollectorRow & {
  routeLabel: string;
  collected: number;
  statusLabel: string;
  statusKind: StatusKind;
  accessLabel: string;
  roleName: string;
};

export type RouteCoverageSummary = {
  routeRef: string;
  routeName: string;
  active: boolean;
  collector: CollectorRow | null;
  collectorRef: string;
  collectorName: string;
  clients: number;
  planillaToday: number;
  collectedToday: number;
  statusLabel: string;
  statusKind: StatusKind;
};

export type RouteCoverageTotals = {
  routes: number;
  withCollector: number;
  withoutCollector: number;
  clients: number;
  planillaToday: number;
  collectedToday: number;
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

/** Cobertura operativa = rutas de catálogo (ya no zonas geográficas fijas). */
export function routeCoverageSummaries(
  collectors: CollectorRow[],
  routes: RouteRow[],
  payments: PaymentRow[],
  clients: ClientRow[] = [],
  assignments: DailyCollectionAssignment[] = [],
  day = todayIso(),
): RouteCoverageSummary[] {
  const todayPayments = paymentsForDay(payments, todayDispatchToken());
  const collectorMap = new Map(collectors.map((row) => [row.ref, row]));

  return catalogRoutes(routes)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((route) => {
      const collector = route.collectorRef
        ? (collectorMap.get(route.collectorRef) ?? null)
        : null;
      const clientRows = clientsOnRouteListed(route.name, clients).filter(isOperationalClient);
      const clientRefs = new Set(clientRows.map((row) => row.ref));

      const planillaToday = dedupePlanillaAssignments(
        assignments.filter((row) => {
          if (!row.dispatched || row.dispatchDate !== day) return false;
          if (clientRefs.has(row.clientRef)) return true;
          return Boolean(route.collectorRef && row.collectorRef === route.collectorRef);
        }),
      ).length;

      const collectedToday = todayPayments
        .filter((row) => {
          if (route.collectorRef && row.collectorRef === route.collectorRef) return true;
          const payClientRef = clients.find(
            (c) => `${c.name} ${c.lastName}`.trim() === row.client,
          )?.ref;
          return payClientRef ? clientRefs.has(payClientRef) : false;
        })
        .reduce((sum, row) => sum + row.amount, 0);

      const hasCollector = Boolean(collector?.ref || route.collectorRef);
      const statusLabel = !routeIsActive(route)
        ? "Inactiva"
        : hasCollector
          ? planillaToday > 0
            ? "En app hoy"
            : "Con cobrador"
          : "Sin cobrador";
      const statusKind: StatusKind = !routeIsActive(route)
        ? "draft"
        : hasCollector
          ? planillaToday > 0
            ? "ok"
            : "pending"
          : "warn";

      return {
        routeRef: route.ref,
        routeName: route.name,
        active: routeIsActive(route),
        collector,
        collectorRef: collector?.ref || route.collectorRef || "",
        collectorName:
          collector?.name ||
          (route.collector && route.collector !== "—" ? route.collector : "Sin cobrador"),
        clients: clientRows.length,
        planillaToday,
        collectedToday,
        statusLabel,
        statusKind,
      };
    });
}

export function routeCoverageTotals(rows: RouteCoverageSummary[]): RouteCoverageTotals {
  return {
    routes: rows.length,
    withCollector: rows.filter((row) => row.collectorName !== "Sin cobrador").length,
    withoutCollector: rows.filter((row) => row.collectorName === "Sin cobrador").length,
    clients: rows.reduce((sum, row) => sum + row.clients, 0),
    planillaToday: rows.reduce((sum, row) => sum + row.planillaToday, 0),
    collectedToday: rows.reduce((sum, row) => sum + row.collectedToday, 0),
  };
}

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
        detail: `${row.client} · ${money(row.amount)} · ${paymentMethodLabel(normalizePaymentMethod(row.method))}${
          paymentHasReceipt(row.evidence) ? " · comprobante" : paymentHasSignature(row.evidence) ? " · firma" : ""
        }`,
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
