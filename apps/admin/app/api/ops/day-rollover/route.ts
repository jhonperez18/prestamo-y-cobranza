import { NextResponse } from "next/server";
import { runServerDayRollover } from "@/lib/server-day-rollover";
import { businessClockParts } from "@/lib/business-timezone";
import { isCronAuthorized } from "@/lib/cron-auth";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * Sella jornadas vencidas (23:30 Bogotá / días previos) en Supabase.
 * Lo dispara Vercel Cron — no hace falta celular ni este PC.
 *
 * Auth: header `Authorization: Bearer $CRON_SECRET` o `x-vercel-cron: 1`.
 */
const authorized = isCronAuthorized;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const clock = businessClockParts();
    const result = await runServerDayRollover(new Date());
    return NextResponse.json({
      ...result,
      clock,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "day_rollover_failed";
    console.error("day-rollover", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
