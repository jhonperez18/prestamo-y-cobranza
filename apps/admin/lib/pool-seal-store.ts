/**
 * Sellos Banco/Nequi por mes (disco + memoria).
 * Evita colgar Storage de Supabase en cada apertura del supervisor.
 */
import { promises as fs } from "fs";
import path from "path";

export type PoolSealRow = {
  banco: number;
  nequi: number;
  sealedOn?: string;
};

const memory = new Map<string, PoolSealRow>();
const FILE = path.join(process.cwd(), "data", "pool-seals.json");

let fileLoaded = false;

async function ensureFileLoaded() {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, PoolSealRow>;
    for (const [period, row] of Object.entries(parsed || {})) {
      if (!/^\d{4}-\d{2}$/.test(period)) continue;
      const banco = Math.trunc(Number(row?.banco));
      const nequi = Math.trunc(Number(row?.nequi));
      if (!Number.isFinite(banco) || !Number.isFinite(nequi)) continue;
      memory.set(period, {
        banco,
        nequi,
        sealedOn: row.sealedOn ? String(row.sealedOn).slice(0, 10) : undefined,
      });
    }
  } catch {
    /* sin archivo aún */
  }
}

async function persistAll() {
  const out: Record<string, PoolSealRow> = {};
  for (const [period, row] of memory) out[period] = row;
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("pool-seal-store-write", error);
  }
}

export async function readPoolSeal(period: string): Promise<PoolSealRow | null> {
  await ensureFileLoaded();
  return memory.get(period) ?? null;
}

export async function writePoolSeal(
  period: string,
  banco: number,
  nequi: number,
  sealedOn?: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(period)) return;
  if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return;
  await ensureFileLoaded();
  memory.set(period, {
    banco: Math.trunc(banco),
    nequi: Math.trunc(nequi),
    sealedOn: sealedOn ? sealedOn.slice(0, 10) : memory.get(period)?.sealedOn,
  });
  await persistAll();
}

/** Último Saldo vivo del día (respaldo si Supabase tarda). */
export type LivePoolSnap = {
  toIso: string;
  banco: number;
  nequi: number;
  at: string;
};

const LIVE_FILE = path.join(process.cwd(), "data", "pool-live.json");
let liveSnap: LivePoolSnap | null = null;
let liveLoaded = false;

async function ensureLiveLoaded() {
  if (liveLoaded) return;
  liveLoaded = true;
  try {
    const raw = await fs.readFile(LIVE_FILE, "utf8");
    const row = JSON.parse(raw) as LivePoolSnap;
    if (
      row &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(row.toIso || "")) &&
      Number.isFinite(Number(row.banco)) &&
      Number.isFinite(Number(row.nequi))
    ) {
      liveSnap = {
        toIso: String(row.toIso).slice(0, 10),
        banco: Math.trunc(Number(row.banco)),
        nequi: Math.trunc(Number(row.nequi)),
        at: String(row.at || ""),
      };
    }
  } catch {
    /* sin archivo */
  }
}

export async function readLivePoolSnap(): Promise<LivePoolSnap | null> {
  await ensureLiveLoaded();
  return liveSnap;
}

export async function writeLivePoolSnap(
  toIso: string,
  banco: number,
  nequi: number,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return;
  if (!Number.isFinite(banco) || !Number.isFinite(nequi)) return;
  liveSnap = {
    toIso,
    banco: Math.trunc(banco),
    nequi: Math.trunc(nequi),
    at: new Date().toISOString(),
  };
  liveLoaded = true;
  try {
    await fs.mkdir(path.dirname(LIVE_FILE), { recursive: true });
    await fs.writeFile(LIVE_FILE, `${JSON.stringify(liveSnap, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("pool-live-write", error);
  }
}

/** Suelta el snap vivo: no puede quedar una cifra vieja como respuesta. */
export async function clearLivePoolSnap(): Promise<void> {
  liveSnap = null;
  liveLoaded = true;
  try {
    await fs.unlink(LIVE_FILE);
  } catch {
    /* no había archivo */
  }
}
