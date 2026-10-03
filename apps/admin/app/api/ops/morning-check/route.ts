import { jsonNoStore } from "@/lib/api-no-store";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  readMorningCheckReport,
  runServerMorningCheck,
  saveMorningCheckReport,
} from "@/lib/server-morning-check";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Revisión de la mañana (Vercel Cron 6:00 Bogotá = 11:00 UTC).
 * Cron / `Bearer $CRON_SECRET` → corre y guarda. Sin auth → solo lee el último informe.
 */
export async function GET(request: Request) {
  if (isCronAuthorized(request)) return run();
  try {
    const result = await readMorningCheckReport();
    if (!result.ok) return jsonNoStore(result, { status: 502 });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return jsonNoStore({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return run();
}

async function run() {
  try {
    const report = await runServerMorningCheck(new Date());
    const saved = await saveMorningCheckReport(report);
    if (!saved.ok) console.error("morning-check-save", saved.error);
    return jsonNoStore({ ok: true, report, saved: saved.ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "morning_check_failed";
    console.error("morning-check", err);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
