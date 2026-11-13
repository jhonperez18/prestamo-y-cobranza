import { NextResponse } from "next/server";
import { mirrorBankAccountToSupabase } from "@/lib/supabase/bank-accounts-mirror";
import type { BankAccount } from "@/lib/bank";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { account?: BankAccount };
    if (!body?.account?.ref) {
      return NextResponse.json({ ok: false, error: "missing_account" }, { status: 400 });
    }
    const result = await mirrorBankAccountToSupabase(body.account);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
