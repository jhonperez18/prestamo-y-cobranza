import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `?since=` repasa este margen hacia atrás: una transacción que se confirmó después de
 * leer, con hora anterior al corte, igual entra (el merge del aparato es idempotente).
 */
export const CHANGED_SINCE_OVERLAP_MS = 2 * 60_000;

const CHANGED_SINCE_PAGE = 1000;

/** `?since=` del aparato → hora desde la que se busca (con margen). `null` = bajada completa. */
export function readChangedSince(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get("since");
  const ms = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - CHANGED_SINCE_OVERLAP_MS).toISOString();
}

/**
 * Corte que el aparato devuelve como `since` en la próxima bajada. Hora del servidor
 * tomada **antes** de leer: no depende del reloj del celular ni de lo que mande.
 */
export function changedSinceCursor(now = new Date()): string {
  return now.toISOString();
}

/**
 * Filas tocadas desde `sinceIso`: `updated_at` (la base lo pone en cada UPDATE) o
 * `created_at` (la base lo pone al crear). El alta trae el `updated_at` del aparato, que
 * puede ser viejo (subió tarde o reloj atrasado); `created_at` la atrapa igual.
 */
export function changedSinceFilter(sinceIso: string): string {
  return `updated_at.gte."${sinceIso}",created_at.gte."${sinceIso}"`;
}

/**
 * Bajada completa de una tabla. La base corta cada consulta en 1.000 filas (`max-rows`):
 * un `.limit(5000)` devuelve 1.000 en silencio. Por eso va por páginas, en orden de alta:
 * lo que se crea mientras se pagina cae al final y entra en la última página.
 */
export async function fetchAllRows<Row extends object>(
  client: SupabaseClient,
  table: string,
  select: string,
  window?: { column: string; since: string; until?: string },
): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string; rows: Row[] }> {
  const rows: Row[] = [];
  const seen = new Set<unknown>();
  for (let from = 0; ; from += CHANGED_SINCE_PAGE) {
    let query = client
      .from(table)
      .select(select)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (window) {
      query = query.gte(window.column, window.since);
      if (window.until) query = query.lte(window.column, window.until);
    }
    const { data, error } = await query.range(from, from + CHANGED_SINCE_PAGE - 1);
    if (error) return { ok: false, error: error.message, rows: [] };
    const page = (data ?? []) as unknown as Row[];
    for (const row of page) {
      const id = (row as { id?: unknown }).id;
      if (id != null && seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
    }
    if (page.length < CHANGED_SINCE_PAGE) return { ok: true, rows };
  }
}

export async function fetchRowsChangedSince<Row>(
  client: SupabaseClient,
  table: string,
  select: string,
  sinceIso: string,
  window?: { column: string; since: string },
): Promise<{ ok: true; rows: Row[] } | { ok: false; error: string; rows: Row[] }> {
  const rows: Row[] = [];
  let from = 0;
  for (;;) {
    let query = client.from(table).select(select).or(changedSinceFilter(sinceIso));
    if (window) query = query.gte(window.column, window.since);
    const { data, error } = await query
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + CHANGED_SINCE_PAGE - 1);
    if (error) return { ok: false, error: error.message, rows: [] };
    const page = (data ?? []) as Row[];
    if (!page.length) break;
    rows.push(...page);
    if (page.length < CHANGED_SINCE_PAGE) break;
    from += CHANGED_SINCE_PAGE;
  }
  return { ok: true, rows };
}
