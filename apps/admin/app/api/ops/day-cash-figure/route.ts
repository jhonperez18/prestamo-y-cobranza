import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { readDayCashFigure } from "@/lib/server-day-cash-figure";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Caja M/T del día desde la base. Solo lee. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const collectorRef = url.searchParams.get("collectorRef") || "";
  const date = url.searchParams.get("date") || businessTodayIso();
  try {
    const result = await readDayCashFigure(collectorRef, date);
    const status = result.ok ? 200 : result.error === "dato_invalido" ? 400 : 500;
    return NextResponse.json(result, {
      status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "day_cash_figure_failed";
    console.error("day-cash-figure", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
