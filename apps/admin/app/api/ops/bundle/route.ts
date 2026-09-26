import {
  fetchOpsTable,
} from "@/lib/supabase/ops-mirror";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { jsonNoStore } from "@/lib/api-no-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Bundle ops (CIE, planilla, rutas): lectura viva desde Supabase, sin caché. */
export async function GET() {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return jsonNoStore({ ok: true, skipped: true, reason: "supabase_not_configured" });
  }
  try {
    const [collectors, routes, day_closes, day_expenses, misc_payments, daily_assignments] =
      await Promise.all([
        fetchOpsTable("collectors"),
        fetchOpsTable("routes"),
        fetchOpsTable("day_closes"),
        fetchOpsTable("day_expenses"),
        fetchOpsTable("misc_payments"),
        fetchOpsTable("daily_assignments"),
      ]);

    for (const part of [
      collectors,
      routes,
      day_closes,
      day_expenses,
      misc_payments,
      daily_assignments,
    ]) {
      if (!part.ok) {
        return jsonNoStore(
          { ok: false, error: "error" in part ? part.error : "fetch_failed" },
          { status: 502 },
        );
      }
    }

    return jsonNoStore({
      ok: true,
      collectors: collectors.rows,
      routes: routes.rows,
      day_closes: day_closes.rows,
      day_expenses: day_expenses.rows,
      misc_payments: misc_payments.rows,
      daily_assignments: daily_assignments.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
