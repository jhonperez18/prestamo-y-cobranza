/**
 * Caché en el aparato de la caja del día (Fase 3.2).
 * Con red gana la base; sin dato → buildDayCashLedger usa el libro local.
 */
export type CloudDayCashFigure = {
  collectorRef: string;
  date: string;
  ready: boolean;
  opening: number | null;
  mClosing: number | null;
  dayFinal: number | null;
  cie: number | null;
  saldo: number | null;
  error?: string;
  missingDay?: string;
  fetchedAt: string;
};

const byKey = new Map<string, CloudDayCashFigure>();

function keyOf(collectorRef: string, date: string) {
  return `${collectorRef.trim()}|${date}`;
}

export function getCloudDayCashFigure(
  collectorRef: string,
  date: string,
): CloudDayCashFigure | null {
  return byKey.get(keyOf(collectorRef, date)) ?? null;
}

export function rememberCloudDayCashFigure(row: CloudDayCashFigure) {
  byKey.set(keyOf(row.collectorRef, row.date), row);
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
      opening?: number;
      mClosing?: number;
      dayFinal?: number;
      cie?: number | null;
      saldo?: number;
      error?: string;
      missingDay?: string;
    };
    if (!body || body.ok !== true) return null;
    const row: CloudDayCashFigure = {
      collectorRef: ref,
      date,
      ready: Boolean(body.ready),
      opening: body.ready ? Math.trunc(Number(body.opening) || 0) : null,
      mClosing: body.ready ? Math.trunc(Number(body.mClosing) || 0) : null,
      dayFinal: body.ready ? Math.trunc(Number(body.dayFinal) || 0) : null,
      cie: body.cie == null ? null : Math.trunc(Number(body.cie)),
      saldo: body.ready ? Math.trunc(Number(body.saldo) || 0) : null,
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
