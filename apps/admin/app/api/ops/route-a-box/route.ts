import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { previousCalendarIso } from "@/lib/collector-day-auto-close";
import { readRouteABox } from "@/lib/server-route-a-box";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Caja de A hasta el día pedido. Un número. No baja el archivo. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectorRef = url.searchParams.get("collectorRef") || "";
  const date = url.searchParams.get("date") || previousCalendarIso(businessTodayIso());
  try {
    const result = await readRouteABox(collectorRef, date);
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "route_a_box_failed";
    console.error("route-a-box", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
