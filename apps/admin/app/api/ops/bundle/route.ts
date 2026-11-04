import { collapseTodayOpenVisits, dropOpenCuotasNotDue, fetchOpsTable, fetchOpsTableSince } from "@/lib/supabase/ops-mirror";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  changedSinceCursor,
  fetchRowsChangedSince,
  readChangedSince,
} from "@/lib/supabase/changed-since";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { jsonNoStore } from "@/lib/api-no-store";
import { businessDaysAgoIso, businessTodayIso } from "@/lib/business-timezone";
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
            // Catálogo chico: la lista entera. Un cobrador borrado no viaja en
            // `since` y el aparato lo seguiría mostrando.
            fetchOpsTable("collectors"),
            changed("routes"),
            // CIE solo cambios: el sello nuevo lleva `updated_at` fresco.
            // Completa cada hora (poll FULL) + hoja de hoy entera abajo cubren
            // huecos; no reenviar toda la tabla en cada sync.
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
    const [collectors, routes, dayClosesPart, day_expenses, misc_payments, assignmentsPart] = parts;
    // Inicial M = CIE de ayer: con `since` los cambios no rellenan un CIE que el
    // aparato nunca tuvo. Siempre anexar ayer+hoy (tabla chica).
    let dayCloseRows = dayClosesPart.rows;
    if (since) {
      const closesFrom = businessDaysAgoIso(1);
      const closesTo = businessTodayIso();
      const closesWindow = await fetchOpsTableSince(
        "day_closes",
        "close_date",
        closesFrom,
        closesTo,
      );
      if (!closesWindow.ok) {
        return jsonNoStore(
          { ok: false, error: "error" in closesWindow ? closesWindow.error : "fetch_failed" },
          { status: 502 },
        );
      }
      const byRef = new Map<string, Record<string, unknown>>();
      for (const row of dayCloseRows) {
        const ref = String(row.ref || "");
        byRef.set(ref || `chg-${byRef.size}`, row);
      }
      for (const row of closesWindow.rows) {
        const ref = String(row.ref || "");
        byRef.set(ref || `win-${byRef.size}`, row);
      }
      dayCloseRows = [...byRef.values()];
    }
    const day_closes = { ...dayClosesPart, rows: dayCloseRows };
    // Hoja de hoy entera solo si hubo cambios de planilla (o bajada completa).
    // Sin cambios: el sello llega en `changed` (updated_at) o en la completa horaria.
    // Evita reenviar toda la ruta en cada poll quieto.
    let assignmentRows = assignmentsPart.rows;
    let assignmentsTodayComplete = false;
    if (since && assignmentsPart.rows.length > 0) {
      const todaySheet = await fetchOpsTableSince(
        "daily_assignments",
        "dispatch_date",
        businessTodayIso(),
        businessTodayIso(),
      );
      if (!todaySheet.ok) {
        return jsonNoStore(
          { ok: false, error: "error" in todaySheet ? todaySheet.error : "fetch_failed" },
          { status: 502 },
        );
      }
      const byId = new Map<string, Record<string, unknown>>();
      for (const row of assignmentRows) {
        const id = String(row.id || "");
        byId.set(id || `changed-${byId.size}`, row);
      }
      for (const row of todaySheet.rows) {
        const id = String(row.id || "");
        byId.set(id || `today-${byId.size}`, row);
      }
      assignmentRows = [...byId.values()];
      assignmentsTodayComplete = true;
    }
    const daily_assignments = since
      ? { ...assignmentsPart, rows: await dropOpenCuotasNotDue(assignmentRows) }
      : {
          ...assignmentsPart,
          rows: await dropOpenCuotasNotDue(await collapseTodayOpenVisits(assignmentsPart.rows)),
        };

    return jsonNoStore({
      ok: true,
      incremental: Boolean(since),
      cursor,
      collectorsComplete: true,
      assignmentsTodayComplete,
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
