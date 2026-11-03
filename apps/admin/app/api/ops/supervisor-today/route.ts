import { jsonNoStore } from "@/lib/api-no-store";
import { businessTodayIso } from "@/lib/business-timezone";
import { loadSupervisorToday } from "@/lib/server-supervisor-today";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const HARD_MS = 12_000;

/** Hoja, cobros y CIE del día. Sin caché. No escribe. Tope duro: el jefe no puede quedar a medias. */
export async function GET() {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      loadSupervisorToday(businessTodayIso()),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: "supervisor_today_timeout" }),
          HARD_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!result.ok) return jsonNoStore({ ok: false, error: result.error }, { status: 502 });
    return jsonNoStore({ ok: true, ...result.payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "supervisor_today_failed";
    console.error("supervisor-today", error);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
