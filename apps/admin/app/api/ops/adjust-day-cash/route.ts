import { NextResponse } from "next/server";
import { businessTodayIso } from "@/lib/business-timezone";
import { callAdjustDayCash } from "@/lib/server-adjust-day-cash";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Fase 4.3 — ajuste de saldo T / A / N / pools. Solo hoy. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      collectorRef?: string;
      date?: string;
      real?: number;
      by?: string;
      reason?: string;
      route?: string;
      key?: string;
      calculated?: number;
    };
    const result = await callAdjustDayCash({
      collectorRef: body.collectorRef || "",
      date: body.date || businessTodayIso(),
      real: Number(body.real),
      by: body.by || "",
      reason: body.reason || "",
      route: body.route,
      key: body.key,
      calculated: body.calculated,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : 400,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "adjust_day_cash_failed";
    console.error("adjust-day-cash", error);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
