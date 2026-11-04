import { jsonNoStore } from "@/lib/api-no-store";
import { businessTodayIso } from "@/lib/business-timezone";
import { loadSupervisorToday } from "@/lib/server-supervisor-today";
import {
  readSupervisorTodayCache,
  writeSupervisorTodayCache,
} from "@/lib/supervisor-today-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const HARD_MS = 14_000;

/** Hoja, cobros y CIE del día. Disco primero si la nube se cuelga. No escribe en ops. */
export async function GET() {
  const today = businessTodayIso();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      loadSupervisorToday(today),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: "supervisor_today_timeout" }),
          HARD_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (result.ok) {
      const useful =
        result.payload.assignments.length > 0 ||
        result.payload.payments.length > 0 ||
        result.payload.dayCloses.length > 0;
      if (useful) void writeSupervisorTodayCache(result.payload);
      return jsonNoStore({ ok: true, ...result.payload, fromCache: false });
    }

    const cached = await readSupervisorTodayCache(today);
    if (cached) {
      return jsonNoStore({
        ok: true,
        ...cached,
        fromCache: true,
        cacheNote: result.error,
      });
    }
    return jsonNoStore({ ok: false, error: result.error }, { status: 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "supervisor_today_failed";
    console.error("supervisor-today", error);
    const cached = await readSupervisorTodayCache(today);
    if (cached) {
      return jsonNoStore({ ok: true, ...cached, fromCache: true, cacheNote: message });
    }
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
