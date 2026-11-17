/**
 * Saldo Banco/Nequi del servidor (rutas − gastos).
 *
 * Cifra = última respuesta OK del servidor para el mismo `toIso`.
 * Primer paint: sesión/RAM si coincide el día; atrás soft-refresh.
 * Prohibido sumar en el aparato (`digitalPoolBalances` / pool local).
 */
export type CloudPoolVisibleSaldo = {
  banco: number;
  nequi: number;
  fromIso: string;
  toIso: string;
  fetchedAt: string;
};

const STORAGE_KEY = "nexo-cloud-pool-visible-saldo";
/** Hoy: 45 s. Evita martillar el libro en cada remount. */
const LIVE_TTL_MS = 45_000;

let cached: CloudPoolVisibleSaldo | null = null;

function readPersisted(): CloudPoolVisibleSaldo | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as CloudPoolVisibleSaldo;
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.toIso || ""))) return null;
    const banco = Math.trunc(Number(row.banco));
    const nequi = Math.trunc(Number(row.nequi));
    if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return null;
    return {
      banco,
      nequi,
      fromIso: String(row.fromIso || ""),
      toIso: String(row.toIso),
      fetchedAt: String(row.fetchedAt || ""),
    };
  } catch {
    return null;
  }
}

function writePersisted(row: CloudPoolVisibleSaldo) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(row));
  } catch {
    /* cupo / privado */
  }
}

export function getCloudPoolVisibleSaldo(toIso?: string): CloudPoolVisibleSaldo | null {
  if (!cached) {
    const warm = readPersisted();
    if (warm) cached = warm;
  }
  if (!cached) return null;
  if (toIso && cached.toIso !== toIso) return null;
  return cached;
}

export function clearCloudPoolVisibleSaldo(): void {
  cached = null;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* cupo / privado */
  }
}

export function rememberCloudPoolVisibleSaldo(row: CloudPoolVisibleSaldo) {
  cached = row;
  writePersisted(row);
}

/**
 * Cierre de un día ya pasado (Inicial del mes). No toca la cifra viva del Saldo.
 * Una lectura; quien llama la guarda y no la vuelve a pedir.
 */
export async function readPoolVisibleSaldoAt(
  toIso: string,
): Promise<{ banco: number; nequi: number; toIso: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return null;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && typeof window !== "undefined"
      ? window.setTimeout(() => ctrl.abort(), 30_000)
      : 0;
  try {
    const res = await fetch(`/api/ops/pool-visible-saldo?to=${toIso}`, {
      cache: "no-store",
      signal: ctrl?.signal,
    });
    const body = (await res.json()) as {
      ok?: boolean;
      banco?: number;
      nequi?: number;
      toIso?: string;
    };
    if (!body || body.ok !== true) return null;
    const banco = Math.trunc(Number(body.banco));
    const nequi = Math.trunc(Number(body.nequi));
    if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return null;
    return { banco, nequi, toIso: String(body.toIso || toIso) };
  } catch (error) {
    console.error("readPoolVisibleSaldoAt", error);
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

export async function refreshCloudPoolVisibleSaldo(
  toIso?: string,
  opts: { force?: boolean } = {},
): Promise<CloudPoolVisibleSaldo | null> {
  const want = toIso && /^\d{4}-\d{2}-\d{2}$/.test(toIso) ? toIso : "";
  const warm = getCloudPoolVisibleSaldo(want || undefined);
  if (
    !opts.force &&
    warm &&
    (!want || warm.toIso === want) &&
    Date.now() - Date.parse(warm.fetchedAt || "") < LIVE_TTL_MS
  ) {
    return warm;
  }

  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && typeof window !== "undefined"
      ? window.setTimeout(() => ctrl.abort(), 30_000)
      : 0;
  try {
    const qs = want ? `?to=${want}` : "";
    const res = await fetch(`/api/ops/pool-visible-saldo${qs}`, {
      cache: "no-store",
      signal: ctrl?.signal,
    });
    const body = (await res.json()) as {
      ok?: boolean;
      banco?: number;
      nequi?: number;
      fromIso?: string;
      toIso?: string;
    };
    if (!body || body.ok !== true) return warm;
    const banco = Math.trunc(Number(body.banco));
    const nequi = Math.trunc(Number(body.nequi));
    if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return warm;
    const row: CloudPoolVisibleSaldo = {
      banco,
      nequi,
      fromIso: String(body.fromIso || ""),
      toIso: String(body.toIso || want || ""),
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudPoolVisibleSaldo(row);
    return row;
  } catch (error) {
    console.error("refreshCloudPoolVisibleSaldo", error);
    return warm;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
