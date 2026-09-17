import { NextResponse } from "next/server";
import { mirrorPaymentToSupabase } from "@/lib/supabase/payment-mirror";
import type { PaymentRow } from "@/lib/mock-data";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";

/**
 * C2 dual-write: recibe un PaymentRow y lo espeja en Supabase.
 * No es la fuente de verdad; falla sin tumbar el cobro local.
 */
export async function POST(request: Request) {
  if (isVirginWriteLocked()) {
    return NextResponse.json(virginWriteLockPayload());
  }
  try {
    const body = (await request.json()) as { payment?: PaymentRow };
    if (!body?.payment?.ref) {
      return NextResponse.json({ ok: false, error: "missing_payment" }, { status: 400 });
    }
    const result = await mirrorPaymentToSupabase(body.payment);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
