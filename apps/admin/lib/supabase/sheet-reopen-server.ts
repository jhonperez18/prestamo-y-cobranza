/**
 * Reabrir la hoja de hoy en la nube (supervisor / admin). Ver `lib/sheet-reopen.ts`.
 *
 * 1. Marca `REABIERTA@<ruta>` en el CIE- de hoy (hora del servidor, nunca antes del cierre).
 *    M arrastra a T (el saldo final de M es el Inicial de T).
 * 2. Visitas de esas planillas: «Cierre de jornada» → pendiente; cobros y N/P quedan, sin sello.
 * Nada se borra. El resto de planillas del cobrador siguen cerradas.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { sameRoute } from "@/lib/client-route-order";
import { DAY_CLOSE_SKIP_REASON } from "@/lib/collector-dispatch-sync";
import { dayCloseRef } from "@/lib/collector-day-close";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  dayCloseReopensFromRow,
  encodeSheetReopenRef,
  routesToReopen,
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
  | { ok: true; reopens: DayCloseReopen[]; reopenedVisits: number }
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
  if (!row) return { ok: false, error: "Hoy no hay cierre de jornada de ese cobrador.", status: 409 };

  const live = dayCloseReopensFromRow(row);
  const record = rowToDayClose(row);
  const gate = sheetReopenWindow(collectorRef, route, record ? [record] : [], live, now);
  if (!gate.open) return { ok: false, error: gate.reason, status: 409 };

  const routes = routesToReopen(route).filter(
    (target) => !live.some((reopen) => sameRoute(reopen.route, target)),
  );
  const closedMs = Date.parse(String(row.closed_at || ""));
  const at = new Date(
    Math.max(now.getTime(), Number.isFinite(closedMs) ? closedMs + 1 : 0),
  ).toISOString();
  const refs = Array.isArray(row.movement_refs) ? (row.movement_refs as string[]) : [];
  const markers = routes.map((target) => encodeSheetReopenRef({ route: target, at, by }));
  const stamp = new Date().toISOString();
  const { error: markError } = await client
    .from("day_closes")
    .update({ movement_refs: [...refs, ...markers], updated_at: stamp })
    .eq("ref", String(row.ref));
  if (markError) return { ok: false, error: markError.message, status: 500 };

  const date = gate.date;
  const { data: skipped, error: skipError } = await client
    .from("daily_assignments")
    .update({ visit_status: "pendiente", skip_reason: null, day_closed_at: null, updated_at: stamp })
    .eq("collector_ref", collectorRef)
    .eq("dispatch_date", date)
    .in("client_route", routes)
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
    .in("client_route", routes)
    .not("day_closed_at", "is", null);
  if (sealError) return { ok: false, error: sealError.message, status: 500 };

  const closeRef = String(row.ref);
  return {
    ok: true,
    reopens: [
      ...live,
      ...routes.map((target) => ({ route: target, at, by, closeRef, collectorRef, date })),
    ],
    reopenedVisits: (skipped ?? []).length,
  };
}
