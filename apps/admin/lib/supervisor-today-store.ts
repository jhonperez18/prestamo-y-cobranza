/**
 * Último día del supervisor en disco.
 * Si Supabase se cuelga, el jefe igual ve la última hoja buena (no “cerrado” inventado).
 */
import { promises as fs } from "fs";
import path from "path";
import type { SupervisorTodayPayload } from "@/lib/server-supervisor-today";

const FILE = path.join(process.cwd(), "data", "supervisor-today-cache.json");

type CachePayload = SupervisorTodayPayload & { at: string };

let memory: CachePayload | null = null;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const row = JSON.parse(raw) as CachePayload;
    if (row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ""))) {
      memory = {
        date: String(row.date).slice(0, 10),
        payments: Array.isArray(row.payments) ? row.payments : [],
        assignments: Array.isArray(row.assignments) ? row.assignments : [],
        dayCloses: Array.isArray(row.dayCloses) ? row.dayCloses : [],
        expenses: Array.isArray(row.expenses) ? row.expenses : [],
        // Caché vieja sin bandera: si trajo filas, se consideran listas.
        paymentsReady: row.paymentsReady !== false,
        expensesReady: row.expensesReady !== false,
        at: String(row.at || ""),
      };
    }
  } catch {
    /* sin archivo */
  }
}

export async function readSupervisorTodayCache(
  date: string,
): Promise<SupervisorTodayPayload | null> {
  await ensureLoaded();
  if (!memory || memory.date !== date) return null;
  const { at: _at, ...payload } = memory;
  return payload;
}

export async function writeSupervisorTodayCache(
  payload: SupervisorTodayPayload,
): Promise<void> {
  memory = { ...payload, at: new Date().toISOString() };
  loaded = true;
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, `${JSON.stringify(memory)}\n`, "utf8");
  } catch (error) {
    console.error("supervisor-today-cache-write", error);
  }
}
