import { pendingReviewClients } from "@/lib/client-review";
import {
  clientsNeedingProfileCompletion,
  loansNeedingOfficeReview,
} from "@/lib/profile-pending";
import { activityFeed } from "@/lib/collector-preview";
import {
  dispatchSummary,
  isoToDispatchLabel,
  paymentsForDay,
  todayDispatchToken,
  todayIso,
} from "@/lib/daily-dispatch";
import { displayToIso } from "@/lib/loan-preview";
import { buildPortfolioStats, moraStats } from "@/lib/portfolio-stats";
import type { ModuleId } from "@/lib/navigation";
import {
  catalogRoutes,
  clientsOnRouteListed,
  money,
  routeIsActive,
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
  clientsNewThisWeek: number;
  activeLoansCount: number;
  portfolioTotal: number;
  pendingActions: HomePendingAction[];
  todayPayments: PaymentRow[];
  routes: HomeRouteCard[];
  recentActivity: ReturnType<typeof activityFeed>;
};

function startOfWeekIso(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 domingo
  const diff = day === 0 ? 6 : day - 1; // lunes = inicio
  d.setDate(d.getDate() - diff);
  return todayIso(d);
}

function clientsNewSince(clients: ClientRow[], sinceIso: string) {
  return clients.filter((row) => {
    if (row.status !== "Activo") return false;
    const altaIso = displayToIso(row.alta);
    return Boolean(altaIso && altaIso >= sinceIso);
  }).length;
}

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

  const profilePending = clientsNeedingProfileCompletion(clients).length;
  if (profilePending > 0) {
    items.push({
      id: "ficha-incompleta",
      message: `${profilePending} cliente${profilePending === 1 ? "" : "s"} con ficha incompleta (calle)`,
      pill: "Completar",
      kind: "warn",
      module: "clientes",
      view: "listado",
    });
  }

  const loanPending = loansNeedingOfficeReview(loans).length;
  if (loanPending > 0) {
    items.push({
      id: "prestamo-rapido",
      message: `${loanPending} préstamo${loanPending === 1 ? "" : "s"} rápido${loanPending === 1 ? "" : "s"} por revisar`,
      pill: "Revisar",
      kind: "partial",
      module: "prestamos",
      view: "listado",
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

  const unassignedRoutes = catalogRoutes(routes).filter(
    (row) => routeIsActive(row) && !row.collectorRef,
  ).length;
  if (unassignedRoutes > 0) {
    items.push({
      id: "cobertura",
      message: `${unassignedRoutes} ruta${unassignedRoutes === 1 ? "" : "s"} sin cobrador asignado`,
      pill: "Asignar",
      kind: "warn",
      module: "inicio",
      view: "asignar-clientes",
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

function routeCard(route: RouteRow, clients: ClientRow[]): HomeRouteCard {
  const catalogCount = clientsOnRouteListed(route.name, clients).length;
  const total = route.stops.length || catalogCount;
  const visited = route.stops.filter((stop) => stop.visitStatus === "cobrado").length;
  const pending = route.stops.length ? routePendingCount(route.stops) : catalogCount;
  return {
    ref: route.ref,
    zone: route.name || route.zone,
    collector: route.collectorRef && route.collector !== "—" ? route.collector : "Sin cobrador",
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
  const allTodayPayments = paymentsForDay(payments, todayToken);
  const portfolio = buildPortfolioStats(loans, payments, now);
  const activeClientRows = clients.filter((row) => row.status === "Activo");
  const weekStart = startOfWeekIso(now);
  const catalog = catalogRoutes(routes)
    .filter(routeIsActive)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    greeting: homeGreeting(now),
    dateLabel: `${homeDateLabel(now)} · Operación del ${isoToDispatchLabel(todayIso(now))}`,
    collectedToday: allTodayPayments.reduce((sum, row) => sum + row.amount, 0),
    collectedCount: allTodayPayments.length,
    dueToday: summary.totalDue,
    pendingVisits: summary.pendingVisits,
    moraTotal: portfolio.moraBalance,
    moraCount: portfolio.moraCount,
    activeClients: activeClientRows.length,
    clientsNewThisWeek: clientsNewSince(activeClientRows, weekStart),
    activeLoansCount: portfolio.activeCount,
    portfolioTotal: portfolio.totalBalance,
    pendingActions: buildHomePendingActions(clients, loans, payments, collectors, routes),
    todayPayments: allTodayPayments,
    routes: catalog.map((route) => routeCard(route, clients)),
    recentActivity: activityFeed(activities, payments, collectors).slice(0, 6),
  };
}
