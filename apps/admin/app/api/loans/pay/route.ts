import { NextResponse } from "next/server";
import type { CollectorPayApiBody } from "@/lib/collector-pay-submit";
import type { PaymentRow } from "@/lib/mock-data";
import { paymentComboGroupId } from "@/lib/payment-combo";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";
import { processCollectorPayApi } from "@/lib/supabase/process-collector-pay-api";
import {
  registerCombinedLoanPaymentInSupabase,
  registerLoanPaymentInSupabase,
  validatePayAmount,
} from "@/lib/supabase/register-loan-payment";

type LegacyPayBody = {
  payment?: PaymentRow;
  combined?: {
    comboGroupId?: string;
    parts?: [PaymentRow, PaymentRow] | PaymentRow[];
  };
};

function isCollectorPayBody(body: unknown): body is CollectorPayApiBody {
  if (!body || typeof body !== "object") return false;
  const row = body as Record<string, unknown>;
  return (
    typeof row.idempotencyKey === "string" &&
    typeof row.loanRef === "string" &&
    (typeof row.amount === "number" || Boolean(row.combined)) &&
    !("payment" in row && row.payment && typeof row.payment === "object")
  );
}

function duplicatedOk(payload: {
  payments: PaymentRow[];
  balance?: number;
  paid?: number;
}) {
  return NextResponse.json(
    {
      ok: true,
      duplicated: true,
      message: "Pago procesado previamente",
      payment: payload.payments[0],
      payments: payload.payments,
      balance: payload.balance,
      paid: payload.paid,
    },
    { status: 200 },
  );
}

/**
 * POST /api/loans/pay
 *
 * Cobros desde CollectorPayForm (simple o combined).
 * - Idempotencia por idempotencyKey → 200 duplicated (sin fila nueva).
 * - Evidencia: solo paths Storage / refs livianas en Postgres (nunca Base64).
 * - Combinado: RPC atómica register_combined_collection.
 *
 * No sustituye el commit local del padre (sistema-madre).
 */
export async function POST(request: Request) {
  if (isVirginWriteLocked()) {
    return NextResponse.json(virginWriteLockPayload(), { status: 423 });
  }

  try {
    const body = (await request.json()) as CollectorPayApiBody | LegacyPayBody;

    if (isCollectorPayBody(body)) {
      const result = await processCollectorPayApi(body);
      return NextResponse.json(result.body, { status: result.status });
    }

    const legacy = body as LegacyPayBody;

    if (legacy.combined?.parts && Array.isArray(legacy.combined.parts)) {
      if (legacy.combined.parts.length !== 2) {
        return NextResponse.json(
          { ok: false, error: "Combinado requiere exactamente dos tramos." },
          { status: 400 },
        );
      }
      const [a, b] = legacy.combined.parts as [PaymentRow, PaymentRow];
      const combo =
        legacy.combined.comboGroupId?.trim() ||
        paymentComboGroupId(a) ||
        paymentComboGroupId(b);
      if (!combo) {
        return NextResponse.json(
          { ok: false, error: "Falta comboGroupId del cobro combinado." },
          { status: 400 },
        );
      }
      const result = await registerCombinedLoanPaymentInSupabase([
        { ...a, comboGroupId: a.comboGroupId || combo },
        { ...b, comboGroupId: b.comboGroupId || combo },
      ]);
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error, balance: result.balance },
          { status: result.status },
        );
      }
      if (result.duplicate) {
        return duplicatedOk(result);
      }
      return NextResponse.json(
        {
          ok: true,
          duplicated: false,
          payments: result.payments,
          balance: result.balance,
          paid: result.paid,
        },
        { status: 200 },
      );
    }

    if (!legacy.payment?.ref) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Payload inválido. Envíe CollectorPaySubmit con loanRef e idempotencyKey.",
        },
        { status: 400 },
      );
    }

    const amountCheck = validatePayAmount(legacy.payment.amount);
    if (!amountCheck.ok) {
      return NextResponse.json({ ok: false, error: amountCheck.error }, { status: 400 });
    }

    const result = await registerLoanPaymentInSupabase({
      ...legacy.payment,
      amount: amountCheck.amount,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, balance: result.balance },
        { status: result.status },
      );
    }
    if (result.duplicate) {
      return duplicatedOk(result);
    }
    return NextResponse.json(
      {
        ok: true,
        duplicated: false,
        payment: result.payments[0],
        payments: result.payments,
        balance: result.balance,
        paid: result.paid,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
