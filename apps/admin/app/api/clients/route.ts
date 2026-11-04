import { NextResponse } from "next/server";
import {
  readClientsDiskCache,
  withHardTimeout,
  writeClientsDiskCache,
} from "@/lib/server-catalog-disk-cache";
import { fetchClientsFromSupabase } from "@/lib/supabase/catalog-mirror";
import { changedSinceCursor, readChangedSince } from "@/lib/supabase/changed-since";
import type { ClientMirrorRow } from "@/lib/supabase/catalog-mirror";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const HARD_MS = 12_000;

/** `?since=` → solo lo que cambió. Sin since: disco primero si la nube se cuelga. */
export async function GET(request: Request) {
  try {
    const cursor = changedSinceCursor();
    const since = readChangedSince(request);

    if (since) {
      const result = await withHardTimeout(
        fetchClientsFromSupabase(since),
        HARD_MS,
        { ok: false as const, error: "clients_timeout", rows: [] as ClientMirrorRow[] },
      );
      if ("skipped" in result && result.skipped) {
        return NextResponse.json({ ok: true, skipped: true, reason: result.reason, clients: [] });
      }
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error, clients: [] },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json({
        ok: true,
        incremental: true,
        cursor,
        clients: result.rows,
      });
    }

    const cached = await readClientsDiskCache<ClientMirrorRow>();
    const result = await withHardTimeout(
      fetchClientsFromSupabase(null),
      HARD_MS,
      { ok: false as const, error: "clients_timeout", rows: [] as ClientMirrorRow[] },
    );

    if (result.ok && !("skipped" in result && result.skipped) && result.rows.length > 0) {
      void writeClientsDiskCache(result.rows);
      return NextResponse.json(
        { ok: true, incremental: false, cursor, clients: result.rows, fromCache: false },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if ("skipped" in result && result.skipped) {
      if (cached?.length) {
        return NextResponse.json({
          ok: true,
          incremental: false,
          cursor,
          clients: cached,
          fromCache: true,
        });
      }
      return NextResponse.json({ ok: true, skipped: true, reason: result.reason, clients: [] });
    }

    if (cached?.length) {
      return NextResponse.json({
        ok: true,
        incremental: false,
        cursor,
        clients: cached,
        fromCache: true,
        cacheNote: "ok" in result && !result.ok ? result.error : "clients_timeout",
      });
    }

    return NextResponse.json(
      { ok: false, error: "ok" in result && !result.ok ? result.error : "clients_unavailable", clients: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    const cached = await readClientsDiskCache<ClientMirrorRow>();
    if (cached?.length) {
      return NextResponse.json({
        ok: true,
        clients: cached,
        fromCache: true,
        cacheNote: message,
      });
    }
    return NextResponse.json({ ok: false, error: message, clients: [] }, { status: 500 });
  }
}
