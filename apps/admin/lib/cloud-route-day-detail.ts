/**
 * Cliente de la puerta ruta+día (gastos / préstamos).
 * Solo pide al abrir el detalle; no baja el libro entero.
 */
import type { RouteExpenseLine } from "@/lib/collector-day-close";

export type CloudRouteDayDetail = {
  collectorRef: string;
  date: string;
  route: string;
  gastosTotal: number;
  prestamosTotal: number;
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  fetchedAt: number;
};

const byKey = new Map<string, CloudRouteDayDetail>();
/** Hoy: 45 s. Día pasado: 10 min (sellado no cambia). */
const LIVE_TTL_MS = 45_000;
const SEALED_TTL_MS = 10 * 60_000;

function keyOf(collectorRef: string, date: string, route: string) {
  return `${collectorRef.trim()}|${date}|${String(route || "")
    .trim()
    .toUpperCase()}`;
}

function ttlFor(date: string, todayIso: string) {
  return date === todayIso ? LIVE_TTL_MS : SEALED_TTL_MS;
}

export function getCloudRouteDayDetail(
  collectorRef: string,
  date: string,
  route: string,
): CloudRouteDayDetail | null {
  return byKey.get(keyOf(collectorRef, date, route)) ?? null;
}

export function clearCloudRouteDayDetail(
  collectorRef?: string,
  date?: string,
  route?: string,
) {
  if (!collectorRef) {
    byKey.clear();
    return;
  }
  if (!date || !route) {
    const prefix = `${collectorRef.trim()}|`;
    for (const key of [...byKey.keys()]) {
      if (key.startsWith(prefix)) byKey.delete(key);
    }
    return;
  }
  byKey.delete(keyOf(collectorRef, date, route));
}

export async function refreshCloudRouteDayDetail(
  collectorRef: string,
  date: string,
  route: string,
  opts: { todayIso?: string; force?: boolean } = {},
): Promise<CloudRouteDayDetail | null> {
  const ref = collectorRef.trim();
  const pin = String(route || "")
    .trim()
    .toUpperCase();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !pin) return null;
  if (typeof window === "undefined") return null;

  const today = opts.todayIso || date;
  const cached = byKey.get(keyOf(ref, date, pin));
  if (
    !opts.force &&
    cached &&
    Date.now() - cached.fetchedAt < ttlFor(date, today)
  ) {
    return cached;
  }

  try {
    const res = await fetch(
      `/api/ops/route-day-detail?collectorRef=${encodeURIComponent(ref)}&date=${encodeURIComponent(date)}&route=${encodeURIComponent(pin)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      ready?: boolean;
      gastosTotal?: number;
      prestamosTotal?: number;
      gastoLines?: RouteExpenseLine[];
      prestamoLines?: RouteExpenseLine[];
      error?: string;
    };
    if (!res.ok || !body.ok || body.ready !== true) {
      return cached ?? null;
    }
    const row: CloudRouteDayDetail = {
      collectorRef: ref,
      date,
      route: pin,
      gastosTotal: Math.trunc(Number(body.gastosTotal) || 0),
      prestamosTotal: Math.trunc(Number(body.prestamosTotal) || 0),
      gastoLines: Array.isArray(body.gastoLines) ? body.gastoLines : [],
      prestamoLines: Array.isArray(body.prestamoLines) ? body.prestamoLines : [],
      fetchedAt: Date.now(),
    };
    byKey.set(keyOf(ref, date, pin), row);
    return row;
  } catch (error) {
    console.error("refreshCloudRouteDayDetail", error);
    return cached ?? null;
  }
}
