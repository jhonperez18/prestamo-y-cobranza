/**
 * Caja propia A/N leída en la base (Fase 3.3). Solo lee. No escribe CIE.
 * Caché corta + disco: si Supabase falla a ratos, no se pinta GASTO 0.
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

function fromCache(collectorRef: string, date: string, route: string): OkBox | null {
  const key = cacheKey(collectorRef, date, route);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.row;
  const warm = disk.get(key);
  return warm
    ? {
        ok: true,
        route: warm.route,
        saldo: warm.saldo,
        opening: warm.opening,
        efectivo: warm.efectivo,
        prestamos: warm.prestamos,
        gastos: warm.gastos,
        anchor: warm.anchor,
        anchorReal: warm.anchorReal,
      }
    : null;
}

async function rpcOnce(
  collectorRef: string,
  date: string,
  pin: "A" | "N",
): Promise<RouteOwnBoxResult> {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };
  const { data, error } = await client.rpc("route_own_box", {
    p_collector_ref: collectorRef,
    p_date: date,
    p_route: pin,
  });
  if (error) return { ok: false, error: error.message };
  const body = data as {
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
  const saldo = Number(body?.saldo);
  if (!body || body.ok !== true || !Number.isFinite(saldo)) {
    return { ok: false, error: body?.error || "sin_caja" };
  }
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const cached = fromCache(ref, date, pin);
  // Memoria fresca: sirve al instante (no satura Supabase).
  const memHit = mem.get(cacheKey(ref, date, pin));
  if (memHit && Date.now() - memHit.at < MEM_TTL_MS) return memHit.row;

  let lastError = "sin_caja";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await rpcOnce(ref, date, pin);
      if (result.ok) {
        remember(ref, date, result);
        return result;
      }
      lastError = result.error;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "rpc_failed";
    }
    if (attempt < 2) await sleep(400 * (attempt + 1));
  }

  if (cached) return cached;
  return { ok: false, error: lastError };
}
