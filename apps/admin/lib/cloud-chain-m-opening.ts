/**
 * Caché del Inicial M que manda la base (Fase 3.1).
 * Con red gana la nube. Copia en sessionStorage: el primer paint no muestra
 * un CIE local viejo (caso 01/11: 5.428.000 → 82.000 a los 5 s).
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
const STORAGE_PREFIX = "nexo-chain-m-opening:";

function keyOf(collectorRef: string, date: string) {
  return `${collectorRef.trim()}|${date}`;
}

function readPersisted(key: string): CloudChainMOpening | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const row = JSON.parse(raw) as CloudChainMOpening;
    if (!row || row.collectorRef == null || row.date == null) return null;
    return {
      collectorRef: String(row.collectorRef),
      date: String(row.date).slice(0, 10),
      ready: Boolean(row.ready),
      opening:
        row.opening == null || !Number.isFinite(Number(row.opening))
          ? null
          : Math.trunc(Number(row.opening)),
      error: row.error,
      missingDay: row.missingDay,
      priorCieRef: row.priorCieRef,
      priorCieDate: row.priorCieDate,
      fetchedAt: String(row.fetchedAt || ""),
    };
  } catch {
    return null;
  }
}

function writePersisted(key: string, row: CloudChainMOpening) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(row));
  } catch {
    /* cupo / modo privado */
  }
}

export function getCloudChainMOpening(
  collectorRef: string,
  date: string,
): CloudChainMOpening | null {
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

export function rememberCloudChainMOpening(row: CloudChainMOpening) {
  const key = keyOf(row.collectorRef, row.date);
  byKey.set(key, row);
  writePersisted(key, row);
}

function rememberFromBody(
  ref: string,
  date: string,
  body: {
    ready?: boolean;
    opening?: number | null;
    error?: string;
    missingDay?: string;
    priorCieRef?: string;
    priorCieDate?: string;
  },
): CloudChainMOpening {
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
}

/** Baja el Inicial M de la base y lo guarda para la planilla + primer paint. */
export async function refreshCloudChainMOpening(
  collectorRef: string,
  date: string,
): Promise<CloudChainMOpening | null> {
  const rows = await refreshCloudChainMOpenings([collectorRef], date);
  return rows[0] ?? null;
}

/**
 * Un solo viaje: Inicial M de varios cobradores (INICIO M/T).
 * Disco del servidor primero; no inventa cifra.
 */
export async function refreshCloudChainMOpenings(
  collectorRefs: readonly string[],
  date: string,
): Promise<CloudChainMOpening[]> {
  const refs = [
    ...new Set(collectorRefs.map((ref) => ref.trim()).filter(Boolean)),
  ];
  if (refs.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  try {
    const qs =
      refs.length === 1
        ? `collectorRef=${encodeURIComponent(refs[0])}&date=${encodeURIComponent(date)}`
        : `collectorRefs=${encodeURIComponent(refs.join(","))}&date=${encodeURIComponent(date)}`;
    const res = await fetch(`/api/ops/chain-m-opening?${qs}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      ready?: boolean;
      opening?: number | null;
      error?: string;
      missingDay?: string;
      priorCieRef?: string;
      priorCieDate?: string;
      rows?: Array<{
        collectorRef?: string;
        ok?: boolean;
        ready?: boolean;
        opening?: number | null;
        error?: string;
        missingDay?: string;
        priorCieRef?: string;
        priorCieDate?: string;
      }>;
    };
    if (!body || body.ok !== true) return [];

    if (refs.length === 1) {
      return [rememberFromBody(refs[0], date, body)];
    }

    const out: CloudChainMOpening[] = [];
    for (const piece of body.rows || []) {
      const ref = String(piece.collectorRef || "").trim();
      if (!ref || piece.ok !== true) continue;
      out.push(rememberFromBody(ref, date, piece));
    }
    return out;
  } catch (error) {
    console.error("refreshCloudChainMOpenings", error);
    return [];
  }
}
