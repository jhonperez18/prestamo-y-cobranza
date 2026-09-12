import { NextResponse } from "next/server";
import { fetchLoansFromSupabase } from "@/lib/supabase/catalog-mirror";

export async function GET() {
  try {
    const result = await fetchLoansFromSupabase();
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason: result.reason, loans: [] });
    }
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, loans: [] }, { status: 502 });
    }
    return NextResponse.json({ ok: true, loans: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message, loans: [] }, { status: 500 });
  }
}
