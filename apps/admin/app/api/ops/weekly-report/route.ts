import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { sendWeeklyReport } from "@/lib/server-weekly-report";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Envío manual del informe semanal (prueba o reenvío).
 * `?cutoff=YYYY-MM-DD` · `&test=1` (asunto «[Prueba]», no marca enviado) · `&force=1` (reenvía).
 * Auth: `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const cutoff = url.searchParams.get("cutoff")?.trim() || undefined;
    if (cutoff && !/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) {
      return NextResponse.json({ ok: false, error: "invalid_cutoff" }, { status: 400 });
    }
    const result = await sendWeeklyReport({
      cutoff,
      test: url.searchParams.get("test") === "1",
      force: url.searchParams.get("force") === "1",
      logoUrl: new URL("/logo-ca-prestamo.png", url.origin).toString(),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "weekly_report_failed";
    console.error("weekly-report", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
