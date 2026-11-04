/**
 * Inicial M leído en la base (Fase 3.1). Solo lee. No escribe CIE ni cash_float.
 * Disco/memoria primero: el supervisor no puede esperar a Supabase en cada paint.
 */
import { promises as fs } from "fs";
import path from "path";
import {
  createSupabaseAdminClient,
  resetSupabaseAdminClient,
} from "@/lib/supabase/admin";

export type ChainMOpeningResult =
  | {
      ok: true;
      ready: true;
      opening: number;
      priorCieRef: string;
      priorCieDate: string;
    }
  | {
      ok: true;
      ready: false;
      opening: null;
      error: string;
      missingDay?: string;
      priorCieRef?: string;
      priorCieDate?: string;
    }
  | { ok: false; error: string };

type OkReady = Extract<ChainMOpeningResult, { ok: true; ready: true }>;

const mem = new Map<string, { at: number; row: OkReady }>();
const MEM_TTL_MS = 90_000;
const FILE = path.join(process.cwd(), "data", "chain-m-opening-cache.json");
let fileLoaded = false;
const disk = new Map<string, OkReady & { collectorRef: string; date: string }>();
const refreshing = new Set<string>();

function cacheKey(collectorRef: string, date: string) {
  return `${collectorRef}|${date}`;
}

function isTransientFetchError(message: string) {
  return /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_|network/i.test(message);
}

function mapChainMOpeningBody(data: unknown): ChainMOpeningResult {
  const body = data as {
    ok?: boolean;
    ready?: boolean;
    opening?: number | null;
    error?: string;
    missing_day?: string;
    prior_cie_ref?: string;
    prior_cie_date?: string;
  } | null;

  if (!body || body.ok !== true) {
    return { ok: false, error: body?.error || "sin_inicial" };
  }

  if (body.ready === true && body.opening != null && Number.isFinite(Number(body.opening))) {
    return {
      ok: true,
      ready: true,
      opening: Math.trunc(Number(body.opening)),
      priorCieRef: String(body.prior_cie_ref || ""),
      priorCieDate: String(body.prior_cie_date || ""),
    };
  }

  return {
    ok: true,
    ready: false,
    opening: null,
    error: body.error || "no_listo",
    missingDay: body.missing_day,
    priorCieRef: body.prior_cie_ref,
    priorCieDate: body.prior_cie_date,
  };
}

async function ensureDisk() {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<
      string,
      OkReady & { collectorRef?: string; date?: string }
    >;
    for (const [key, row] of Object.entries(parsed || {})) {
      if (!row || row.ok !== true || row.ready !== true) continue;
      if (!Number.isFinite(Number(row.opening))) continue;
      const [collectorRef, date] = key.split("|");
      if (!collectorRef || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) continue;
      disk.set(key, {
        ok: true,
        ready: true,
        opening: Math.trunc(Number(row.opening)),
        priorCieRef: String(row.priorCieRef || ""),
        priorCieDate: String(row.priorCieDate || ""),
        collectorRef,
        date,
      });
    }
  } catch {
    /* sin archivo */
  }
}

async function persistDisk() {
  const out: Record<string, unknown> = {};
  for (const [key, row] of disk) out[key] = row;
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("chain-m-opening-cache-write", error);
  }
}

function remember(collectorRef: string, date: string, row: OkReady) {
  const key = cacheKey(collectorRef, date);
  mem.set(key, { at: Date.now(), row });
  disk.set(key, { ...row, collectorRef, date });
  void persistDisk();
}

async function rpcChainMOpening(ref: string, date: string) {
  const client = createSupabaseAdminClient();
  if (!client) return { data: null, errorMessage: "sin_servicio" as string | null };
  try {
    const { data, error } = await client.rpc("chain_m_opening", {
      p_collector_ref: ref,
      p_date: date,
    });
    return { data, errorMessage: error?.message ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "chain_m_opening_failed";
    return { data: null, errorMessage: message };
  }
}

async function rpcOnce(collectorRef: string, date: string): Promise<ChainMOpeningResult> {
  let { data, errorMessage } = await rpcChainMOpening(collectorRef, date);
  if (errorMessage && isTransientFetchError(errorMessage)) {
    console.error("chain-m-opening-fetch-failed-retry", errorMessage);
    resetSupabaseAdminClient();
    ({ data, errorMessage } = await rpcChainMOpening(collectorRef, date));
  }
  if (errorMessage) return { ok: false, error: errorMessage };
  return mapChainMOpeningBody(data);
}

function refreshInBackground(ref: string, date: string) {
  const key = cacheKey(ref, date);
  if (refreshing.has(key)) return;
  refreshing.add(key);
  void (async () => {
    try {
      const result = await rpcOnce(ref, date);
      if (result.ok && result.ready) remember(ref, date, result);
    } catch (error) {
      console.error("chain-m-opening-refresh", error);
    } finally {
      refreshing.delete(key);
    }
  })();
}

export async function readChainMOpening(
  collectorRef: string,
  date: string,
): Promise<ChainMOpeningResult> {
  const ref = collectorRef.trim();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "dato_invalido" };
  }

  await ensureDisk();
  const key = cacheKey(ref, date);
  const memHit = mem.get(key);
  if (memHit && Date.now() - memHit.at < MEM_TTL_MS) {
    refreshInBackground(ref, date);
    return memHit.row;
  }

  const warm = disk.get(key);
  if (warm) {
    mem.set(key, {
      at: Date.now(),
      row: {
        ok: true,
        ready: true,
        opening: warm.opening,
        priorCieRef: warm.priorCieRef,
        priorCieDate: warm.priorCieDate,
      },
    });
    refreshInBackground(ref, date);
    return {
      ok: true,
      ready: true,
      opening: warm.opening,
      priorCieRef: warm.priorCieRef,
      priorCieDate: warm.priorCieDate,
    };
  }

  try {
    const result = await rpcOnce(ref, date);
    if (result.ok && result.ready) remember(ref, date, result);
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "rpc_failed",
    };
  }
}
