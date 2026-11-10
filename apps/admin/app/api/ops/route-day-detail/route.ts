import { jsonNoStore } from "@/lib/api-no-store";
import { readRouteDayDetail } from "@/lib/server-route-day-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Detalle de una ruta en un día (gastos + préstamos).
 * Una puerta: totales = suma de renglones. Sin depender del disco del celular.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const collectorRef = String(url.searchParams.get("collectorRef") || "").trim();
    const date = String(url.searchParams.get("date") || "").trim();
    const route = String(url.searchParams.get("route") || "").trim();
    if (!collectorRef || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !route) {
      return jsonNoStore({ ok: false, error: "dato_invalido" }, { status: 400 });
    }
    const result = await readRouteDayDetail(collectorRef, date, route);
    if (!result.ok) {
      return jsonNoStore(result, { status: result.error === "sin_servicio" ? 503 : 502 });
    }
    if (!result.ready) {
      return jsonNoStore(result, { status: 200 });
    }
    return jsonNoStore(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "route_day_detail_failed";
    console.error("route-day-detail-api", error);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
