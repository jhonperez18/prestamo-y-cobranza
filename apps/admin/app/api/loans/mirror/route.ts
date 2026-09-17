import { NextResponse } from "next/server";
import { mirrorLoanToSupabase } from "@/lib/supabase/catalog-mirror";
import type { LoanRow } from "@/lib/mock-data";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";

export async function POST(request: Request) {
  if (isVirginWriteLocked()) {
    return NextResponse.json(virginWriteLockPayload());
  }
  try {
    const body = (await request.json()) as { loan?: LoanRow };
    if (!body?.loan?.ref) {
      return NextResponse.json({ ok: false, error: "missing_loan" }, { status: 400 });
    }
    const result = await mirrorLoanToSupabase(body.loan);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
