/**
 * Registro atómico de cobros en Postgres (idempotencia + combinado).
 * Usado por `/api/loans/pay` y por el espejo de pagos.
 */
import { createMirrorServerClient, mirrorUsesServiceRole } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import { pesos } from "@/lib/finance";
import { evidenceForMirror } from "@/lib/payment-evidence";
import { parseComboChargeLabel } from "@/lib/payment-combo";
import { normalizePaymentMethod, type PaymentMethod } from "@/lib/payment-method";
import type { PaymentRow, StatusKind } from "@/lib/mock-data";
import { materializeEvidenceForDatabase } from "@/lib/supabase/payment-evidence-storage";

type RpcPayment = {
  id?: string;
  ref: string;
  loan_ref: string;
  client_ref?: string | null;
  collector_ref?: string | null;
  collector_name?: string | null;
  amount: number;
  paid_date: string;
  paid_time?: string | null;
  due_date?: string | null;
  charge_label?: string | null;
  method: string;
  source?: string | null;
  payment_type?: string | null;
  payment_kind?: string | null;
  route_ref?: string | null;
  evidence?: PaymentRow["evidence"];
  idempotency_key?: string | null;
  updated_at?: string | null;
};

export type RegisterCollectionRpcBody = {
  ok?: boolean;
  duplicate?: boolean;
  error?: string;
  code?: number;
  ref?: string;
  balance?: number;
  amount?: number;
  paid?: number;
  total?: number;
  payment?: RpcPayment;
  payments?: RpcPayment[];
  refs?: string[];
};

export type RegisterLoanPaymentResult =
  | {
      ok: true;
      duplicate: boolean;
      payments: PaymentRow[];
      balance?: number;
      paid?: number;
    }
  | {
      ok: false;
      error: string;
      status: 400 | 409 | 500 | 502;
      balance?: number;
    };

function paymentToRpcPart(payment: PaymentRow): Record<string, unknown> | null {
  const loanRef = (payment.loanRef || "").trim();
  const paidDate = normalizeHistoryDate(payment.paidDate || "") || payment.paidDate;
  const amount = pesos(payment.amount);
  if (!loanRef || !paidDate || !(amount > 0)) return null;

  return {
    ref: payment.ref,
    loan_ref: loanRef,
    client_ref: null,
    collector_ref: payment.collectorRef?.trim() || null,
    collector_name: payment.collector?.trim() || null,
    amount,
    paid_date: paidDate,
    paid_time: payment.paidTime?.trim() || null,
    due_date: normalizeHistoryDate(payment.dueDate || "") || payment.dueDate || null,
    charge_label: payment.voidedAt
      ? `ANULADO: ${payment.voidReason || "—"} · ${payment.voidedBy || "—"} · ${payment.voidedAt}`
      : payment.chargeLabel?.trim() || null,
    method: normalizePaymentMethod(payment.method),
    source: payment.source || "ruta",
    payment_type: payment.voidedAt ? "Anulado" : payment.type || null,
    payment_kind: payment.kind || null,
    route_ref: payment.routeRef?.trim() || null,
    // Nunca Base64: solo refs livianas (path Storage / https).
    evidence: evidenceForMirror(payment.evidence) ?? null,
    idempotency_key: payment.idempotencyKey?.trim() || null,
  };
}

async function withDbEvidence(payment: PaymentRow): Promise<PaymentRow> {
  const evidence = await materializeEvidenceForDatabase(payment.ref, payment.evidence);
  return { ...payment, evidence };
}

function rpcPaymentToRow(raw: RpcPayment, fallback?: PaymentRow): PaymentRow | null {
  const ref = (raw.ref || "").trim();
  const loanRef = (raw.loan_ref || "").trim();
  const paidDate = normalizeHistoryDate(raw.paid_date || "") || raw.paid_date;
  const amount = pesos(Number(raw.amount));
  if (!ref || !loanRef || !paidDate || !(amount > 0)) return fallback ?? null;

  const paidTime = (raw.paid_time || "").trim() || fallback?.paidTime || "00:00";
  const comboParsed = parseComboChargeLabel(raw.charge_label);
  const method = normalizePaymentMethod(
    (raw.method || fallback?.method || "efectivo") as PaymentMethod,
  );

  return {
    id: raw.id?.trim() || fallback?.id,
    ref,
    loanRef,
    when: `${isoToDispatchLabel(paidDate)} · ${paidTime}`,
    paidDate,
    paidTime,
    dueDate: raw.due_date
      ? normalizeHistoryDate(raw.due_date) || raw.due_date
      : fallback?.dueDate,
    chargeLabel: comboParsed.chargeLabel ?? fallback?.chargeLabel,
    comboGroupId: comboParsed.comboGroupId ?? fallback?.comboGroupId,
    client: fallback?.client || "",
    collector: raw.collector_name?.trim() || fallback?.collector || "—",
    collectorRef: raw.collector_ref?.trim() || fallback?.collectorRef,
    routeRef: raw.route_ref?.trim() || fallback?.routeRef,
    amount,
    type: raw.payment_type?.trim() || fallback?.type || "Cuota",
    kind: (raw.payment_kind as StatusKind) || fallback?.kind || "paid",
    method,
    evidence: Array.isArray(raw.evidence) && raw.evidence.length
      ? raw.evidence
      : fallback?.evidence,
    source: raw.source === "caja" ? "caja" : fallback?.source || "pwa",
    idempotencyKey:
      (typeof raw.idempotency_key === "string" && raw.idempotency_key.trim()) ||
      fallback?.idempotencyKey,
    updatedAt: raw.updated_at || fallback?.updatedAt,
  };
}

/** Valida monto COP entero > 0 (y opcionalmente tope de saldo). */
export function validatePayAmount(
  amount: unknown,
  maxBalance?: number,
): { ok: true; amount: number } | { ok: false; error: string } {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return { ok: false, error: "El monto debe ser un número válido." };
  }
  if (Math.trunc(n) !== n) {
    return { ok: false, error: "El monto debe ser un entero en pesos (COP)." };
  }
  const value = pesos(n);
  if (value <= 0) {
    return { ok: false, error: "El monto debe ser un entero mayor a cero." };
  }
  if (maxBalance != null && Number.isFinite(maxBalance) && value > pesos(maxBalance)) {
    return { ok: false, error: "El valor no puede ser mayor a lo pendiente del préstamo." };
  }
  return { ok: true, amount: value };
}

function mapRpcError(body: RegisterCollectionRpcBody | null, fallback: string): {
  error: string;
  status: 400 | 409 | 500 | 502;
  balance?: number;
} {
  const code = body?.code;
  const err = (body?.error || fallback).trim();
  if (err === "saldo_excedido" || code === 409) {
    return {
      error:
        err === "saldo_excedido"
          ? "El valor no puede ser mayor a lo pendiente del préstamo."
          : err,
      status: 409,
      balance: typeof body?.balance === "number" ? body.balance : undefined,
    };
  }
  if (code === 400 || /invalida|invalido|requeridas|iguales|inconsistente/i.test(err)) {
    return { error: err, status: 400 };
  }
  if (code === 500) {
    return { error: err, status: 500 };
  }
  return { error: err, status: 502 };
}

export async function registerLoanPaymentInSupabase(
  payment: PaymentRow,
): Promise<RegisterLoanPaymentResult> {
  const amountCheck = validatePayAmount(payment.amount);
  if (!amountCheck.ok) {
    return { ok: false, error: amountCheck.error, status: 400 };
  }
  if (!(payment.ref || "").trim().startsWith("PG-")) {
    return { ok: false, error: "Referencia de pago inválida.", status: 400 };
  }
  if (!(payment.loanRef || "").trim()) {
    return { ok: false, error: "Falta el préstamo del cobro.", status: 400 };
  }

  const methodRaw = String(payment.method ?? "").trim().toLowerCase();
  if (!methodRaw || !/^(efectivo|nequi|banco|e|n|b)$/i.test(methodRaw)) {
    return { ok: false, error: "Método de pago inválido.", status: 400 };
  }
  const method = normalizePaymentMethod(payment.method);

  const client = createMirrorServerClient();
  if (!client) {
    const { configured: pub } = getSupabasePublicEnv();
    return {
      ok: false,
      error:
        pub && !mirrorUsesServiceRole()
          ? "service_role_missing"
          : "supabase_not_configured",
      status: 502,
    };
  }

  const prepared = await withDbEvidence({ ...payment, amount: amountCheck.amount, method });
  const part = paymentToRpcPart(prepared);
  if (!part) {
    return { ok: false, error: "Pago inválido para registrar.", status: 400 };
  }

  const rpc = await client.rpc("register_collection", {
    p_ref: part.ref,
    p_loan_ref: part.loan_ref,
    p_amount: part.amount,
    p_paid_date: part.paid_date,
    p_method: part.method,
    p_idempotency_key: part.idempotency_key,
    p_client_ref: part.client_ref,
    p_collector_ref: part.collector_ref,
    p_collector_name: part.collector_name,
    p_paid_time: part.paid_time,
    p_due_date: part.due_date,
    p_charge_label: part.charge_label,
    p_source: part.source,
    p_payment_type: part.payment_type,
    p_payment_kind: part.payment_kind,
    p_route_ref: part.route_ref,
    p_evidence: part.evidence ?? null,
  });

  if (rpc.error) {
    return { ok: false, error: rpc.error.message || "register_collection", status: 502 };
  }

  const body = rpc.data as RegisterCollectionRpcBody | null;
  if (!body || body.ok === false) {
    const mapped = mapRpcError(body, "register_collection");
    return { ok: false, ...mapped };
  }

  const registered =
    rpcPaymentToRow(body.payment as RpcPayment, prepared) ?? prepared;

  return {
    ok: true,
    duplicate: Boolean(body.duplicate),
    payments: [registered],
    balance: typeof body.balance === "number" ? body.balance : undefined,
    paid: typeof body.paid === "number" ? body.paid : undefined,
  };
}

export async function registerCombinedLoanPaymentInSupabase(
  parts: [PaymentRow, PaymentRow],
): Promise<RegisterLoanPaymentResult> {
  const [a, b] = parts;
  const checkA = validatePayAmount(a.amount);
  if (!checkA.ok) return { ok: false, error: `1.er tramo: ${checkA.error}`, status: 400 };
  const checkB = validatePayAmount(b.amount);
  if (!checkB.ok) return { ok: false, error: `2.º tramo: ${checkB.error}`, status: 400 };

  const methodA = normalizePaymentMethod(a.method);
  const methodB = normalizePaymentMethod(b.method);
  if (methodA === methodB) {
    return { ok: false, error: "Combinado requiere dos métodos distintos.", status: 400 };
  }
  if ((a.loanRef || "").trim() !== (b.loanRef || "").trim()) {
    return {
      ok: false,
      error: "Los tramos del combinado deben ser del mismo préstamo.",
      status: 400,
    };
  }

  const preparedA = await withDbEvidence({ ...a, amount: checkA.amount, method: methodA });
  const preparedB = await withDbEvidence({ ...b, amount: checkB.amount, method: methodB });
  const partA = paymentToRpcPart(preparedA);
  const partB = paymentToRpcPart(preparedB);
  if (!partA || !partB) {
    return { ok: false, error: "Pagos combinados inválidos.", status: 400 };
  }

  const client = createMirrorServerClient();
  if (!client) {
    const { configured: pub } = getSupabasePublicEnv();
    return {
      ok: false,
      error:
        pub && !mirrorUsesServiceRole()
          ? "service_role_missing"
          : "supabase_not_configured",
      status: 502,
    };
  }

  const rpc = await client.rpc("register_combined_collection", {
    p_part_a: partA,
    p_part_b: partB,
  });

  if (rpc.error) {
    if (
      /register_combined_collection|schema cache|PGRST202|Could not find the function/i.test(
        rpc.error.message || "",
      )
    ) {
      return {
        ok: false,
        error: "register_combined_collection_missing",
        status: 502,
      };
    }
    return {
      ok: false,
      error: rpc.error.message || "register_combined_collection",
      status: 502,
    };
  }

  const body = rpc.data as RegisterCollectionRpcBody | null;
  if (!body || body.ok === false) {
    const mapped = mapRpcError(body, "register_combined_collection");
    return { ok: false, ...mapped };
  }

  const rawPayments = Array.isArray(body.payments) ? body.payments : [];
  const payments: PaymentRow[] = [
    rpcPaymentToRow(rawPayments[0] as RpcPayment, preparedA) ?? preparedA,
    rpcPaymentToRow(rawPayments[1] as RpcPayment, preparedB) ?? preparedB,
  ];

  return {
    ok: true,
    duplicate: Boolean(body.duplicate),
    payments,
    balance: typeof body.balance === "number" ? body.balance : undefined,
    paid: typeof body.paid === "number" ? body.paid : undefined,
  };
}
