import { NextResponse } from "next/server";
import { readUsersCatalogCached } from "@/lib/server-users-catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const HARD_MS = 12_000;

/** Catálogo de acceso (login). Caché en disco: no deja al cobrador fuera si Supabase tarda. */
export async function GET() {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      readUsersCatalogCached(),
      new Promise<Awaited<ReturnType<typeof readUsersCatalogCached>>>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: "users_timeout", users: [] }),
          HARD_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);

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
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: true, users: result.users, fromCache: Boolean(result.fromCache) },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { ok: false, error: message, users: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
