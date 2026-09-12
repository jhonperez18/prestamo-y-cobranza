import { NextResponse } from "next/server";
import { mirrorClientToSupabase } from "@/lib/supabase/catalog-mirror";
import type { ClientRow } from "@/lib/mock-data";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { client?: ClientRow };
    if (!body?.client?.ref) {
      return NextResponse.json({ ok: false, error: "missing_client" }, { status: 400 });
    }
    const result = await mirrorClientToSupabase(body.client);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
