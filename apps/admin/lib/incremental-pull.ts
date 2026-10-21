/**
 * Una copia en el aparato. Lo nuevo entra con `?since=` (corte del servidor).
 * El corte se guarda: cerrar y volver a abrir no vuelve a bajar la planilla ni los cobros.
 * Completa solo la primera vez (aparato vacío) o al reparar. Si la bajada falla, la
 * próxima es completa: una parcial a medias no cuenta como copia.
 */
import { businessDaysAgoIso } from "@/lib/business-timezone";

const CURSOR_PREFIX = "nexo-pull-cursor:";

export type IncrementalPullOutcome = {
  ok: boolean;
  full: boolean;
  cursor?: string | null;
};

export type IncrementalPull = {
  hasCursor(): boolean;
  /** `null` = toca bajada completa. */
  sinceFor(forceFull: boolean): string | null;
  settle(outcome: IncrementalPullOutcome, startedAt: number): void;
};

function readCursor(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CURSOR_PREFIX + storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cursor?: unknown };
    return typeof parsed.cursor === "string" && parsed.cursor ? parsed.cursor : null;
  } catch {
    return null;
  }
}

function writeCursor(storageKey: string, cursor: string | null) {
  if (typeof window === "undefined") return;
  try {
    const id = CURSOR_PREFIX + storageKey;
    if (!cursor) window.localStorage.removeItem(id);
    else window.localStorage.setItem(id, JSON.stringify({ cursor }));
  } catch {
    /* esta pestaña sigue con el corte en memoria */
  }
}

/**
 * Medianoche de anteayer en Bogotá, en hora de servidor.
 * Sirve una sola vez: el aparato ya tiene la copia y todavía no guardó el corte.
 * Cubre el cierre de anoche sin volver a pedir el archivo entero.
 */
export function resumeSinceIso(now = new Date()): string {
  const day = businessDaysAgoIso(2, now);
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, date || 1, 5, 0, 0)).toISOString();
}

export function createIncrementalPull(storageKey: string): IncrementalPull {
  let cursor: string | null = readCursor(storageKey);
  return {
    hasCursor() {
      return Boolean(cursor);
    },
    sinceFor(forceFull) {
      if (forceFull) return null;
      return cursor;
    },
    settle(outcome) {
      if (!outcome.ok || !outcome.cursor) {
        cursor = null;
        writeCursor(storageKey, null);
        return;
      }
      cursor = outcome.cursor;
      writeCursor(storageKey, cursor);
    },
  };
}

/** `?since=` para una ruta GET. */
export function withSinceParam(path: string, since: string | null): string {
  if (!since) return path;
  return `${path}${path.includes("?") ? "&" : "?"}since=${encodeURIComponent(since)}`;
}
