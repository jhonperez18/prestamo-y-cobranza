/**
 * Procesa cobros enviados desde CollectorPayForm hacia Postgres.
 * Idempotencia por idempotencyKey + combinado atómico.
 * Evidencia: solo refs livianas en DB (nunca Base64).
 */
import { todayIso, isoToDispatchLabel } from "@/lib/daily-dispatch";
import { encodeComboChargeLabel } from "@/lib/payment-combo";
import { normalizePaymentMethod, type PaymentMethod } from "@/lib/payment-method";
import { validatePaymentEvidence, type PaymentEvidenceRef } from "@/lib/payment-evidence";
import type { PayKind } from "@/lib/loan-pay";
import type { CollectorPayApiBody } from "@/lib/collector-pay-submit";
import type { PaymentRow, StatusKind } from "@/lib/mock-data";
import { createMirrorServerClient } from "@/lib/supabase/admin";
import {
  registerCombinedLoanPaymentInSupabase,
  registerLoanPaymentInSupabase,
  validatePayAmount,
  type RegisterLoanPaymentResult,
} from "@/lib/supabase/register-loan-payment";
import { mirrorRowToPaymentRow, type PaymentMirrorRow } from "@/lib/supabase/payment-mirror";

export type { CollectorPayApiBody } from "@/lib/collector-pay-submit";

export type CollectorPayApiSuccess = {
  ok: true;
  duplicated: boolean;
  message?: string;
  payment?: PaymentRow;
  payments?: PaymentRow[];
  balance?: number;
  paid?: number;
};

export type CollectorPayApiFailure = {
  ok: false;
  error: string;
  balance?: number;
};

export type CollectorPayApiResult =
  | { status: 200; body: CollectorPayApiSuccess }
  | { status: 400 | 409 | 500 | 502; body: CollectorPayApiFailure };

function newServerPaymentRef(suffix = ""): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()
      : Math.random().toString(36).slice(2, 12).toUpperCase();
  const tag = suffix ? `-${suffix}` : "";
  return `PG-${Date.now()}${tag}-${rand}`;
}

function paymentKindFromPay(kind: PayKind): StatusKind {
  return kind === "abono" ? "partial" : "paid";
}

function paymentTypeFromPay(kind: PayKind): string {
  return kind === "abono" ? "Abono" : "Cuota";
}

/** Busca un cobro vivo por idempotency_key en Postgres. */
export async function findPaymentByIdempotencyKey(
  idempotencyKey: string,
): Promise<PaymentRow | null> {
  const key = idempotencyKey.trim();
  if (!key) return null;
  const client = createMirrorServerClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("payments")
      .select(
        "id,ref,loan_ref,client_ref,collector_ref,collector_name,amount,paid_date,paid_time,due_date,charge_label,method,source,payment_type,payment_kind,route_ref,idempotency_key,updated_at",
      )
      .eq("idempotency_key", key)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as PaymentMirrorRow & { idempotency_key?: string | null };
    const mapped = mirrorRowToPaymentRow(row);
    if (!mapped) return null;
    return {
      ...mapped,
      idempotencyKey: row.idempotency_key?.trim() || key,
    };
  } catch {
    return null;
  }
}

function buildPaymentRowFromSubmit(
  input: {
    amount: number;
    kind: PayKind;
    method: PaymentMethod | string;
    evidence?: PaymentEvidenceRef[];
    idempotencyKey: string;
    loanRef: string;
    clientName?: string;
    collectorRef?: string;
    collectorName?: string;
    paidDate: string;
    paidTime: string;
    routeRef?: string;
    chargeLabel?: string;
    paymentRef: string;
    comboGroupId?: string;
  },
): PaymentRow {
  const method = normalizePaymentMethod(input.method);
  const chargeLabel = input.comboGroupId
    ? encodeComboChargeLabel(input.chargeLabel, input.comboGroupId)
    : input.chargeLabel;
  return {
    ref: input.paymentRef,
    loanRef: input.loanRef,
    when: `${isoToDispatchLabel(input.paidDate)} · ${input.paidTime}`,
    paidDate: input.paidDate,
    paidTime: input.paidTime,
    chargeLabel,
    comboGroupId: input.comboGroupId,
    client: input.clientName?.trim() || "—",
    collector: input.collectorName?.trim() || "—",
    collectorRef: input.collectorRef?.trim() || undefined,
    routeRef: input.routeRef?.trim() || undefined,
    idempotencyKey: input.idempotencyKey.trim(),
    amount: input.amount,
    type: paymentTypeFromPay(input.kind),
    kind: paymentKindFromPay(input.kind),
    method,
    evidence: input.evidence?.length ? input.evidence : undefined,
    source: "pwa",
  };
}

function mapRegisterResult(result: RegisterLoanPaymentResult): CollectorPayApiResult {
  if (!result.ok) {
    return {
      status: result.status,
      body: { ok: false, error: result.error, balance: result.balance },
    };
  }
  if (result.duplicate) {
    return {
      status: 200,
      body: {
        ok: true,
        duplicated: true,
        message: "Pago procesado previamente",
        payment: result.payments[0],
        payments: result.payments,
        balance: result.balance,
        paid: result.paid,
      },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      duplicated: false,
      payment: result.payments[0],
      payments: result.payments,
      balance: result.balance,
      paid: result.paid,
    },
  };
}

/**
 * Registra un cobro CollectorPaySubmit (+ loanRef) en Supabase.
 * Reintento con la misma idempotencyKey → 200 duplicated sin nueva fila.
 */
export async function processCollectorPayApi(
  body: CollectorPayApiBody,
): Promise<CollectorPayApiResult> {
  const loanRef = (body.loanRef || "").trim();
  if (!loanRef) {
    return { status: 400, body: { ok: false, error: "Falta loanRef del préstamo." } };
  }

  const idempotencyKey = (body.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    return { status: 400, body: { ok: false, error: "Falta idempotencyKey." } };
  }

  const paidDate = (body.paidDate || "").trim() || todayIso();
  const paidTime =
    (body.paidTime || "").trim() ||
    body.combined?.paidTime?.trim() ||
    new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  // —— Combinado ——
  if (body.combined) {
    const comboGroupId = (body.combined.comboGroupId || "").trim();
    if (!comboGroupId) {
      return { status: 400, body: { ok: false, error: "Falta comboGroupId del cobro combinado." } };
    }
    const parts = body.combined.parts;
    if (!parts || parts.length !== 2) {
      return {
        status: 400,
        body: { ok: false, error: "Combinado requiere exactamente dos tramos." },
      };
    }

    const [rawA, rawB] = parts;
    const checkA = validatePayAmount(rawA.amount);
    if (!checkA.ok) {
      return { status: 400, body: { ok: false, error: `1.er tramo: ${checkA.error}` } };
    }
    const checkB = validatePayAmount(rawB.amount);
    if (!checkB.ok) {
      return { status: 400, body: { ok: false, error: `2.º tramo: ${checkB.error}` } };
    }

    const methodA = normalizePaymentMethod(rawA.method);
    const methodB = normalizePaymentMethod(rawB.method);
    if (methodA === methodB) {
      return {
        status: 400,
        body: { ok: false, error: "Combinado requiere dos métodos distintos." },
      };
    }

    const evidenceA = validatePaymentEvidence(methodA, rawA.evidence);
    if (evidenceA) {
      return { status: 400, body: { ok: false, error: `1.er tramo: ${evidenceA}` } };
    }
    const evidenceB = validatePaymentEvidence(methodB, rawB.evidence);
    if (evidenceB) {
      return { status: 400, body: { ok: false, error: `2.º tramo: ${evidenceB}` } };
    }

    const keyA = (rawA.idempotencyKey || "").trim();
    const keyB = (rawB.idempotencyKey || "").trim();
    if (!keyA || !keyB) {
      return {
        status: 400,
        body: { ok: false, error: "Cada tramo del combinado necesita idempotencyKey." },
      };
    }

    const existingA = await findPaymentByIdempotencyKey(keyA);
    const existingB = await findPaymentByIdempotencyKey(keyB);
    if (existingA && existingB) {
      return {
        status: 200,
        body: {
          ok: true,
          duplicated: true,
          message: "Pago procesado previamente",
          payment: existingA,
          payments: [existingA, existingB],
        },
      };
    }
    if (existingA || existingB) {
      return {
        status: 409,
        body: {
          ok: false,
          error: "Combinado a medias en la nube. No se duplica; use claves nuevas o reintente el par completo.",
        },
      };
    }

    const refA = body.paymentRefs?.[0]?.trim() || newServerPaymentRef("A");
    const refB = body.paymentRefs?.[1]?.trim() || newServerPaymentRef("B");

    const paymentA = buildPaymentRowFromSubmit({
      amount: checkA.amount,
      kind: body.kind,
      method: methodA,
      evidence: rawA.evidence,
      idempotencyKey: keyA,
      loanRef,
      clientName: body.clientName,
      collectorRef: body.collectorRef,
      collectorName: body.collectorName,
      paidDate,
      paidTime,
      routeRef: body.routeRef,
      chargeLabel: body.chargeLabel,
      paymentRef: refA,
      comboGroupId,
    });
    const paymentB = buildPaymentRowFromSubmit({
      amount: checkB.amount,
      kind: "abono",
      method: methodB,
      evidence: rawB.evidence,
      idempotencyKey: keyB,
      loanRef,
      clientName: body.clientName,
      collectorRef: body.collectorRef,
      collectorName: body.collectorName,
      paidDate,
      paidTime,
      routeRef: body.routeRef,
      chargeLabel: body.chargeLabel,
      paymentRef: refB,
      comboGroupId,
    });

    const registered = await registerCombinedLoanPaymentInSupabase([paymentA, paymentB]);
    if (!registered.ok && registered.error === "register_combined_collection_missing") {
      // Migración no aplicada: dos register_collection secuenciales (mejor que fallar en seco).
      const first = await registerLoanPaymentInSupabase(paymentA);
      if (!first.ok) return mapRegisterResult(first);
      const second = await registerLoanPaymentInSupabase(paymentB);
      if (!second.ok) {
        return {
          status: second.status,
          body: {
            ok: false,
            error: `combinado_parcial: ${paymentA.ref} ok, segundo falló (${second.error})`,
            balance: second.balance,
          },
        };
      }
      return mapRegisterResult({
        ok: true,
        duplicate: first.duplicate && second.duplicate,
        payments: [first.payments[0], second.payments[0]],
        balance: second.balance ?? first.balance,
        paid: second.paid,
      });
    }
    return mapRegisterResult(registered);
  }

  // —— Simple ——
  const amountCheck = validatePayAmount(body.amount);
  if (!amountCheck.ok) {
    return { status: 400, body: { ok: false, error: amountCheck.error } };
  }

  const methodRaw = String(body.method ?? "").trim();
  if (!methodRaw) {
    return { status: 400, body: { ok: false, error: "Falta el método de pago." } };
  }
  const method = normalizePaymentMethod(body.method);
  const evidenceError = validatePaymentEvidence(method, body.evidence);
  if (evidenceError) {
    return { status: 400, body: { ok: false, error: evidenceError } };
  }

  const existing = await findPaymentByIdempotencyKey(idempotencyKey);
  if (existing) {
    return {
      status: 200,
      body: {
        ok: true,
        duplicated: true,
        message: "Pago procesado previamente",
        payment: existing,
        payments: [existing],
      },
    };
  }

  const kind: PayKind = body.kind === "abono" ? "abono" : "cuota";
  const paymentRef = (body.paymentRef || "").trim() || newServerPaymentRef();
  const payment = buildPaymentRowFromSubmit({
    amount: amountCheck.amount,
    kind,
    method,
    evidence: body.evidence,
    idempotencyKey,
    loanRef,
    clientName: body.clientName,
    collectorRef: body.collectorRef,
    collectorName: body.collectorName,
    paidDate,
    paidTime,
    routeRef: body.routeRef,
    chargeLabel: body.chargeLabel,
    paymentRef,
  });

  return mapRegisterResult(await registerLoanPaymentInSupabase(payment));
}
