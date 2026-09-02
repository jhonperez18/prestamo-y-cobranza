import { pendingReviewClients } from "@/lib/client-review";
import { activityFeed } from "@/lib/collector-preview";
import {
  dispatchSummary,
  isoToDispatchLabel,
  paymentsForDay,
  todayDispatchToken,
  todayIso,
} from "@/lib/daily-dispatch";
import { buildPortfolioStats, moraStats } from "@/lib/portfolio-stats";
import type { ModuleId } from "@/lib/navigation";
import {
  COLLECTOR_UNASSIGNED_ZONE,
  money,
  type ActivityRow,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type StatusKind,
} from "@/lib/mock-data";
import { routePendingCount } from "@/lib/route-sync";

export type HomePendingAction = {
  id: string;
  message: string;
  pill: string;
  kind: StatusKind;
  module: ModuleId;
  view: string;
};

export type HomeRouteCard = {
  ref: string;
  zone: string;
  collector: string;
  clients: number;
  visited: number;
  pending: number;
  progress: number;
  status: string;
  statusKind: StatusKind;
};

export type HomeDashboardData = {
  greeting: string;
  dateLabel: string;
  collectedToday: number;
  collectedCount: number;
  dueToday: number;
  pendingVisits: number;
  moraTotal: number;
  moraCount: number;
  activeClients: number;
  activeLoansCount: number;
  portfolioTotal: number;
  pendingActions: HomePendingAction[];
  todayPayments: PaymentRow[];
  routes: HomeRouteCard[];
  recentActivity: ReturnType<typeof activityFeed>;
};

export function homeGreeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 18) return "Buenas tardes";
  return "Buenas noches";
}

export function homeDateLabel(now = new Date()) {
  const formatted = now.toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function buildHomePendingActions(
  clients: ClientRow[],
  loans: LoanRow[],
  payments: PaymentRow[],
  collectors: CollectorRow[],
  routes: RouteRow[],
): HomePendingAction[] {
  const items: HomePendingAction[] = [];
  const reviewCount = pendingReviewClients(clients).length;
  if (reviewCount > 0) {
    items.push({
      id: "revision",
      message: `${reviewCount} cliente${reviewCount === 1 ? "" : "s"} pendiente${reviewCount === 1 ? "" : "s"} de aprobación`,
      pill: "Revisar",
      kind: "warn",
      module: "clientes",
      view: "revision",
    });
  }

  const mora = moraStats(loans, payments);
  if (mora.count > 0) {
    items.push({
      id: "mora",
      message: `${mora.count} crédito${mora.count === 1 ? "" : "s"} en mora · ${money(mora.total)}`,
      pill: "Mora",
      kind: "overdue",
      module: "cartera",
      view: "mora",
    });
  }

  const unassigned = collectors.filter(
    (row) => row.active && row.zone === COLLECTOR_UNASSIGNED_ZONE,
  ).length;
  if (unassigned > 0) {
    items.push({
      id: "zonas",
      message: `${unassigned} cobrador${unassigned === 1 ? "" : "es"} sin zona asignada`,
      pill: "Zonas",
      kind: "partial",
      module: "inicio",
      view: "zonas",
    });
  }

  const idleRoutes = routes.filter((row) => row.status !== "En curso" && row.stops.length > 0).length;
  if (idleRoutes > 0) {
    items.push({
      id: "rutas",
      message: `${idleRoutes} ruta${idleRoutes === 1 ? "" : "s"} sin iniciar hoy`,
      pill: "Cobranza",
      kind: "pending",
      module: "inicio",
      view: "lista",
    });
  }

  if (!items.length) {
    items.push({
      id: "ok",
      message: "Sin pendientes urgentes. La operación del día está al día.",
      pill: "Al día",
      kind: "ok",
      module: "inicio",
      view: "resumen",
    });
  }

  return items.slice(0, 5);
}

function routeCard(route: RouteRow): HomeRouteCard {
  const total = route.stops.length;
  const visited = route.stops.filter((stop) => stop.visitStatus === "cobrado").length;
  const pending = routePendingCount(route.stops);
  return {
    ref: route.ref,
    zone: route.zone,
    collector: route.collector,
    clients: total,
    visited,
    pending,
    progress: total ? Math.round((visited / total) * 100) : 0,
    status: route.status,
    statusKind: route.kind,
  };
}

export function buildHomeDashboard(
  clients: ClientRow[],
  loans: LoanRow[],
  payments: PaymentRow[],
  routes: RouteRow[],
  collectors: CollectorRow[],
  activities: ActivityRow[],
  now = new Date(),
): HomeDashboardData {
  const todayToken = todayDispatchToken(now);
  const summary = dispatchSummary(routes, payments, todayToken);
  const todayPayments = paymentsForDay(payments, todayToken).slice(0, 8);
  const portfolio = buildPortfolioStats(loans, payments, now);
  const activeClientRows = clients.filter((row) => row.status === "Activo");

  return {
    greeting: homeGreeting(now),
    dateLabel: `${homeDateLabel(now)} · Operación del ${isoToDispatchLabel(todayIso(now))}`,
    collectedToday: summary.collectedToday,
    collectedCount: paymentsForDay(payments, todayToken).length,
    dueToday: summary.totalDue,
    pendingVisits: summary.pendingVisits,
    moraTotal: portfolio.moraBalance,
    moraCount: portfolio.moraCount,
    activeClients: activeClientRows.length,
    activeLoansCount: portfolio.activeCount,
    portfolioTotal: portfolio.totalBalance,
    pendingActions: buildHomePendingActions(clients, loans, payments, collectors, routes),
    todayPayments,
    routes: routes.map(routeCard),
    recentActivity: activityFeed(activities, payments, collectors).slice(0, 6),
  };
}
