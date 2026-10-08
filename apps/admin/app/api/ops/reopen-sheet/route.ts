import { jsonNoStore } from "@/lib/api-no-store";
import { reopenSheetInCloud, type ReopenSheetRequest } from "@/lib/supabase/sheet-reopen-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Reabrir la hoja de hoy de un cobrador (supervisor / admin). */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ReopenSheetRequest>;
    if (!body.collectorRef || !body.route) {
      return jsonNoStore({ ok: false, error: "Falta cobrador o planilla." }, { status: 400 });
    }
    const result = await reopenSheetInCloud({
      collectorRef: body.collectorRef,
      route: body.route,
      by: String(body.by || ""),
    });
    if (!result.ok) return jsonNoStore(result, { status: result.status });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("reopen-sheet", message);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
