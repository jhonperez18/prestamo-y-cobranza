/**
 * Caché en el aparato de Banco / Nequi (Fase 3.3).
 * Con red gana la base; sin dato → digitalPoolBalances usa el libro local.
 */
export type CloudDigitalPoolBalances = {
  banco: number;
  nequi: number;
  fetchedAt: string;
};

let cached: CloudDigitalPoolBalances | null = null;

export function getCloudDigitalPoolBalances(): CloudDigitalPoolBalances | null {
  return cached;
}

export function rememberCloudDigitalPoolBalances(row: CloudDigitalPoolBalances) {
  cached = row;
}

export async function refreshCloudDigitalPoolBalances(): Promise<CloudDigitalPoolBalances | null> {
  try {
    const res = await fetch("/api/ops/digital-pool-balances", { cache: "no-store" });
    const body = (await res.json()) as { ok?: boolean; banco?: number; nequi?: number };
    if (!body || body.ok !== true) return null;
    const banco = Math.trunc(Number(body.banco));
    const nequi = Math.trunc(Number(body.nequi));
    if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return null;
    const row: CloudDigitalPoolBalances = {
      banco,
      nequi,
      fetchedAt: new Date().toISOString(),
    };
    rememberCloudDigitalPoolBalances(row);
    return row;
  } catch (error) {
    console.error("refreshCloudDigitalPoolBalances", error);
    return null;
  }
}
