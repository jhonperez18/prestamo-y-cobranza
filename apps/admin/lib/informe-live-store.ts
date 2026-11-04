/**
 * Último Informe vivo (Cobrado / Préstamo / Gasto) en disco.
 * El supervisor no puede esperar 20 s a Supabase cada vez que abre Informe.
 */
import { promises as fs } from "fs";
import path from "path";
import type { InformeHistory, InformeRouteHistory } from "@/lib/informe-route-days";

export type InformeLiveSnap = {
  from: string;
  to: string;
  general: InformeHistory;
  angelica: InformeRouteHistory;
  at: string;
};

const FILE = path.join(process.cwd(), "data", "informe-live.json");
let memory: InformeLiveSnap | null = null;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const row = JSON.parse(raw) as InformeLiveSnap;
    if (
      row &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(row.from || "")) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(row.to || "")) &&
      row.general &&
      row.angelica
    ) {
      memory = {
        from: String(row.from).slice(0, 10),
        to: String(row.to).slice(0, 10),
        general: row.general,
        angelica: row.angelica,
        at: String(row.at || ""),
      };
    }
  } catch {
    /* sin archivo */
  }
}

export async function readInformeLive(
  from: string,
  to: string,
): Promise<InformeLiveSnap | null> {
  await ensureLoaded();
  if (!memory) return null;
  if (memory.from === from && memory.to === to) return memory;
  // Mismo mes y rango cubierto: sirve de puente mientras la base refresca.
  // Si el sello termina antes de `to` (falta hoy), igual se puede pintar — el
  // loader marca stale y recalcula; no inventar días que el sello no trae.
  if (memory.from === from && memory.to <= to && memory.to.slice(0, 7) === to.slice(0, 7)) {
    return memory;
  }
  return null;
}

/** Invalida el sello en memoria (p. ej. tras un fresh forzado). */
export function clearInformeLiveMemory() {
  memory = null;
  loaded = true;
}

export async function writeInformeLive(snap: Omit<InformeLiveSnap, "at">): Promise<void> {
  memory = { ...snap, at: new Date().toISOString() };
  loaded = true;
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, `${JSON.stringify(memory)}\n`, "utf8");
  } catch (error) {
    console.error("informe-live-write", error);
  }
}
