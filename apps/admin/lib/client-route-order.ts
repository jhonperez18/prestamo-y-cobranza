import type { ClientRow } from "@/lib/mock-data";
import { normalizeRouteNumber } from "@/lib/mock-data";
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

export function sameRoute(a: string | undefined, b: string | undefined) {
  const left = migrateLegacyRouteName(String(a ?? "").trim());
  const right = migrateLegacyRouteName(String(b ?? "").trim());
  if (!left || !right) return false;
  if (left === right) return true;
  const nLeft = normalizeRouteNumber(left);
  const nRight = normalizeRouteNumber(right);
  return Boolean(nLeft) && nLeft === nRight;
}

/** Una sola fila por ref (limpia duplicados en localStorage / sync). */
export function dedupeClientsByRef(clients: ClientRow[]): ClientRow[] {
  const byRef = new Map<string, ClientRow>();
  for (const row of clients) {
    if (!row?.ref) continue;
    if (!byRef.has(row.ref)) byRef.set(row.ref, row);
  }
  return [...byRef.values()];
}

/** Clientes de una ruta ordenados por posición (1…N). Sin pendientes de revisión. */
export function clientsOnRouteSorted(clients: ClientRow[], routeName: string) {
  return dedupeClientsByRef(clients)
    .filter((row) => sameRoute(row.route, routeName) && !isPendingReview(row))
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
  const unique = dedupeClientsByRef(clients);
  const byRoute = new Map<string, ClientRow[]>();
  for (const row of unique) {
    if (isPendingReview(row)) continue;
    const key = migrateLegacyRouteName(row.route || "") || row.route || "";
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

  return unique.map((row) => {
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
 * Inserta o mueve un cliente a `route` exactamente en la posición `routeOrder`.
 *
 * Algoritmo (lista ordenada + splice): quitar → insertar en índice → renumerar 1…N.
 * El viejo “shift +1 + normalize” fallaba al bajar de posición (ej. 2→5 quedaba en 4).
 */
export function placeClientOnRoute(
  clients: ClientRow[],
  client: ClientRow,
  route: string,
  routeOrder: number,
): ClientRow[] {
  const unique = dedupeClientsByRef(clients);
  const others = unique.filter((row) => row.ref !== client.ref);

  if (isPendingReview(client)) {
    return normalizeAllRouteOrders([
      ...others,
      { ...client, route: "", routeOrder: 0 },
    ]);
  }

  const routeName = String(route || "").trim();
  if (!routeName) {
    return normalizeAllRouteOrders([
      ...others,
      { ...client, route: "", routeOrder: 0 },
    ]);
  }

  const onRoute = clientsOnRouteSorted(others, routeName);
  const offRoute = others.filter(
    (row) => isPendingReview(row) || !sameRoute(row.route, routeName),
  );

  const maxPos = onRoute.length + 1;
  const target = Math.min(Math.max(1, Math.trunc(Number(routeOrder)) || maxPos), maxPos);

  const ordered = onRoute.slice();
  const placed: ClientRow = {
    ...client,
    route: routeName,
    routeOrder: target,
  };
  ordered.splice(target - 1, 0, placed);

  // Sellar updatedAt en toda la ruta renumerada: si no, el pull nube
  // rebobina vecinos (mismo reloj viejo + firma distinta → gana remoto).
  const stampedAt = new Date().toISOString();
  const withOrders = ordered.map((row, index) => ({
    ...row,
    route: routeName,
    routeOrder: index + 1,
    updatedAt: stampedAt,
  }));

  return normalizeAllRouteOrders([...offRoute, ...withOrders]);
}

/** Refs cuya ruta o posición cambió (para mirror completo de la planilla). */
export function clientRefsWithRouteOrderChange(
  before: ClientRow[],
  after: ClientRow[],
): string[] {
  const prevByRef = new Map(before.map((row) => [row.ref, row] as const));
  const changed: string[] = [];
  for (const row of after) {
    if (!row?.ref) continue;
    const prev = prevByRef.get(row.ref);
    if (
      !prev ||
      String(prev.route || "") !== String(row.route || "") ||
      (prev.routeOrder || 0) !== (row.routeOrder || 0)
    ) {
      changed.push(row.ref);
    }
  }
  return changed;
}
