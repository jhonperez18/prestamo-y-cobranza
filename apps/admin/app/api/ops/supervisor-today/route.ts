import { jsonNoStore } from "@/lib/api-no-store";
import { businessTodayIso } from "@/lib/business-timezone";
import { loadSupervisorToday } from "@/lib/server-supervisor-today";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Hoja, cobros y CIE del día. Sin caché. No escribe. */
export async function GET() {
  try {
    const result = await loadSupervisorToday(businessTodayIso());
    if (!result.ok) return jsonNoStore({ ok: false, error: result.error }, { status: 502 });
    return jsonNoStore({ ok: true, ...result.payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "supervisor_today_failed";
    console.error("supervisor-today", error);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
