import { NextResponse } from "next/server";
import {
  deleteUserFromSupabase,
  fetchUsersFromSupabase,
  mirrorUserToSupabase,
  userRowToMirror,
} from "@/lib/supabase/user-mirror";
import {
  readUsersCatalogCached,
  seedUsersCatalogCache,
} from "@/lib/server-users-catalog";
import type { UserRow } from "@/lib/mock-data";
import {
  catalogOriginBlockedPayload,
  catalogWriteGateFromRequest,
} from "@/lib/catalog-write-guard";

async function refreshLoginCache(touched?: UserRow | null) {
  try {
    const snap = await fetchUsersFromSupabase();
    if (snap.ok && !("skipped" in snap && snap.skipped) && snap.rows.length > 0) {
      await seedUsersCatalogCache(snap.rows);
      return;
    }
  } catch (error) {
    console.error("users-login-cache-refresh", error);
  }
  // Storage caído: al menos el usuario tocado queda en el disco del VPS.
  if (!touched) return;
  try {
    const mapped = userRowToMirror(touched);
    if (!mapped) return;
    const current = await readUsersCatalogCached();
    const rows = current.ok ? [...current.users] : [];
    const idx = rows.findIndex((row) => row.ref === mapped.ref);
    if (idx >= 0) rows[idx] = mapped;
    else rows.push(mapped);
    if (rows.length > 0) await seedUsersCatalogCache(rows);
  } catch (error) {
    console.error("users-login-cache-bump", error);
  }
}

export async function POST(request: Request) {
  // Catálogo de personas: NUNCA bloquear por candado virgen de plata.
  // Sí bloquear orígenes ajenos (anti-cruce 3010 / otra nube con claves equivocadas).
  try {
    const catalogGate = catalogWriteGateFromRequest(request);
    if (!catalogGate.ok) {
      return NextResponse.json(catalogOriginBlockedPayload(catalogGate), { status: 403 });
    }

    const body = (await request.json()) as {
      kind?: "upsert" | "delete";
      user?: UserRow;
      ref?: string;
    };

    if (body.kind === "delete") {
      const ref = (body.ref || "").trim();
      if (!ref) {
        return NextResponse.json({ ok: false, error: "missing_ref" }, { status: 400 });
      }
      const result = await deleteUserFromSupabase(ref);
      if (!result.ok) {
        return NextResponse.json(result, { status: 502 });
      }
      void refreshLoginCache();
      return NextResponse.json(result);
    }

    if (!body?.user?.ref) {
      return NextResponse.json({ ok: false, error: "missing_user" }, { status: 400 });
    }
    const result = await mirrorUserToSupabase(body.user);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    void refreshLoginCache(body.user);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
