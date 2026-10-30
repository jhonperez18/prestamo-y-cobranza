/**
 * Caché en el aparato de la caja A/N (Fase 3.3).
 * Con red gana la base; sin dato → independentRouteDay usa el libro local.
 */
export type CloudRouteOwnBox = {
  collectorRef: string;
  date: string;
  route: "A" | "N";
  saldo: number;
  efectivo: number;
  prestamos: number;
  gastos: number;
  fetchedAt: string;
};

const byKey = new Map<string, CloudRouteOwnBox>();

function keyOf(collectorRef: string, date: string, route: string) {
  return `${collectorRef.trim()}|${date}|${route.trim().toUpperCase()}`;
}

export function getCloudRouteOwnBox(
  collectorRef: string,
  date: string,
  route: string,
): CloudRouteOwnBox | null {
  return byKey.get(keyOf(collectorRef, date, route)) ?? null;
}

export function rememberCloudRouteOwnBox(row: CloudRouteOwnBox) {
  byKey.set(keyOf(row.collectorRef, row.date, row.route), row);
}

export async function refreshCloudRouteOwnBox(
  collectorRef: string,
  date: string,
  route: string,
): Promise<CloudRouteOwnBox | null> {
  const ref = collectorRef.trim();
  const pin = route.trim().toUpperCase();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (pin !== "A" && pin !== "N")) {
    return null;
  }
  try {
    const res = await fetch(
      `/api/ops/route-own-box?collectorRef=${encodeURIComponent(ref)}&date=${encodeURIComponent(date)}&route=${encodeURIComponent(pin)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      saldo?: number;
      efectivo?: number;
      prestamos?: number;
      gastos?: number;
    };
    if (!body || body.ok !== true || !Number.isFinite(Number(body.saldo))) return null;
    const row: CloudRouteOwnBox = {
      collectorRef: ref,
      date,
      route: pin,
      saldo: Math.trunc(Number(body.saldo)),
      efectivo: Math.trunc(Number(body.efectivo) || 0),
      prestamos: Math.trunc(Number(body.prestamos) || 0),
      gastos: Math.trunc(Number(body.gastos) || 0),
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudRouteOwnBox(row);
    return row;
  } catch (error) {
    console.error("refreshCloudRouteOwnBox", error);
    return null;
  }
}
