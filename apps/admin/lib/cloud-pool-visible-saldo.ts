/**
 * Caché de sesión: Saldo Banco/Nequi del servidor (rutas − gastos).
 * Gana sobre cualquier suma local incompleta del aparato.
 */
export type CloudPoolVisibleSaldo = {
  banco: number;
  nequi: number;
  fromIso: string;
  toIso: string;
  fetchedAt: string;
};

const SESSION_KEY = "nexo-cloud-pool-visible-saldo";

let cached: CloudPoolVisibleSaldo | null = null;

function readSession(): CloudPoolVisibleSaldo | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as CloudPoolVisibleSaldo;
    if (
      !row ||
      !Number.isFinite(row.banco) ||
      !Number.isFinite(row.nequi) ||
      !row.toIso
    ) {
      return null;
    }
    return row;
  } catch {
    return null;
  }
}

function writeSession(row: CloudPoolVisibleSaldo) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(row));
  } catch (error) {
    console.error("cloud-pool-visible-saldo-session", error);
  }
}

export function getCloudPoolVisibleSaldo(): CloudPoolVisibleSaldo | null {
  if (cached) return cached;
  cached = readSession();
  return cached;
}

export function rememberCloudPoolVisibleSaldo(row: CloudPoolVisibleSaldo) {
  cached = row;
  writeSession(row);
}

export async function refreshCloudPoolVisibleSaldo(
  toIso?: string,
): Promise<CloudPoolVisibleSaldo | null> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && typeof window !== "undefined"
      ? window.setTimeout(() => ctrl.abort(), 45_000)
      : 0;
  try {
    const qs = toIso && /^\d{4}-\d{2}-\d{2}$/.test(toIso) ? `?to=${toIso}` : "";
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
    if (!body || body.ok !== true) return null;
    const banco = Math.trunc(Number(body.banco));
    const nequi = Math.trunc(Number(body.nequi));
    if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return null;
    const row: CloudPoolVisibleSaldo = {
      banco,
      nequi,
      fromIso: String(body.fromIso || ""),
      toIso: String(body.toIso || toIso || ""),
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudPoolVisibleSaldo(row);
    return row;
  } catch (error) {
    console.error("refreshCloudPoolVisibleSaldo", error);
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
