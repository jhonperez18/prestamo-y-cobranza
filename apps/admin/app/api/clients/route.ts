import { NextResponse } from "next/server";
import { fetchClientsFromSupabase } from "@/lib/supabase/catalog-mirror";
import { changedSinceCursor, readChangedSince } from "@/lib/supabase/changed-since";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** `?since=` → solo lo que cambió o se creó desde ese corte (`incremental: true`). */
export async function GET(request: Request) {
  try {
    const cursor = changedSinceCursor();
    const since = readChangedSince(request);
    const result = await fetchClientsFromSupabase(since);
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason: result.reason, clients: [] });
    }
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, clients: [] }, { status: 502 });
    }
    return NextResponse.json({ ok: true, incremental: Boolean(since), cursor, clients: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message, clients: [] }, { status: 500 });
  }
}
