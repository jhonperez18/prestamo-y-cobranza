/**
 * Orden seal_day_close en la base (Fase 4.1).
 * cash_float lo fija la RPC (day_cash_figure / route_own_box), no el aparato.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type SealDayCloseInput = {
  collectorRef: string;
  date: string;
  route?: string;
  key: string;
  by: string;
  writeCie: boolean;
  routeRef?: string;
  collectorName?: string;
  collected?: number;
  expenses?: unknown[];
  expensesTotal?: number;
  movementRefs?: string[];
};

export type SealDayCloseResult =
  | {
      ok: true;
      cie: boolean;
      idempotent?: boolean;
      ref?: string;
      cashFloat?: number;
      closedAt?: string;
      sealedAssignments: number;
      route?: string | null;
    }
  | { ok: false; error: string; missingDay?: string; cashFloat?: number; ref?: string };

export async function callSealDayClose(input: SealDayCloseInput): Promise<SealDayCloseResult> {
  const ref = input.collectorRef.trim();
  const key = input.key.trim();
  if (!ref || !key || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: "dato_invalido" };
  }
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false, error: "sin_servicio" };

  const { data, error } = await client.rpc("seal_day_close", {
    p_collector_ref: ref,
    p_date: input.date,
    p_route: (input.route || "").trim().toUpperCase(),
    p_key: key,
    p_by: input.by.trim(),
    p_write_cie: Boolean(input.writeCie),
    p_route_ref: input.routeRef || "",
    p_collector_name: input.collectorName || "",
    p_collected: input.collected ?? null,
    p_expenses: input.expenses ?? null,
    p_expenses_total: input.expensesTotal ?? null,
    p_movement_refs: input.movementRefs ?? null,
  });
  if (error) return { ok: false, error: error.message };

  const body = data as {
    ok?: boolean;
    cie?: boolean;
    idempotent?: boolean;
    ref?: string;
    cash_float?: number;
    closed_at?: string;
    sealed_assignments?: number;
    route?: string | null;
    error?: string;
    missing_day?: string;
  } | null;

  if (!body || body.ok !== true) {
    return {
      ok: false,
      error: body?.error || "seal_failed",
      missingDay: body?.missing_day,
      cashFloat: body?.cash_float == null ? undefined : Math.trunc(Number(body.cash_float)),
      ref: body?.ref,
    };
  }

  return {
    ok: true,
    cie: Boolean(body.cie || body.idempotent),
    idempotent: body.idempotent,
    ref: body.ref,
    cashFloat:
      body.cash_float == null || !Number.isFinite(Number(body.cash_float))
        ? undefined
        : Math.trunc(Number(body.cash_float)),
    closedAt: body.closed_at,
    sealedAssignments: Math.trunc(Number(body.sealed_assignments) || 0),
    route: body.route ?? null,
  };
}
