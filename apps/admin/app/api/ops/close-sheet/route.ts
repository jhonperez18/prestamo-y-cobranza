import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { executeCloseSheet } from "@/lib/server-close-sheet-exec";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Fase 4.1 — orden de cierre. El saldo del CIE lo pone la base.
 * Body: { collectorRef, date?, route?, routeRef?, key, by }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      collectorRef?: string;
      date?: string;
      route?: string;
      routeRef?: string;
      key?: string;
      by?: string;
    };
    const result = await executeCloseSheet({
      collectorRef: body.collectorRef || "",
      date: body.date || businessTodayIso(),
      route: body.route,
      routeRef: body.routeRef,
      key: body.key || "",
      by: body.by || "",
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "close_sheet_failed";
    console.error("close-sheet", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
