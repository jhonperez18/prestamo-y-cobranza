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
