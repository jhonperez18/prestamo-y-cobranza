import { NextResponse } from "next/server";
import {
  mirrorCombinedPaymentsToSupabase,
  mirrorPaymentToSupabase,
} from "@/lib/supabase/payment-mirror";
import type { PaymentRow } from "@/lib/mock-data";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";

/**
 * C2 dual-write: recibe un PaymentRow (o combinado) y lo espeja en Supabase.
 * No es la fuente de verdad; falla sin tumbar el cobro local.
 * Idempotencia: misma clave → 200 con el pago original.
 */
export async function POST(request: Request) {
  if (isVirginWriteLocked()) {
    return NextResponse.json(virginWriteLockPayload());
  }
  try {
    const body = (await request.json()) as {
      payment?: PaymentRow;
      combined?: { parts?: [PaymentRow, PaymentRow] | PaymentRow[] };
    };

    if (body.combined?.parts && Array.isArray(body.combined.parts) && body.combined.parts.length === 2) {
      const parts = body.combined.parts as [PaymentRow, PaymentRow];
      const result = await mirrorCombinedPaymentsToSupabase(parts);
      if (!result.ok) {
        return NextResponse.json(result, { status: 502 });
      }
      return NextResponse.json(result, { status: 200 });
    }

    if (!body?.payment?.ref) {
      return NextResponse.json({ ok: false, error: "missing_payment" }, { status: 400 });
    }
    const result = await mirrorPaymentToSupabase(body.payment);
    if (!result.ok) {
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
