import type { ClientRow } from "@/lib/mock-data";
import { isPendingReview } from "@/lib/client-review";

const LEGACY_ROUTE_MAP: Record<string, string> = {
  norte: "1",
  sur: "2",
  centro: "3",
  oriente: "4",
  occidente: "5",
  playa: "6",
};

/** Migra nombres viejos de ruta (Norte/Sur…) a números. */
export function migrateLegacyRouteName(route: string) {
  const key = route.trim().toLowerCase();
  return LEGACY_ROUTE_MAP[key] ?? route;
}

/** Clientes de una ruta ordenados por posición (1…N). Sin pendientes de revisión. */
export function clientsOnRouteSorted(clients: ClientRow[], routeName: string) {
  return clients
    .filter((row) => row.route === routeName && !isPendingReview(row))
    .slice()
    .sort((a, b) => {
      const orderCmp = (a.routeOrder || 0) - (b.routeOrder || 0);
      if (orderCmp !== 0) return orderCmp;
      return a.ref.localeCompare(b.ref);
    });
}

/** Siguiente posición al final de la ruta (append). */
export function nextRouteOrder(clients: ClientRow[], routeName: string) {
  return clientsOnRouteSorted(clients, routeName).length + 1;
}

/**
 * Normaliza posiciones 1…N por cada ruta (rellena huecos / datos viejos).
 * Conserva el orden relativo actual. Ignora pendientes de revisión.
 */
export function normalizeAllRouteOrders(clients: ClientRow[]): ClientRow[] {
  const byRoute = new Map<string, ClientRow[]>();
  for (const row of clients) {
    if (isPendingReview(row)) continue;
    const key = row.route || "";
    const list = byRoute.get(key) ?? [];
    list.push(row);
    byRoute.set(key, list);
  }

  const orderByRef = new Map<string, number>();
  for (const [, list] of byRoute) {
    const sorted = list.slice().sort((a, b) => {
      const ao = a.routeOrder || Number.MAX_SAFE_INTEGER;
      const bo = b.routeOrder || Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.ref.localeCompare(b.ref);
    });
    sorted.forEach((row, index) => orderByRef.set(row.ref, index + 1));
  }

  return clients.map((row) => {
    if (isPendingReview(row)) {
      return { ...row, routeOrder: 0 };
    }
    return {
      ...row,
      routeOrder: orderByRef.get(row.ref) ?? 1,
    };
  });
}

/**
 * Inserta o mueve un cliente a `route` en la posición `routeOrder`.
 * Si ya hay alguien en esa posición, corre hacia adelante (22 → 23, etc.).
 * Pendientes de revisión no ocupan cupo en la ruta.
 */
export function placeClientOnRoute(
  clients: ClientRow[],
  client: ClientRow,
  route: string,
  routeOrder: number,
): ClientRow[] {
  const without = clients.filter((row) => row.ref !== client.ref);
  if (isPendingReview(client)) {
    return normalizeAllRouteOrders([
      ...without,
      { ...client, route: "", routeOrder: 0 },
    ]);
  }
  const onRoute = clientsOnRouteSorted(without, route);
  const maxPos = onRoute.length + 1;
  const target = Math.min(Math.max(1, Math.trunc(routeOrder) || maxPos), maxPos);

  const shifted = without.map((row) => {
    if (row.route !== route) return row;
    if (isPendingReview(row)) return row;
    if ((row.routeOrder || 0) < target) return row;
    return { ...row, routeOrder: (row.routeOrder || 0) + 1 };
  });

  const placed: ClientRow = {
    ...client,
    route,
    routeOrder: target,
  };

  return normalizeAllRouteOrders([...shifted, placed]);
}
