/**
 * Bajada completa al abrir, cada 60 min, al reparar y en la puesta a punto del día;
 * entre medio solo lo que cambió (`?since=` con el corte que devolvió el servidor).
 * La completa pesa ~5,6 MB por aparato (planilla de 16 días ≈ 3,5 MB): cada 10 min trababa
 * el celular y agotaba la transferencia de Vercel. Lo nuevo llega igual por la parcial.
 */
export const FULL_PULL_EVERY_MS = 60 * 60_000;

export type IncrementalPullOutcome = {
  ok: boolean;
  full: boolean;
  cursor?: string | null;
};

export type IncrementalPull = {
  /** `null` = toca bajada completa. */
  sinceFor(forceFull: boolean, now?: number): string | null;
  settle(outcome: IncrementalPullOutcome, startedAt: number): void;
};

export function createIncrementalPull(everyMs = FULL_PULL_EVERY_MS): IncrementalPull {
  let cursor: string | null = null;
  let lastFullAt = 0;
  return {
    sinceFor(forceFull, now = Date.now()) {
      if (forceFull || !cursor || now - lastFullAt >= everyMs) return null;
      return cursor;
    },
    settle(outcome, startedAt) {
      // Lo que no entró al aparato no vuelve en una bajada parcial: la próxima es completa.
      if (!outcome.ok || !outcome.cursor) {
        cursor = null;
        return;
      }
      if (outcome.full) lastFullAt = startedAt;
      cursor = outcome.cursor;
    },
  };
}

/** `?since=` para una ruta GET. */
export function withSinceParam(path: string, since: string | null): string {
  if (!since) return path;
  return `${path}${path.includes("?") ? "&" : "?"}since=${encodeURIComponent(since)}`;
}
