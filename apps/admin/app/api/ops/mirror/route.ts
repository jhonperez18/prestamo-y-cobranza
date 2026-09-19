import { NextResponse } from "next/server";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  assignmentToRow,
  collectorToRow,
  dayCloseToRow,
  dayExpenseToRow,
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
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";

type Body = {
  kind?: string;
  row?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const kind = body.kind;
    if (!kind || !body.row) {
      return NextResponse.json({ ok: false, error: "missing_kind_or_row" }, { status: 400 });
    }

    // Candado virgen: no dejar que un celular viejo rellene CIE/gastos/planilla.
    // route_delete SÍ se permite (Eliminar debe borrar de verdad).
    if (
      isVirginWriteLocked() &&
      (kind === "day_close" ||
        kind === "day_expense" ||
        kind === "misc_payment" ||
        kind === "assignment" ||
        kind === "route")
    ) {
      return NextResponse.json(virginWriteLockPayload());
    }

    let result: Awaited<ReturnType<typeof upsertOpsRow>>;

    switch (kind) {
      case "collector": {
        const mapped = collectorToRow(body.row as CollectorRow);
        result = await upsertOpsRow("collectors", mapped, "ref");
        break;
      }
      case "route": {
        const mapped = routeToRow(body.row as RouteRow);
        result = await upsertOpsRow("routes", mapped, "ref");
        break;
      }
      case "route_delete": {
        const ref = String((body.row as { ref?: string })?.ref || "").trim();
        if (!ref) {
          return NextResponse.json({ ok: false, error: "missing_ref" }, { status: 400 });
        }
        const client = createMirrorServerClient();
        if (!client) {
          return NextResponse.json({ ok: true, skipped: true, reason: "supabase_not_configured" });
        }
        const { error } = await client.from("routes").delete().eq("ref", ref);
        if (error) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
        }
        return NextResponse.json({ ok: true, deleted: ref });
      }
      case "collector_delete": {
        const ref = String((body.row as { ref?: string })?.ref || "").trim();
        if (!ref) {
          return NextResponse.json({ ok: false, error: "missing_ref" }, { status: 400 });
        }
        const client = createMirrorServerClient();
        if (!client) {
          return NextResponse.json({ ok: true, skipped: true, reason: "supabase_not_configured" });
        }
        const { error } = await client.from("collectors").delete().eq("ref", ref);
        if (error) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
        }
        return NextResponse.json({ ok: true, deleted: ref });
      }
      case "day_close": {
        const mapped = dayCloseToRow(body.row as CollectorDayCloseRecord);
        result = await upsertOpsRow("day_closes", mapped, "ref");
        break;
      }
      case "day_expense": {
        const mapped = dayExpenseToRow(body.row as CollectorDayExpenseDraft);
        result = await upsertOpsRow("day_expenses", mapped, "ref");
        break;
      }
      case "misc_payment": {
        const mapped = miscToRow(body.row as MiscPayment);
        result = await upsertOpsRow("misc_payments", mapped, "ref");
        break;
      }
      case "assignment": {
        const raw = body.row as DailyCollectionAssignment & { ref?: string };
        const mapped = assignmentToRow(raw);
        result = await upsertOpsRow("daily_assignments", mapped, "dispatch_date,item_id");
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: "unknown_kind" }, { status: 400 });
    }

    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
