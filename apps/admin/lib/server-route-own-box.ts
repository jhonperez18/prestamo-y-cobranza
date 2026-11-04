/**
 * Caja propia A/N leída en la base (Fase 3.3). Solo lee. No escribe CIE.
 * Disco/memoria primero (el supervisor no puede esperar a Supabase).
 */
import { promises as fs } from "fs";
import path from "path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type RouteOwnBoxResult =
  | {
      ok: true;
      route: "A" | "N";
      saldo: number;
      opening: number;
      efectivo: number;
      prestamos: number;
      gastos: number;
      anchor: string | null;
      anchorReal: number | null;
    }
  | { ok: false; error: string };

type OkBox = Extract<RouteOwnBoxResult, { ok: true }>;

const mem = new Map<string, { at: number; row: OkBox }>();
const MEM_TTL_MS = 90_000;
const FILE = path.join(process.cwd(), "data", "route-own-box-cache.json");
let fileLoaded = false;
const disk = new Map<string, OkBox & { date: string; collectorRef: string }>();
const refreshing = new Set<string>();

function cacheKey(collectorRef: string, date: string, route: string) {
  return `${collectorRef}|${date}|${route}`;
}

async function ensureDisk() {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, OkBox & { date?: string; collectorRef?: string }>;
    for (const [key, row] of Object.entries(parsed || {})) {
      if (!row || row.ok !== true || !Number.isFinite(Number(row.saldo))) continue;
      disk.set(key, {
        ok: true,
        route: row.route === "A" ? "A" : "N",
        saldo: Math.trunc(Number(row.saldo)),
        opening: Math.trunc(Number(row.opening) || 0),
        efectivo: Math.trunc(Number(row.efectivo) || 0),
        prestamos: Math.trunc(Number(row.prestamos) || 0),
        gastos: Math.trunc(Number(row.gastos) || 0),
        anchor: row.anchor ? String(row.anchor).slice(0, 10) : null,
        anchorReal:
          row.anchorReal == null || !Number.isFinite(Number(row.anchorReal))
            ? null
            : Math.trunc(Number(row.anchorReal)),
        date: String(row.date || key.split("|")[1] || ""),
        collectorRef: String(row.collectorRef || key.split("|")[0] || ""),
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
    console.error("route-own-box-cache-write", error);
  }
}

function remember(collectorRef: string, date: string, row: OkBox) {
  const key = cacheKey(collectorRef, date, row.route);
  mem.set(key, { at: Date.now(), row });
  disk.set(key, { ...row, date, collectorRef });
  void persistDisk();
}

function cachedRow(collectorRef: string, date: string, route: string): OkBox | null {
  const key = cacheKey(collectorRef, date, route);
  const hit = mem.get(key);
  if (hit) return hit.row;
  const warm = disk.get(key);
  if (!warm) return null;
  return {
    ok: true,
    route: warm.route,
    saldo: warm.saldo,
    opening: warm.opening,
    efectivo: warm.efectivo,
    prestamos: warm.prestamos,
    gastos: warm.gastos,
    anchor: warm.anchor,
    anchorReal: warm.anchorReal,
  };
}

/**
 * N ya sellada: el CIE es la caja (Yesid no hace M/T).
 * Una sola fila day_closes — sin bajar planilla. A espera la migración SQL
 * (su CIE puede ser cadena M/T el mismo día).
 */
async function sealedNCieFloat(
  collectorRef: string,
  date: string,
): Promise<number | null> {
  const client = createSupabaseAdminClient();
  if (!client) return null;
  const { data: cie, error } = await client
    .from("day_closes")
    .select("cash_float")
    .eq("collector_ref", collectorRef)
    .eq("close_date", date)
    .like("ref", "CIE-%")
    .limit(1)
    .maybeSingle();
  if (error || !cie || cie.cash_float == null) return null;
  const float = Math.trunc(Number(cie.cash_float));
  return Number.isFinite(float) ? float : null;
}

async function rpcOnce(
  collectorRef: string,
  date: string,
  pin: "A" | "N",
): Promise<RouteOwnBoxResult> {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };
  const sealedPromise = pin === "N" ? sealedNCieFloat(collectorRef, date) : Promise.resolve(null);
  const [rpc, sealed] = await Promise.all([
    client.rpc("route_own_box", {
      p_collector_ref: collectorRef,
      p_date: date,
      p_route: pin,
    }),
    sealedPromise,
  ]);
  if (rpc.error) return { ok: false, error: rpc.error.message };
  const body = rpc.data as {
    ok?: boolean;
    route?: string;
    saldo?: number;
    opening?: number;
    efectivo?: number;
    prestamos?: number;
    gastos?: number;
    anchor?: string;
    anchor_real?: number;
    error?: string;
  } | null;
  let saldo = Number(body?.saldo);
  if (!body || body.ok !== true || !Number.isFinite(saldo)) {
    return { ok: false, error: body?.error || "sin_caja" };
  }
  // N sellada: CIE manda (estático). Sin CIE → fórmula viva de la RPC.
  if (sealed != null) saldo = sealed;
  const efectivo = Math.trunc(Number(body.efectivo) || 0);
  const prestamos = Math.trunc(Number(body.prestamos) || 0);
  const gastos = Math.trunc(Number(body.gastos) || 0);
  const openingRaw = Number(body.opening);
  const opening = Number.isFinite(openingRaw)
    ? Math.trunc(openingRaw)
    : Math.trunc(saldo) - efectivo + prestamos + gastos;
  return {
    ok: true,
    route: pin,
    saldo: Math.trunc(saldo),
    opening,
    efectivo,
    prestamos,
    gastos,
    anchor: body.anchor ? String(body.anchor).slice(0, 10) : null,
    anchorReal:
      body.anchor_real == null || !Number.isFinite(Number(body.anchor_real))
        ? null
        : Math.trunc(Number(body.anchor_real)),
  };
}

function refreshInBackground(ref: string, date: string, pin: "A" | "N") {
  const key = cacheKey(ref, date, pin);
  if (refreshing.has(key)) return;
  refreshing.add(key);
  void (async () => {
    try {
      const result = await rpcOnce(ref, date, pin);
      if (result.ok) remember(ref, date, result);
    } catch (error) {
      console.error("route-own-box-refresh", error);
    } finally {
      refreshing.delete(key);
    }
  })();
}

export async function readRouteOwnBox(
  collectorRef: string,
  date: string,
  route: string,
): Promise<RouteOwnBoxResult> {
  const ref = collectorRef.trim();
  const pin = route.trim().toUpperCase();
  if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date) || (pin !== "A" && pin !== "N")) {
    return { ok: false, error: "dato_invalido" };
  }
  await ensureDisk();

  const key = cacheKey(ref, date, pin);

  // N sellada: si la caché no coincide con el CIE, no pintar saldo fantasma.
  if (pin === "N") {
    try {
      const sealed = await sealedNCieFloat(ref, date);
      if (sealed != null) {
        const warm = cachedRow(ref, date, pin);
        if (warm && warm.saldo === sealed) {
          mem.set(key, { at: Date.now(), row: warm });
          refreshInBackground(ref, date, pin);
          return warm;
        }
        const result = await rpcOnce(ref, date, pin);
        if (result.ok) {
          remember(ref, date, result);
          return result;
        }
        return result;
      }
    } catch (error) {
      console.error("route-own-box-sealed-n", error);
    }
  }

  const memHit = mem.get(key);
  if (memHit && Date.now() - memHit.at < MEM_TTL_MS) {
    refreshInBackground(ref, date, pin);
    return memHit.row;
  }

  const warm = cachedRow(ref, date, pin);
  if (warm) {
    // Respuesta al instante para el supervisor; la base actualiza atrás.
    mem.set(key, { at: Date.now(), row: warm });
    refreshInBackground(ref, date, pin);
    return warm;
  }

  try {
    const result = await rpcOnce(ref, date, pin);
    if (result.ok) {
      remember(ref, date, result);
      return result;
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "rpc_failed",
    };
  }
}
