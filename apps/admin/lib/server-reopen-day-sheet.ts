/**
 * Orden reopen_day_sheet en la base (Fase 4.4).
 * Marca REABIERTA@ + suelta day_closed_at de la planilla. Nada se borra.
 */
import type { DayCloseReopen } from "@/lib/sheet-reopen";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ReopenDaySheetInput = {
  collectorRef: string;
  route: string;
  by: string;
  key?: string;
};

export type ReopenDaySheetResult =
  | {
      ok: true;
      reopens: DayCloseReopen[];
      reopenedVisits: number;
      routes: string[];
      ref: string;
      date: string;
      idempotent?: boolean;
    }
  | { ok: false; error: string };

function asReopen(row: unknown): DayCloseReopen | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const route = String(r.route || "").trim().toUpperCase();
  const at = String(r.at || "").trim();
  const by = String(r.by || "").trim();
  const collectorRef = String(r.collectorRef || r.collector_ref || "").trim();
  const date = String(r.date || "").trim();
  if (!route || !at || !collectorRef || !date) return null;
  return {
    route,
    at,
    by,
    closeRef: String(r.closeRef || r.close_ref || "").trim(),
    collectorRef,
    date,
  };
}

export async function callReopenDaySheet(
  input: ReopenDaySheetInput,
): Promise<ReopenDaySheetResult> {
  const collectorRef = input.collectorRef.trim();
  const route = input.route.trim().toUpperCase();
  const by = input.by.trim();
  if (!collectorRef || !route || !by) {
    return { ok: false, error: "dato_invalido" };
  }
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };

  const { data, error } = await client.rpc("reopen_day_sheet", {
    p_collector_ref: collectorRef,
    p_route: route,
    p_by: by,
    p_key: input.key?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  const body = data as {
    ok?: boolean;
    error?: string;
    idempotent?: boolean;
    ref?: string;
    date?: string;
    routes?: string[];
    reopened_visits?: number;
    reopens?: unknown[];
  } | null;

  if (!body || body.ok !== true) {
    return { ok: false, error: body?.error || "reopen_failed" };
  }

  const reopens = (Array.isArray(body.reopens) ? body.reopens : [])
    .map(asReopen)
    .filter((row): row is DayCloseReopen => Boolean(row));

  return {
    ok: true,
    reopens,
    reopenedVisits: Math.trunc(Number(body.reopened_visits) || 0),
    routes: Array.isArray(body.routes)
      ? body.routes.map((r) => String(r).toUpperCase())
      : reopens.map((r) => r.route),
    ref: String(body.ref || ""),
    date: String(body.date || ""),
    idempotent: body.idempotent,
  };
}
