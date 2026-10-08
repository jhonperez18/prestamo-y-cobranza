/**
 * Reabrir la hoja de hoy en la nube (supervisor / admin). Ver `lib/sheet-reopen.ts`.
 *
 * 1. Marca `REABIERTA@<ruta>` en el CIE- de hoy (hora del servidor, nunca antes del cierre).
 * 2. Visitas de esa planilla: «Cierre de jornada» → pendiente; cobros y N/P quedan, sin sello.
 * Nada se borra. M, A y el resto de planillas del cobrador siguen cerradas.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { DAY_CLOSE_SKIP_REASON } from "@/lib/collector-dispatch-sync";
import { dayCloseRef } from "@/lib/collector-day-close";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  dayCloseReopenFromRow,
  encodeSheetReopenRef,
  sheetReopenWindow,
  type DayCloseReopen,
} from "@/lib/sheet-reopen";
import { rowToDayClose } from "@/lib/supabase/ops-mirror";

export type ReopenSheetRequest = {
  collectorRef: string;
  route: string;
  by: string;
};

export type ReopenSheetResult =
  | { ok: true; reopen: DayCloseReopen; reopenedVisits: number }
  | { ok: false; error: string; status: number };

export async function reopenSheetInCloud(
  input: ReopenSheetRequest,
  now = new Date(),
): Promise<ReopenSheetResult> {
  const client = createMirrorServerClient();
  if (!client) return { ok: false, error: "Nube sin configurar.", status: 503 };
  const collectorRef = String(input.collectorRef || "").trim();
  const route = String(input.route || "").trim().toUpperCase();
  const by = String(input.by || "").trim() || "supervisor";

  const { data: cie, error: readError } = await client
    .from("day_closes")
    .select("*")
    .eq("ref", dayCloseRef(collectorRef, businessTodayIso(now)))
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message, status: 500 };
  const row = (cie ?? null) as Record<string, unknown> | null;

  const already = row ? dayCloseReopenFromRow(row) : null;
  if (already && already.route === route) {
    return { ok: true, reopen: already, reopenedVisits: 0 };
  }
  const record = row ? rowToDayClose(row) : null;
  const gate = sheetReopenWindow(collectorRef, route, record ? [record] : [], now);
  if (!gate.open || !row) {
    return { ok: false, error: gate.open ? "Hoy no hay cierre de jornada." : gate.reason, status: 409 };
  }

  const closedMs = Date.parse(String(row.closed_at || ""));
  const at = new Date(
    Math.max(now.getTime(), Number.isFinite(closedMs) ? closedMs + 1 : 0),
  ).toISOString();
  const refs = Array.isArray(row.movement_refs) ? (row.movement_refs as string[]) : [];
  const marker = encodeSheetReopenRef({ route, at, by });
  const stamp = new Date().toISOString();
  const { error: markError } = await client
    .from("day_closes")
    .update({ movement_refs: [...refs, marker], updated_at: stamp })
    .eq("ref", String(row.ref));
  if (markError) return { ok: false, error: markError.message, status: 500 };

  const date = gate.date;
  const { data: skipped, error: skipError } = await client
    .from("daily_assignments")
    .update({ visit_status: "pendiente", skip_reason: null, day_closed_at: null, updated_at: stamp })
    .eq("collector_ref", collectorRef)
    .eq("dispatch_date", date)
    .eq("client_route", route)
    .eq("visit_status", "omitido")
    .eq("skip_reason", DAY_CLOSE_SKIP_REASON)
    .is("payment_ref", null)
    .select("item_id");
  if (skipError) return { ok: false, error: skipError.message, status: 500 };
  const { error: sealError } = await client
    .from("daily_assignments")
    .update({ day_closed_at: null, updated_at: stamp })
    .eq("collector_ref", collectorRef)
    .eq("dispatch_date", date)
    .eq("client_route", route)
    .not("day_closed_at", "is", null);
  if (sealError) return { ok: false, error: sealError.message, status: 500 };

  return {
    ok: true,
    reopen: { route, at, by, closeRef: String(row.ref), collectorRef, date },
    reopenedVisits: (skipped ?? []).length,
  };
}