/**
 * Calienta la caché de `route_own_box` en el proceso (Fase 3.3).
 * Lo usan los informes por correo: misma cifra que la pantalla / la base.
 * Si la base no contesta, el informe no debe inventar Saldo.
 */
import {
  rememberCloudRouteOwnBox,
  getCloudRouteOwnBox,
  type CloudRouteOwnBox,
} from "@/lib/cloud-route-own-box";
import { readRouteOwnBox } from "@/lib/server-route-own-box";

function nextIsoDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return dt.toISOString().slice(0, 10);
}

function daysInclusive(fromIso: string, toIso: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    return [];
  }
  if (fromIso > toIso) return [];
  const out: string[] = [];
  for (let day = fromIso; day <= toIso; day = nextIsoDay(day)) {
    out.push(day);
    if (out.length > 62) break;
  }
  return out;
}

export async function warmRouteOwnBoxDay(
  collectorRef: string,
  date: string,
  route: "A" | "N",
): Promise<CloudRouteOwnBox | null> {
  const result = await readRouteOwnBox(collectorRef, date, route);
  if (!result.ok) return null;
  const row: CloudRouteOwnBox = {
    collectorRef: collectorRef.trim(),
    date,
    route,
    saldo: result.saldo,
    opening: result.opening,
    efectivo: result.efectivo,
    prestamos: result.prestamos,
    gastos: result.gastos,
    fetchedAt: new Date().toISOString(),
  };
  rememberCloudRouteOwnBox(row);
  return row;
}

/** Baja cajas A/N del rango a la caché del proceso. Devuelve cuántas entraron. */
export async function warmRouteOwnBoxRange(
  collectorRef: string,
  route: "A" | "N",
  fromIso: string,
  toIso: string,
): Promise<number> {
  const days = daysInclusive(fromIso, toIso);
  if (!days.length || !collectorRef.trim()) return 0;
  let hit = 0;
  const chunk = 6;
  for (let i = 0; i < days.length; i += chunk) {
    const batch = days.slice(i, i + chunk);
    const rows = await Promise.all(
      batch.map((date) => warmRouteOwnBoxDay(collectorRef, date, route)),
    );
    for (const row of rows) {
      if (row) hit += 1;
    }
  }
  return hit;
}

/**
 * Exige la caja del día de corte en caché (ya calentada).
 * Sin ella el informe no puede afirmar el Saldo de A/N.
 */
export function requireWarmedRouteOwnBox(
  collectorRef: string,
  date: string,
  route: "A" | "N",
): CloudRouteOwnBox | null {
  return getCloudRouteOwnBox(collectorRef, date, route);
}
