import { jsonNoStore } from "@/lib/api-no-store";
import { loadSupervisorInforme } from "@/lib/server-supervisor-informe";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Informe del mes, con cada préstamo (referencia, ruta, método, capital). Sin caché. No escribe. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const result = await loadSupervisorInforme(from, to);
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
