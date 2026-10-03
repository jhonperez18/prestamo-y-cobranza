import { fetchOpsTable, fetchOpsTableChangedSince, fetchOpsTableSince } from "@/lib/supabase/ops-mirror";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { jsonNoStore } from "@/lib/api-no-store";
import { businessDaysAgoIso } from "@/lib/business-timezone";
import { planillaWindowStartIso } from "@/lib/planilla-window";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Ventana operativa: planilla reciente (`planilla-window`). CIE se trae completo (tabla chica). */
const EXPENSES_LOOKBACK_DAYS = 90;

/**
 * `?since=` repasa este margen hacia atrás: una fila que se confirmó tarde con un
 * `updated_at` anterior al cursor igual entra (el merge es idempotente).
 */
const CHANGED_SINCE_OVERLAP_MS = 2 * 60_000;

type OpsTablePart =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string; rows: Record<string, unknown>[] };

/** `cursor` = lo que mandó el aparato (sin cambios se le devuelve igual); `query` = con margen. */
function parseSince(request: Request): { cursor: string; query: string } | null {
  const raw = new URL(request.url).searchParams.get("since");
  const ms = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(ms)) return null;
  return {
    cursor: new Date(ms).toISOString(),
    query: new Date(ms - CHANGED_SINCE_OVERLAP_MS).toISOString(),
  };
}

/** Mayor `updated_at` bajado: el aparato lo devuelve como `since` en la próxima bajada. */
function latestUpdatedAt(parts: OpsTablePart[], fallback: string | null): string | null {
  let latest = fallback ? Date.parse(fallback) : 0;
  for (const part of parts) {
    for (const row of part.rows) {
      const ms = Date.parse(String(row.updated_at || ""));
      if (Number.isFinite(ms) && ms > latest) latest = ms;
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

/**
 * Bundle ops (CIE, planilla, rutas): lectura viva desde Supabase, sin caché.
 * Sin `since` = todo (ventana de planilla). Con `since` = solo lo que cambió.
 */
export async function GET(request: Request) {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return jsonNoStore({ ok: true, skipped: true, reason: "supabase_not_configured" });
  }
  try {
    const assignSince = planillaWindowStartIso();
    const expenseSince = businessDaysAgoIso(EXPENSES_LOOKBACK_DAYS);
    const since = parseSince(request);
    const changedSince = since?.query ?? "";

    const parts: OpsTablePart[] = await Promise.all(
      since
        ? [
            fetchOpsTableChangedSince("collectors", changedSince),
            fetchOpsTableChangedSince("routes", changedSince),
            fetchOpsTableChangedSince("day_closes", changedSince),
            fetchOpsTableChangedSince("day_expenses", changedSince, {
              column: "expense_date",
              since: expenseSince,
            }),
            fetchOpsTableChangedSince("misc_payments", changedSince),
            fetchOpsTableChangedSince("daily_assignments", changedSince, {
              column: "dispatch_date",
              since: assignSince,
            }),
          ]
        : [
            fetchOpsTable("collectors"),
            fetchOpsTable("routes"),
            // CIE completo: pocos registros; Inicial M necesita ayer sin huecos.
            fetchOpsTable("day_closes"),
            fetchOpsTableSince("day_expenses", "expense_date", expenseSince),
            fetchOpsTable("misc_payments"),
            fetchOpsTableSince("daily_assignments", "dispatch_date", assignSince),
          ],
    );

    for (const part of parts) {
      if (!part.ok) {
        return jsonNoStore(
          { ok: false, error: "error" in part ? part.error : "fetch_failed" },
          { status: 502 },
        );
      }
    }
    const [collectors, routes, day_closes, day_expenses, misc_payments, daily_assignments] = parts;

    return jsonNoStore({
      ok: true,
      incremental: Boolean(since),
      cursor: latestUpdatedAt(parts, since?.cursor ?? null),
      collectors: collectors.rows,
      routes: routes.rows,
      day_closes: day_closes.rows,
      day_expenses: day_expenses.rows,
      misc_payments: misc_payments.rows,
      daily_assignments: daily_assignments.rows,
      window: {
        assignmentsSince: assignSince,
        expensesSince: expenseSince,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
