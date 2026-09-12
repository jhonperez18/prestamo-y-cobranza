import { NextResponse } from "next/server";
import { fetchClientsFromSupabase } from "@/lib/supabase/catalog-mirror";

export async function GET() {
  try {
    const result = await fetchClientsFromSupabase();
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason: result.reason, clients: [] });
    }
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, clients: [] }, { status: 502 });
    }
    return NextResponse.json({ ok: true, clients: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message, clients: [] }, { status: 500 });
  }
}
