/**
 * Caja de A leída en la base. Solo lee. Delega a route_own_box (Fase 3.3).
 */
import { readRouteOwnBox } from "@/lib/server-route-own-box";

export type RouteABoxResult =
  | { ok: true; saldo: number }
  | { ok: false; error: string };

export async function readRouteABox(collectorRef: string, date: string): Promise<RouteABoxResult> {
  const result = await readRouteOwnBox(collectorRef, date, "A");
  if (!result.ok) return result;
  return { ok: true, saldo: result.saldo };
}
