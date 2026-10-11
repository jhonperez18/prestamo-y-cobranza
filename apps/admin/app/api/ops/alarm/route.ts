import { jsonNoStore } from "@/lib/api-no-store";
import { isCronAuthorized } from "@/lib/cron-auth";
import { sendOpsAlarm } from "@/lib/server-ops-alarm";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Alarma de una tarea del VPS que falló → correo a los administradores.
 * Auth: `Authorization: Bearer $CRON_SECRET`. Cuerpo: `{ task, unit, host, detail }`.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return jsonNoStore({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const text = (key: string) => (typeof body[key] === "string" ? String(body[key]).trim() : "");
  const task = text("task");
  if (!task) return jsonNoStore({ ok: false, error: "missing_task" }, { status: 400 });

  const result = await sendOpsAlarm({
    task,
    unit: text("unit") || task,
    host: text("host") || "vps",
    detail: text("detail"),
  });
  if (!result.ok) {
    console.error("ops-alarm", result.error);
    return jsonNoStore(result, { status: 502 });
  }
  return jsonNoStore(result);
}
