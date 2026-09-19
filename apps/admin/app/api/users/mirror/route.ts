import { NextResponse } from "next/server";
import {
  deleteUserFromSupabase,
  mirrorUserToSupabase,
} from "@/lib/supabase/user-mirror";
import type { UserRow } from "@/lib/mock-data";

export async function POST(request: Request) {
  // Catálogo de personas: NUNCA bloquear por candado virgen de plata.
  try {
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
      return NextResponse.json(result);
    }

    if (!body?.user?.ref) {
      return NextResponse.json({ ok: false, error: "missing_user" }, { status: 400 });
    }
    const result = await mirrorUserToSupabase(body.user);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
