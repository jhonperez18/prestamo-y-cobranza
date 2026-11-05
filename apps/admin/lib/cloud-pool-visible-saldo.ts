/**
 * Saldo Banco/Nequi del servidor (rutas − gastos).
 * Sin pintar cifra de sesión: cada lectura pide la nube; hasta que llegue → «…».
 * Prohibido sessionStorage / copia local que deje 6.766 en un aparato y 7.013 en otro.
 */
export type CloudPoolVisibleSaldo = {
  banco: number;
  nequi: number;
  fromIso: string;
  toIso: string;
  fetchedAt: string;
};

/** Solo RAM de esta pestaña, tras un fetch OK. No se guarda en disco. */
let cached: CloudPoolVisibleSaldo | null = null;

export function getCloudPoolVisibleSaldo(): CloudPoolVisibleSaldo | null {
  return cached;
}

export function clearCloudPoolVisibleSaldo(): void {
  cached = null;
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem("nexo-cloud-pool-visible-saldo");
  } catch {
    /* cupo / privado */
  }
}

export function rememberCloudPoolVisibleSaldo(row: CloudPoolVisibleSaldo) {
  cached = row;
}

export async function refreshCloudPoolVisibleSaldo(
  toIso?: string,
): Promise<CloudPoolVisibleSaldo | null> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && typeof window !== "undefined"
      ? window.setTimeout(() => ctrl.abort(), 30_000)
      : 0;
  try {
    // Cada apertura pide de nuevo; no reusar cifra vieja de otra pestaña/sesión.
    clearCloudPoolVisibleSaldo();
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
