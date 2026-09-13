import { NextResponse } from "next/server";
import {
  assignmentToRow,
  collectorToRow,
  dayCloseToRow,
  dayExpenseToRow,
  fetchOpsTable,
  miscToRow,
  routeToRow,
  upsertOpsRow,
} from "@/lib/supabase/ops-mirror";
import type { CollectorRow, RouteRow } from "@/lib/mock-data";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { MiscPayment } from "@/lib/misc-payments";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

export async function GET() {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return NextResponse.json({ ok: true, skipped: true, reason: "supabase_not_configured" });
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
        return NextResponse.json(
          { ok: false, error: "error" in part ? part.error : "fetch_failed" },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
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
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
