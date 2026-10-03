import { NextResponse } from "next/server";
import { fetchLoansFromSupabase } from "@/lib/supabase/catalog-mirror";
import { changedSinceCursor, readChangedSince } from "@/lib/supabase/changed-since";
import { isVirginWriteLocked, virginWriteLockPayload } from "@/lib/virgin-lock";
import { processCollectorPayApi } from "@/lib/supabase/process-collector-pay-api";
import type { CollectorPayApiBody } from "@/lib/collector-pay-submit";
import type { PaymentRow } from "@/lib/mock-data";
import {
  registerCombinedLoanPaymentInSupabase,
  registerLoanPaymentInSupabase,
  validatePayAmount,
} from "@/lib/supabase/register-loan-payment";
import { paymentComboGroupId } from "@/lib/payment-combo";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** `?since=` → solo lo que cambió o se creó desde ese corte (`incremental: true`). */
export async function GET(request: Request) {
  try {
    const cursor = changedSinceCursor();
    const since = readChangedSince(request);
    const result = await fetchLoansFromSupabase(since);
    if ("skipped" in result && result.skipped) {
      return NextResponse.json({ ok: true, skipped: true, reason: result.reason, loans: [] });
    }
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, loans: [] }, { status: 502 });
    }
    return NextResponse.json({ ok: true, incremental: Boolean(since), cursor, loans: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json({ ok: false, error: message, loans: [] }, { status: 500 });
  }
}

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

/**
 * POST /api/loans — mismo contrato que /api/loans/pay (CollectorPaySubmit + loanRef).
 * GET permanece: listado de préstamos desde Supabase.
 */
export async function POST(req: Request) {
  if (isVirginWriteLocked()) {
    return NextResponse.json(virginWriteLockPayload(), { status: 423 });
  }

  try {
    const body = (await req.json()) as CollectorPayApiBody | LegacyPayBody;

    if (isCollectorPayBody(body)) {
      const result = await processCollectorPayApi(body);
      return NextResponse.json(result.body, { status: result.status });
    }

    const legacy = body as LegacyPayBody;
    if (legacy.combined?.parts && Array.isArray(legacy.combined.parts)) {
      const parts = legacy.combined.parts;
      if (parts.length !== 2) {
        return NextResponse.json(
          { ok: false, error: "Combinado requiere exactamente dos tramos." },
          { status: 400 },
        );
      }
      const [a, b] = parts as [PaymentRow, PaymentRow];
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
        return NextResponse.json(
          {
            ok: true,
            duplicated: true,
            message: "Pago procesado previamente",
            payments: result.payments,
            balance: result.balance,
            paid: result.paid,
          },
          { status: 200 },
        );
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
            "Payload inválido. Envíe CollectorPaySubmit con loanRef e idempotencyKey, o { payment }.",
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
      return NextResponse.json(
        {
          ok: true,
          duplicated: true,
          message: "Pago procesado previamente",
          payment: result.payments[0],
          payments: result.payments,
          balance: result.balance,
          paid: result.paid,
        },
        { status: 200 },
      );
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
