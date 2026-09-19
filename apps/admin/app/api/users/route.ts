import { NextResponse } from "next/server";
import { fetchUsersFromSupabase } from "@/lib/supabase/user-mirror";

export async function GET() {
  try {
    const result = await fetchUsersFromSupabase();
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: result.reason,
        users: [],
      });
    }
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, users: [] },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, users: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message, users: [] }, { status: 500 });
  }
}
