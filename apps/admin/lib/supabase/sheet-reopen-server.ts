/**
 * Reabrir la hoja de hoy en la nube (supervisor / admin). Ver `lib/sheet-reopen.ts`.
 *
 * Con CIE-: marca `REABIERTA@<ruta>` (M arrastra a T solo si T sigue cerrada).
 * Sin CIE- (M cerró, T abierta): solo reabre visitas M (no hay marca CIE-).
 * Nada se borra. El resto de planillas del cobrador siguen cerradas.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { sameRoute } from "@/lib/client-route-order";
import { DAY_CLOSE_SKIP_REASON } from "@/lib/collector-dispatch-sync";
import { dayCloseRef } from "@/lib/collector-day-close";
import {
  isPlanillaCashChainPrimary,
  PLANILLA_CASH_CHAIN_PRIMARY,
} from "@/lib/planilla-cash-chain";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  dayCloseReopensFromRow,
  encodeSheetReopenRef,
  routeSheetClosedForReopen,
  routesToReopen,
  secondarySheetClosedToday,
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

async function reopenAssignmentsForRoutes(
  client: NonNullable<ReturnType<typeof createMirrorServerClient>>,
  collectorRef: string,
  date: string,
  routes: string[],
  stamp: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
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
  if (skipError) return { ok: false, error: skipError.message };
  const { error: sealError } = await client
    .from("daily_assignments")
    .update({ day_closed_at: null, updated_at: stamp })
    .eq("collector_ref", collectorRef)
    .eq("dispatch_date", date)
    .in("client_route", routes)
    .not("day_closed_at", "is", null);
  if (sealError) return { ok: false, error: sealError.message };
  return { ok: true, count: (skipped ?? []).length };
}

export async function reopenSheetInCloud(
  input: ReopenSheetRequest,
  now = new Date(),
): Promise<ReopenSheetResult> {
  const client = createMirrorServerClient();
  if (!client) return { ok: false, error: "Nube sin configurar.", status: 503 };
  const collectorRef = String(input.collectorRef || "").trim();
  const route = String(input.route || "").trim().toUpperCase();
  const by = String(input.by || "").trim() || "supervisor";
  const date = businessTodayIso(now);
  const stamp = new Date().toISOString();

  const { data: cie, error: readError } = await client
    .from("day_closes")
    .select("*")
    .eq("ref", dayCloseRef(collectorRef, date))
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message, status: 500 };
  const row = (cie ?? null) as Record<string, unknown> | null;

  // M cerró y T aún no: no hay CIE-; reabrir solo visitas M.
  if (!row && isPlanillaCashChainPrimary(route)) {
    const { data: mRows, error: mErr } = await client
      .from("daily_assignments")
      .select("item_id, day_closed_at, visit_status, payment_ref")
      .eq("collector_ref", collectorRef)
      .eq("dispatch_date", date)
      .eq("client_route", PLANILLA_CASH_CHAIN_PRIMARY);
    if (mErr) return { ok: false, error: mErr.message, status: 500 };
    // Cobrado sin day_closed_at (sello a medias) no bloquea: la hoja ya no tiene pendientes.
    if (!routeSheetClosedForReopen(mRows ?? [])) {
      return { ok: false, error: "La hoja M de hoy no está cerrada.", status: 409 };
    }
    const opened = await reopenAssignmentsForRoutes(
      client,
      collectorRef,
      date,
      [PLANILLA_CASH_CHAIN_PRIMARY],
      stamp,
    );
    if (!opened.ok) return { ok: false, error: opened.error, status: 500 };
    const at = now.toISOString();
    return {
      ok: true,
      reopens: [
        {
          route: PLANILLA_CASH_CHAIN_PRIMARY,
          at,
          by,
          closeRef: "",
          collectorRef,
          date,
        },
      ],
      reopenedVisits: opened.count,
    };
  }

  if (!row) return { ok: false, error: "Hoy no hay cierre de jornada de ese cobrador.", status: 409 };

  const live = dayCloseReopensFromRow(row);
  const record = rowToDayClose(row);
  const gate = sheetReopenWindow(collectorRef, route, record ? [record] : [], live, now);
  if (!gate.open) return { ok: false, error: gate.reason, status: 409 };

  const reopenSecondary = secondarySheetClosedToday(
    collectorRef,
    record ? [record] : [],
    live,
    now,
  );
  const routes = routesToReopen(route, { reopenSecondary }).filter(
    (target) => !live.some((reopen) => sameRoute(reopen.route, target)),
  );
  if (!routes.length) {
    return { ok: false, error: `La hoja ${route} ya está reabierta.`, status: 409 };
  }

  const closedMs = Date.parse(String(row.closed_at || ""));
  const at = new Date(
    Math.max(now.getTime(), Number.isFinite(closedMs) ? closedMs + 1 : 0),
  ).toISOString();
  const refs = Array.isArray(row.movement_refs) ? (row.movement_refs as string[]) : [];
  const markers = routes.map((target) => encodeSheetReopenRef({ route: target, at, by }));
  const { error: markError } = await client
    .from("day_closes")
    .update({ movement_refs: [...refs, ...markers], updated_at: stamp })
    .eq("ref", String(row.ref));
  if (markError) return { ok: false, error: markError.message, status: 500 };

  const opened = await reopenAssignmentsForRoutes(client, collectorRef, date, routes, stamp);
  if (!opened.ok) return { ok: false, error: opened.error, status: 500 };

  const closeRef = String(row.ref);
  return {
    ok: true,
    reopens: [
      ...live,
      ...routes.map((target) => ({ route: target, at, by, closeRef, collectorRef, date })),
    ],
    reopenedVisits: opened.count,
  };
}
