import { NextResponse } from "next/server";
import { fetchPaymentsFromSupabase } from "@/lib/supabase/payment-mirror";

/**
 * C3: lista cobros en public.payments para fusionar en el demo local.
 */
export async function GET(request: Request) {
  try {
    const evidence = new URL(request.url).searchParams.get("evidence") === "1";
    const result = await fetchPaymentsFromSupabase({ evidence });
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: result.reason,
        payments: [],
      });
    }
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, payments: [] },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, payments: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { ok: false, error: message, payments: [] },
      { status: 500 },
    );
  }
}
