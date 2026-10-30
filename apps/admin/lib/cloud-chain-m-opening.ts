/**
 * Caché en el aparato del Inicial M que manda la base (Fase 3.1).
 * Con red gana la nube; sin dato → openingCashForChainedPlanilla usa CIE local.
 */
export type CloudChainMOpening = {
  collectorRef: string;
  date: string;
  ready: boolean;
  opening: number | null;
  error?: string;
  missingDay?: string;
  priorCieRef?: string;
  priorCieDate?: string;
  fetchedAt: string;
};

const byKey = new Map<string, CloudChainMOpening>();

function keyOf(collectorRef: string, date: string) {
  return `${collectorRef.trim()}|${date}`;
}

export function getCloudChainMOpening(
  collectorRef: string,
  date: string,
): CloudChainMOpening | null {
  return byKey.get(keyOf(collectorRef, date)) ?? null;
}

export function rememberCloudChainMOpening(row: CloudChainMOpening) {
  byKey.set(keyOf(row.collectorRef, row.date), row);
}

/** Baja el Inicial M de la base y lo guarda para la planilla. */
export async function refreshCloudChainMOpening(
  collectorRef: string,
  date: string,
): Promise<CloudChainMOpening | null> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    const res = await fetch(
      `/api/ops/chain-m-opening?collectorRef=${encodeURIComponent(ref)}&date=${encodeURIComponent(date)}`,
      { cache: "no-store" },
    );
    const body = (await res.json()) as {
      ok?: boolean;
      ready?: boolean;
      opening?: number | null;
      error?: string;
      missingDay?: string;
      priorCieRef?: string;
      priorCieDate?: string;
    };
    if (!body || body.ok !== true) return null;
    const row: CloudChainMOpening = {
      collectorRef: ref,
      date,
      ready: Boolean(body.ready),
      opening: body.ready && body.opening != null ? Math.trunc(Number(body.opening)) : null,
      error: body.error,
      missingDay: body.missingDay,
      priorCieRef: body.priorCieRef,
      priorCieDate: body.priorCieDate,
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudChainMOpening(row);
    return row;
  } catch (error) {
    console.error("refreshCloudChainMOpening", error);
    return null;
  }
}
