import { NextResponse } from "next/server";
import { runServerDayRollover } from "@/lib/server-day-rollover";
import { maybeSealInformeMonth } from "@/lib/server-seal-informe-month";
import { businessClockParts, businessTodayIso } from "@/lib/business-timezone";
import { isCronAuthorized } from "@/lib/cron-auth";
import { sendMonthlyReport, type MonthlyReportSendResult } from "@/lib/server-monthly-report";
import { sendWeeklyReport, type WeeklyReportSendResult } from "@/lib/server-weekly-report";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
    const now = new Date();
    const result = await runServerDayRollover(now);
    const informeMonth = await maybeSealInformeMonth({
      businessDate: businessTodayIso(now),
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "informe_month_failed";
      console.error("informe-month", error);
      return { attempted: true, ok: false, error: message };
    });
    const weeklyReport = result.ok
      ? await sendWeeklyReport({
          now,
          logoUrl: new URL("/logo-ca-prestamo.png", new URL(request.url).origin).toString(),
        }).catch((error: unknown): WeeklyReportSendResult => {
          console.error("weekly-report", error);
          return { ok: false, error: error instanceof Error ? error.message : "weekly_report_failed" };
        })
      : ({ ok: false, skipped: true, reason: "rollover_not_ok" } satisfies WeeklyReportSendResult);
    if (!weeklyReport.ok) console.error("weekly-report", weeklyReport);
    const monthlyReport = await sendMonthlyReport({ now }).catch((error: unknown): MonthlyReportSendResult => {
      console.error("monthly-report", error);
      return { ok: false, error: error instanceof Error ? error.message : "monthly_report_failed" };
    });
    if (!monthlyReport.ok) console.error("monthly-report", monthlyReport);
    return NextResponse.json({
      ...result,
      weeklyReport,
      monthlyReport,
      informeMonth,
      clock,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "day_rollover_failed";
    console.error("day-rollover", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
