import { NextResponse } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Comprueba que el proyecto Supabase responde (sin exponer secretos). */
export async function GET() {
  const { url, configured } = getSupabasePublicEnv();
  if (!configured) {
    return NextResponse.json(
      { ok: false, error: "missing_env", url: null },
      { status: 503 },
    );
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.getSession();
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, url },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      url,
      auth: "reachable",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { ok: false, error: message, url },
      { status: 502 },
    );
  }
}
