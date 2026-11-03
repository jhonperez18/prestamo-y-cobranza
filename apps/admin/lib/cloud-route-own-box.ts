/**
 * Caché en el aparato de la caja A/N (Fase 3.3).
 * Con red gana la base; sin dato → independentRouteDay usa el libro local.
 * Copia en sessionStorage: al reiniciar no pinta un negativo fantasma mientras llega la nube.
 */
export type CloudRouteOwnBox = {
  collectorRef: string;
  date: string;
  route: "A" | "N";
  saldo: number;
  opening: number;
  efectivo: number;
  prestamos: number;
  gastos: number;
  fetchedAt: string;
};

const byKey = new Map<string, CloudRouteOwnBox>();
const STORAGE_PREFIX = "nexo-route-own-box:";

function keyOf(collectorRef: string, date: string, route: string) {
  return `${collectorRef.trim()}|${date}|${route.trim().toUpperCase()}`;
}

function readPersisted(key: string): CloudRouteOwnBox | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const row = JSON.parse(raw) as CloudRouteOwnBox;
    if (
      !row ||
      row.collectorRef == null ||
      row.date == null ||
      (row.route !== "A" && row.route !== "N") ||
      !Number.isFinite(Number(row.saldo))
    ) {
      return null;
    }
    const saldo = Math.trunc(Number(row.saldo));
    const efectivo = Math.trunc(Number(row.efectivo) || 0);
    const prestamos = Math.trunc(Number(row.prestamos) || 0);
    const gastos = Math.trunc(Number(row.gastos) || 0);
    const openingRaw = Number(row.opening);
    return {
      collectorRef: String(row.collectorRef),
      date: String(row.date).slice(0, 10),
      route: row.route,
      saldo,
      opening: Number.isFinite(openingRaw)
        ? Math.trunc(openingRaw)
        : saldo - efectivo + prestamos + gastos,
      efectivo,
      prestamos,
      gastos,
      fetchedAt: String(row.fetchedAt || ""),
    };
  } catch {
    return null;
  }
}

function writePersisted(key: string, row: CloudRouteOwnBox) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(row));
  } catch {
    /* cupo / modo privado */
  }
}

export function getCloudRouteOwnBox(
  collectorRef: string,
  date: string,
  route: string,
): CloudRouteOwnBox | null {
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

export function rememberCloudRouteOwnBox(row: CloudRouteOwnBox) {
  const key = keyOf(row.collectorRef, row.date, row.route);
  byKey.set(key, row);
  writePersisted(key, row);
}

async function fetchRouteOwnBoxOnce(
  ref: string,
  date: string,
  pin: "A" | "N",
): Promise<CloudRouteOwnBox | null> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && typeof window !== "undefined"
      ? window.setTimeout(() => ctrl.abort(), 12_000)
      : 0;
  try {
    const res = await fetch(
      `/api/ops/route-own-box?collectorRef=${encodeURIComponent(ref)}&date=${encodeURIComponent(date)}&route=${encodeURIComponent(pin)}`,
      { cache: "no-store", signal: ctrl?.signal },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      saldo?: number;
      opening?: number;
      efectivo?: number;
      prestamos?: number;
      gastos?: number;
    };
    if (!body || body.ok !== true || !Number.isFinite(Number(body.saldo))) return null;
    const saldo = Math.trunc(Number(body.saldo));
    const efectivo = Math.trunc(Number(body.efectivo) || 0);
    const prestamos = Math.trunc(Number(body.prestamos) || 0);
    const gastos = Math.trunc(Number(body.gastos) || 0);
    const openingRaw = Number(body.opening);
    const row: CloudRouteOwnBox = {
      collectorRef: ref,
      date,
      route: pin,
      saldo,
      opening: Number.isFinite(openingRaw)
        ? Math.trunc(openingRaw)
        : saldo - efectivo + prestamos + gastos,
      efectivo,
      prestamos,
      gastos,
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudRouteOwnBox(row);
    return row;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
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
    const first = await fetchRouteOwnBoxOnce(ref, date, pin);
    if (first) return first;
    // Un reintento: bajo carga el primer intento aborta y dejaba GASTO 0.
    return await fetchRouteOwnBoxOnce(ref, date, pin);
  } catch (error) {
    console.error("refreshCloudRouteOwnBox", error);
    return getCloudRouteOwnBox(ref, date, pin);
  }
}

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

/**
 * Baja cajas A/N de un rango (historial del mes). Lotes de 6 para no saturar.
 * Devuelve cuántas filas nuevas entraron a caché.
 */
export async function refreshCloudRouteOwnBoxRange(
  collectorRef: string,
  route: string,
  fromIso: string,
  toIso: string,
): Promise<number> {
  const days = daysInclusive(fromIso, toIso);
  if (!days.length) return 0;
  let hit = 0;
  const chunk = 6;
  for (let i = 0; i < days.length; i += chunk) {
    const batch = days.slice(i, i + chunk);
    const rows = await Promise.all(
      batch.map((date) => refreshCloudRouteOwnBox(collectorRef, date, route)),
    );
    for (const row of rows) {
      if (row) hit += 1;
    }
  }
  return hit;
}
