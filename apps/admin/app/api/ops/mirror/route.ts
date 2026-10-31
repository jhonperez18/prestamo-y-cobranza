import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  assignmentToRow,
  auditDayCloseInCloud,
  collectorToRow,
  dayCloseToRow,
  dayExpenseToRow,
  miscToRow,
  OPS_MIRROR_BATCH_MAX,
  routeToRow,
  sealRouteSheetInCloud,
  upsertAssignmentRow,
  upsertDayCloseIdempotent,
  upsertDayExpenseIdempotent,
  upsertOpsRow,
} from "@/lib/supabase/ops-mirror";
import type { CollectorRow, RouteRow } from "@/lib/mock-data";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { MiscPayment } from "@/lib/misc-payments";
import { businessTodayIso } from "@/lib/business-timezone";
import { isPlanillaCashCloseRef } from "@/lib/planilla-cash-chain";
import { callSealDayClose } from "@/lib/server-seal-day-close";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";
import { jsonNoStore } from "@/lib/api-no-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type MirrorItem = {
  kind?: string;
  row?: unknown;
};

type Body = MirrorItem & {
  /** `kind: "batch"`: varias filas en una sola petición, en orden, cada una con su candado. */
  items?: MirrorItem[];
};

type ItemOutcome = { status: number; json: Record<string, unknown> };

const VIRGIN_LOCKED_KINDS = new Set([
  "day_close",
  "day_expense",
  "misc_payment",
  "assignment",
  "route",
  "seal_route",
]);

async function deleteByRef(table: "routes" | "collectors", row: unknown): Promise<ItemOutcome> {
  const ref = String((row as { ref?: string })?.ref || "").trim();
  if (!ref) return { status: 400, json: { ok: false, error: "missing_ref" } };
  const client = createMirrorServerClient();
  if (!client) return { status: 200, json: { ok: true, skipped: true, reason: "supabase_not_configured" } };
  const { error } = await client.from(table).delete().eq("ref", ref);
  if (error) return { status: 502, json: { ok: false, error: error.message } };
  return { status: 200, json: { ok: true, deleted: ref } };
}

async function mirrorItem(item: MirrorItem): Promise<ItemOutcome> {
  const kind = item.kind;
  if (!kind || !item.row) return { status: 400, json: { ok: false, error: "missing_kind_or_row" } };

  // Candado virgen: no dejar que un celular viejo rellene CIE/gastos/planilla.
  // route_delete SÍ se permite (Eliminar debe borrar de verdad).
  if (isVirginWriteLocked() && VIRGIN_LOCKED_KINDS.has(kind)) {
    return { status: 200, json: virginWriteLockPayload() as Record<string, unknown> };
  }

  let result:
    | Awaited<ReturnType<typeof upsertOpsRow>>
    | Awaited<ReturnType<typeof upsertAssignmentRow>>
    | Awaited<ReturnType<typeof sealRouteSheetInCloud>>;

  switch (kind) {
    case "collector":
      result = await upsertOpsRow("collectors", collectorToRow(item.row as CollectorRow), "ref");
      break;
    case "route":
      result = await upsertOpsRow("routes", routeToRow(item.row as RouteRow), "ref");
      break;
    case "route_delete":
      return deleteByRef("routes", item.row);
    case "collector_delete":
      return deleteByRef("collectors", item.row);
    case "day_close": {
      const closeRow = item.row as CollectorDayCloseRecord;
      const closeRef = String(closeRow.ref || "");
      // Fase 4.2: CIE del aparato → seal_day_close (cash_float de la base). Sin bajar el archivo.
      if (closeRef.startsWith("CIE-") && !isPlanillaCashCloseRef(closeRef)) {
        const date = normalizeHistoryDate(closeRow.date) || closeRow.date;
        if (date !== businessTodayIso()) {
          result = { ok: true as const, skipped: true as const, reason: "cie_use_close_sheet" };
          break;
        }
        const sealed = await callSealDayClose({
          collectorRef: closeRow.collectorRef,
          date,
          route: "",
          key: `mirror|${closeRef}`,
          by: closeRow.collectorName || "mirror",
          writeCie: true,
          routeRef: closeRow.routeRef,
          collectorName: closeRow.collectorName,
          collected: closeRow.collected,
          expenses: closeRow.expenses,
          expensesTotal: closeRow.expensesTotal,
          movementRefs: closeRow.movementRefs,
        });
        if (sealed.ok) {
          result = { ok: true as const };
          await auditDayCloseInCloud(closeRow);
          break;
        }
        // no_listo / cie_faltante: reintenta. ya_sellado pasado no aplica (solo hoy).
        result = { ok: false as const, error: sealed.error };
        break;
      }
      result = await upsertDayCloseIdempotent(dayCloseToRow(closeRow));
      if (result.ok && !("skipped" in result && result.skipped)) {
        await auditDayCloseInCloud(closeRow);
      }
      break;
    }
    case "day_expense":
      result = await upsertDayExpenseIdempotent(dayExpenseToRow(item.row as CollectorDayExpenseDraft));
      break;
    case "misc_payment":
      result = await upsertOpsRow("misc_payments", miscToRow(item.row as MiscPayment), "ref");
      break;
    case "assignment": {
      const raw = item.row as DailyCollectionAssignment & { ref?: string };
      // Un N/P del cobrador no lo pisa una fila «pendiente» sin PG-.
      result = await upsertAssignmentRow(assignmentToRow(raw));
      break;
    }
    case "seal_route": {
      const raw = item.row as {
        collectorRef?: string;
        date?: string;
        route?: string;
        closedAt?: string;
      };
      result = await sealRouteSheetInCloud(raw);
      break;
    }
    default:
      return { status: 400, json: { ok: false, error: "unknown_kind" } };
  }
  return { status: result.ok ? 200 : 502, json: result as Record<string, unknown> };
}

async function safeMirrorItem(item: MirrorItem): Promise<ItemOutcome> {
  try {
    return await mirrorItem(item);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return { status: 500, json: { ok: false, error: message } };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    if (body.kind === "batch") {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > OPS_MIRROR_BATCH_MAX) {
        return jsonNoStore({ ok: false, error: "bad_batch_size" }, { status: 400 });
      }
      const results: Record<string, unknown>[] = [];
      for (const item of items) results.push((await safeMirrorItem(item)).json);
      return jsonNoStore({ ok: true, results });
    }
    const outcome = await mirrorItem(body);
    return jsonNoStore(outcome.json, { status: outcome.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
