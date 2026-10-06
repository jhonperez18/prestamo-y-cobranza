import { fetchOpsTable, fetchOpsTableSince } from "@/lib/supabase/ops-mirror";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  changedSinceCursor,
  fetchRowsChangedSince,
  readChangedSince,
} from "@/lib/supabase/changed-since";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { jsonNoStore } from "@/lib/api-no-store";
import { businessDaysAgoIso } from "@/lib/business-timezone";
import { planillaWindowStartIso } from "@/lib/planilla-window";
import { readIsoDateParam } from "@/lib/collector-live-window";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Ventana operativa: planilla reciente (`planilla-window`). CIE se trae completo (tabla chica). */
const EXPENSES_LOOKBACK_DAYS = 90;

type OpsTablePart =
  | { ok: true; rows: Record<string, unknown>[]; skipped?: boolean }
  | { ok: false; error: string; rows: Record<string, unknown>[] };

/**
 * Bundle ops (CIE, planilla, rutas): lectura viva desde Supabase, sin caché.
 * Sin `since` = todo (ventana de planilla). Con `since` = solo lo que cambió o se creó.
 */
export async function GET(request: Request) {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return jsonNoStore({ ok: true, skipped: true, reason: "supabase_not_configured" });
  }
  try {
    const cursor = changedSinceCursor();
    const liveFrom = readIsoDateParam(request, "fromDate");
    const liveTo = readIsoDateParam(request, "toDate");
    const assignSince = liveFrom ?? planillaWindowStartIso();
    const expenseSince = liveFrom ?? businessDaysAgoIso(EXPENSES_LOOKBACK_DAYS);
    const since = readChangedSince(request);
    const client = since ? createMirrorServerClient() : null;
    if (since && !client) {
      return jsonNoStore({ ok: true, skipped: true, reason: "service_role_missing" });
    }
    const changed = (table: string, window?: { column: string; since: string }) =>
      fetchRowsChangedSince<Record<string, unknown>>(client!, table, "*", since!, window);

    const parts: OpsTablePart[] = await Promise.all(
      since
        ? [
            changed("collectors"),
            changed("routes"),
            changed("day_closes"),
            changed("day_expenses", { column: "expense_date", since: expenseSince }),
            changed("misc_payments"),
            changed("daily_assignments", { column: "dispatch_date", since: assignSince }),
          ]
        : [
            fetchOpsTable("collectors"),
            fetchOpsTable("routes"),
            // CIE completo: pocos registros; Inicial M necesita ayer sin huecos.
            fetchOpsTable("day_closes"),
            fetchOpsTableSince("day_expenses", "expense_date", expenseSince, liveTo ?? undefined),
            fetchOpsTable("misc_payments"),
            fetchOpsTableSince(
              "daily_assignments",
              "dispatch_date",
              assignSince,
              liveTo ?? undefined,
            ),
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
      cursor,
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
