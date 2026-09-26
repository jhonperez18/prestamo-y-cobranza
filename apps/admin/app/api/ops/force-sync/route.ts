import { upsertDayCloseIdempotent } from "@/lib/supabase/ops-mirror";
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { jsonNoStore } from "@/lib/api-no-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type ForceBody = {
  day_closes?: Record<string, unknown>[];
};

/**
 * Push forzado PC → Supabase (taller).
 * Recibe CIE- del localStorage del navegador y hace UPSERT con force
 * (pisa cash_float aunque la nube tenga un valor viejo con timestamp más nuevo).
 */
export async function POST(request: Request) {
  try {
    if (!mirrorUsesServiceRole()) {
      return jsonNoStore(
        { ok: false, error: "service_role_missing" },
        { status: 503 },
      );
    }
    const client = createMirrorServerClient();
    if (!client) {
      return jsonNoStore(
        { ok: false, error: "supabase_not_configured" },
        { status: 503 },
      );
    }

    const body = (await request.json()) as ForceBody;
    const rows = Array.isArray(body.day_closes) ? body.day_closes : [];
    if (!rows.length) {
      return jsonNoStore({ ok: false, error: "missing_day_closes" }, { status: 400 });
    }

    const results: Array<{
      ref: string;
      cash_float: number;
      ok: boolean;
      error?: string;
      skipped?: boolean;
    }> = [];

    for (const raw of rows) {
      const ref = String(raw.ref || "").trim();
      if (!ref || !ref.startsWith("CIE-") || ref.startsWith("PCE-")) {
        results.push({
          ref: ref || "(vacío)",
          cash_float: 0,
          ok: false,
          error: "solo_cie",
        });
        continue;
      }
      const cashFloat = Number(raw.cash_float) || 0;
      const result = await upsertDayCloseIdempotent(raw, { force: true });
      if (!result.ok) {
        results.push({
          ref,
          cash_float: cashFloat,
          ok: false,
          error: "error" in result ? result.error : "upsert_failed",
        });
        continue;
      }
      if ("skipped" in result && result.skipped) {
        results.push({
          ref,
          cash_float: cashFloat,
          ok: false,
          skipped: true,
          error: "reason" in result ? String(result.reason) : "skipped",
        });
        continue;
      }
      results.push({ ref, cash_float: cashFloat, ok: true });
    }

    const failed = results.filter((row) => !row.ok).length;
    return jsonNoStore({
      ok: failed === 0,
      pushed: results.filter((row) => row.ok).length,
      failed,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
