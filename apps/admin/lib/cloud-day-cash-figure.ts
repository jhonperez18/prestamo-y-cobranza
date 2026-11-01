/**
 * Caché en el aparato de la caja del día (Fase 3.2).
 * Con red gana la base; sin dato → buildDayCashLedger usa el libro local.
 * Incluye movimiento M/T: el Cierre no puede mostrar gasto 0 si la base tiene 212k.
 */
export type CloudDayCashFigure = {
  collectorRef: string;
  date: string;
  ready: boolean;
  chain: boolean;
  opening: number | null;
  mClosing: number | null;
  dayFinal: number | null;
  cie: number | null;
  saldo: number | null;
  mEfectivo: number | null;
  mPrestamos: number | null;
  mGastos: number | null;
  tEfectivo: number | null;
  tPrestamos: number | null;
  tGastos: number | null;
  error?: string;
  missingDay?: string;
  fetchedAt: string;
};

const byKey = new Map<string, CloudDayCashFigure>();
const STORAGE_PREFIX = "nexo-day-cash-figure:";

function keyOf(collectorRef: string, date: string) {
  return `${collectorRef.trim()}|${date}`;
}

function readPersisted(key: string): CloudDayCashFigure | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const row = JSON.parse(raw) as CloudDayCashFigure;
    if (!row || row.collectorRef == null || row.date == null) return null;
    return {
      ...row,
      collectorRef: String(row.collectorRef),
      date: String(row.date).slice(0, 10),
      ready: Boolean(row.ready),
      chain: Boolean(row.chain),
      opening: row.opening == null ? null : Math.trunc(Number(row.opening)),
      mClosing: row.mClosing == null ? null : Math.trunc(Number(row.mClosing)),
      dayFinal: row.dayFinal == null ? null : Math.trunc(Number(row.dayFinal)),
      cie: row.cie == null ? null : Math.trunc(Number(row.cie)),
      saldo: row.saldo == null ? null : Math.trunc(Number(row.saldo)),
      mEfectivo: row.mEfectivo == null ? null : Math.trunc(Number(row.mEfectivo)),
      mPrestamos: row.mPrestamos == null ? null : Math.trunc(Number(row.mPrestamos)),
      mGastos: row.mGastos == null ? null : Math.trunc(Number(row.mGastos)),
      tEfectivo: row.tEfectivo == null ? null : Math.trunc(Number(row.tEfectivo)),
      tPrestamos: row.tPrestamos == null ? null : Math.trunc(Number(row.tPrestamos)),
      tGastos: row.tGastos == null ? null : Math.trunc(Number(row.tGastos)),
      fetchedAt: String(row.fetchedAt || ""),
    };
  } catch {
    return null;
  }
}

function writePersisted(key: string, row: CloudDayCashFigure) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(row));
  } catch {
    /* cupo */
  }
}

export function getCloudDayCashFigure(
  collectorRef: string,
  date: string,
): CloudDayCashFigure | null {
  const key = keyOf(collectorRef, date);
  const hit = byKey.get(key);
  if (hit) return hit;
  const warm = readPersisted(key);
  if (warm) {
    byKey.set(key, warm);
    return warm;
  }
  return null;
}

export function rememberCloudDayCashFigure(row: CloudDayCashFigure) {
  const key = keyOf(row.collectorRef, row.date);
  byKey.set(key, row);
  writePersisted(key, row);
}

export async function refreshCloudDayCashFigure(
  collectorRef: string,
  date: string,
): Promise<CloudDayCashFigure | null> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    const res = await fetch(
      `/api/ops/day-cash-figure?collectorRef=${encodeURIComponent(ref)}&date=${encodeURIComponent(date)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      ready?: boolean;
      chain?: boolean;
      opening?: number;
      mClosing?: number;
      dayFinal?: number;
      cie?: number | null;
      saldo?: number;
      mEfectivo?: number;
      mPrestamos?: number;
      mGastos?: number;
      tEfectivo?: number;
      tPrestamos?: number;
      tGastos?: number;
      error?: string;
      missingDay?: string;
    };
    if (!body || body.ok !== true) return null;
    const row: CloudDayCashFigure = {
      collectorRef: ref,
      date,
      ready: Boolean(body.ready),
      chain: Boolean(body.chain),
      opening: body.ready ? Math.trunc(Number(body.opening) || 0) : null,
      mClosing: body.ready ? Math.trunc(Number(body.mClosing) || 0) : null,
      dayFinal: body.ready ? Math.trunc(Number(body.dayFinal) || 0) : null,
      cie: body.cie == null ? null : Math.trunc(Number(body.cie)),
      saldo: body.ready ? Math.trunc(Number(body.saldo) || 0) : null,
      mEfectivo: body.mEfectivo == null ? null : Math.trunc(Number(body.mEfectivo)),
      mPrestamos: body.mPrestamos == null ? null : Math.trunc(Number(body.mPrestamos)),
      mGastos: body.mGastos == null ? null : Math.trunc(Number(body.mGastos)),
      tEfectivo: body.tEfectivo == null ? null : Math.trunc(Number(body.tEfectivo)),
      tPrestamos: body.tPrestamos == null ? null : Math.trunc(Number(body.tPrestamos)),
      tGastos: body.tGastos == null ? null : Math.trunc(Number(body.tGastos)),
      error: body.error,
      missingDay: body.missingDay,
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudDayCashFigure(row);
    return row;
  } catch (error) {
    console.error("refreshCloudDayCashFigure", error);
    return null;
  }
}
