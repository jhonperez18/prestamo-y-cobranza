import { jsonNoStore } from "@/lib/api-no-store";
import { loadSupervisorInforme } from "@/lib/server-supervisor-informe";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const HARD_MS = 12_000;

/** Informe del mes, con cada préstamo (referencia, ruta, método, capital). Sin caché. No escribe. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      loadSupervisorInforme(from, to),
      new Promise<{ ok: false; error: string }>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, error: "informe_timeout" }), HARD_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!result.ok) return jsonNoStore({ ok: false, error: result.error }, { status: 502 });
    return jsonNoStore({
      ok: true,
      from: result.from,
      to: result.to,
      general: result.general,
      angelica: result.angelica,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "supervisor_informe_failed";
    console.error("supervisor-informe", error);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
