import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { readRouteOwnBox } from "@/lib/server-route-own-box";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Caja propia A o N hasta el día pedido. Un número. No baja el archivo. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectorRef = url.searchParams.get("collectorRef") || "";
  const date = url.searchParams.get("date") || businessTodayIso();
  const route = url.searchParams.get("route") || "";
  try {
    const result = await readRouteOwnBox(collectorRef, date, route);
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "route_own_box_failed";
    console.error("route-own-box", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
