/**
 * Cliente de la puerta ruta+día (gastos / préstamos / efectivo / banco|nequi / N/P).
 * Día sellado: caché de sesión + TTL largo (no se mueve). Hoy: TTL corto.
 */
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import type {
  RouteDayNpLine,
  RouteDayPayLine,
} from "@/lib/server-route-day-detail";

export type CloudRouteDayDetail = {
  collectorRef: string;
  date: string;
  route: string;
  gastosTotal: number;
  prestamosTotal: number;
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  efectivoTotal: number;
  cashPays: RouteDayPayLine[];
  digitalTotal: number;
  digitalPays: RouteDayPayLine[];
  digitalPool: "banco" | "nequi";
  npCount: number;
  npRows: RouteDayNpLine[];
  fetchedAt: number;
};

const byKey = new Map<string, CloudRouteDayDetail>();
const STORAGE_PREFIX = "nexo-route-day-detail:";
/** Hoy: 45 s. Día pasado sellado: 12 h (historial sin movimiento). */
const LIVE_TTL_MS = 45_000;
const SEALED_TTL_MS = 12 * 60 * 60_000;

function keyOf(collectorRef: string, date: string, route: string) {
  return `${collectorRef.trim()}|${date}|${String(route || "")
    .trim()
    .toUpperCase()}`;
}

function ttlFor(date: string, todayIso: string) {
  return date < todayIso ? SEALED_TTL_MS : LIVE_TTL_MS;
}

function readPersisted(key: string): CloudRouteDayDetail | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const row = JSON.parse(raw) as CloudRouteDayDetail;
    if (!row || !row.date || !row.collectorRef || !row.route) return null;
    return row;
  } catch {
    return null;
  }
}

function writePersisted(key: string, row: CloudRouteDayDetail) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(row));
  } catch {
    /* cupo */
  }
}

function dropPersisted(key: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    /* cupo */
  }
}

export function getCloudRouteDayDetail(
  collectorRef: string,
  date: string,
  route: string,
): CloudRouteDayDetail | null {
  const key = keyOf(collectorRef, date, route);
  const hit = byKey.get(key);
  if (hit) return hit;
  const warm = readPersisted(key);
  if (warm) {
    byKey.set(key, warm);
    return warm;
  }
  return null;
}

export function clearCloudRouteDayDetail(
  collectorRef?: string,
  date?: string,
  route?: string,
) {
  if (!collectorRef) {
    byKey.clear();
    if (typeof sessionStorage !== "undefined") {
      try {
        const drop: string[] = [];
        for (let i = 0; i < sessionStorage.length; i += 1) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) drop.push(k);
        }
        for (const k of drop) sessionStorage.removeItem(k);
      } catch {
        /* cupo */
      }
    }
    return;
  }
  if (!date || !route) {
    const prefix = `${collectorRef.trim()}|`;
    for (const key of [...byKey.keys()]) {
      if (key.startsWith(prefix)) {
        byKey.delete(key);
        dropPersisted(key);
      }
    }
    return;
  }
  const key = keyOf(collectorRef, date, route);
  byKey.delete(key);
  dropPersisted(key);
}

function remember(row: CloudRouteDayDetail) {
  const key = keyOf(row.collectorRef, row.date, row.route);
  byKey.set(key, row);
  writePersisted(key, row);
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
  const cached = getCloudRouteDayDetail(ref, date, pin);
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
    const body = (await res.json()) as Partial<CloudRouteDayDetail> & {
      ok?: boolean;
      ready?: boolean;
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
      efectivoTotal: Math.trunc(Number(body.efectivoTotal) || 0),
      cashPays: Array.isArray(body.cashPays) ? body.cashPays : [],
      digitalTotal: Math.trunc(Number(body.digitalTotal) || 0),
      digitalPays: Array.isArray(body.digitalPays) ? body.digitalPays : [],
      digitalPool: body.digitalPool === "nequi" ? "nequi" : "banco",
      npCount: Math.trunc(Number(body.npCount) || 0),
      npRows: Array.isArray(body.npRows) ? body.npRows : [],
      fetchedAt: Date.now(),
    };
    remember(row);
    return row;
  } catch (error) {
    console.error("refreshCloudRouteDayDetail", error);
    return cached ?? null;
  }
}
