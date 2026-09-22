import { NextResponse } from "next/server";
import { fetchBankAccountsFromSupabase } from "@/lib/supabase/bank-accounts-mirror";

export async function GET() {
  try {
    const result = await fetchBankAccountsFromSupabase();
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: result.reason,
        accounts: [],
      });
    }
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, accounts: [] },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, accounts: result.accounts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message, accounts: [] }, { status: 500 });
  }
}
