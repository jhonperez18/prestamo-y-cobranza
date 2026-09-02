"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ReceiptCapture } from "@/components/ReceiptCapture";
import {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  type PaymentMethod,
} from "@/lib/payment-method";
import {
  validatePaymentEvidence,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";
import { money } from "@/lib/mock-data";
import type { PayKind } from "@/lib/loan-pay";

export type CollectorPaySubmit = {
  amount: number;
  kind: PayKind;
  method: PaymentMethod;
  evidence: PaymentEvidenceRef[];
  idempotencyKey: string;
};

type Props = {
  clientName: string;
  amountDue: number;
  chargeLabel?: string;
  variant?: "sheet" | "inline";
  formId?: string;
  onCancel: () => void;
  onSubmit: (payload: CollectorPaySubmit) => void;
};

function parseAmount(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function CollectorPayForm({
  clientName,
  amountDue,
  chargeLabel,
  variant = "sheet",
  formId = "default",
  onCancel,
  onSubmit,
}: Props) {
  const [rawAmount, setRawAmount] = useState(String(amountDue > 0 ? amountDue : ""));
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [receipt, setReceipt] = useState<PaymentEvidenceRef | undefined>();
  const amount = parseAmount(rawAmount);
  const evidence = useMemo(() => (receipt ? [receipt] : []), [receipt]);
  const evidenceError = validatePaymentEvidence(method, evidence);
  const canSubmit = amount > 0 && !evidenceError;
  const inline = variant === "inline";
  const amountId = `collector-pay-amount-${formId}`;
  const methodName = `collector-pay-method-${formId}`;
  const receiptId = `collector-pay-receipt-${formId}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const kind: PayKind = amount >= amountDue && amountDue > 0 ? "cuota" : "abono";
    onSubmit({
      amount,
      kind,
      method: normalizePaymentMethod(method),
      evidence,
      idempotencyKey:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `mob-${Date.now()}`,
    });
  }

  return (
    <form
      className={inline ? "collector-pay-form collector-pay-inline" : "collector-pay-form"}
      onSubmit={handleSubmit}
    >
      {!inline ? (
        <>
          <header className="collector-pay-head">
            <h2>Registrar cobro</h2>
            <p>{clientName}</p>
            {chargeLabel ? <span className="collector-pay-concept">{chargeLabel}</span> : null}
          </header>

          <div className="collector-pay-facts">
            <div>
              <span>A cobrar</span>
              <b>{amountDue > 0 ? money(amountDue) : "—"}</b>
            </div>
          </div>

          <label className="collector-pay-field" htmlFor={amountId}>
            <span>Valor recibido</span>
            <input
              id={amountId}
              value={rawAmount}
              onChange={(event) => setRawAmount(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              autoFocus
            />
          </label>

          <p className="pay-choice-label">Forma de pago</p>
          <div
            className="pay-choice pay-method collector-pay-methods"
            role="radiogroup"
            aria-label="Forma de pago"
          >
            {PAYMENT_METHODS.map((entry) => (
              <label key={entry.id} className={method === entry.id ? "on" : undefined}>
                <input
                  type="radio"
                  name={methodName}
                  checked={method === entry.id}
                  onChange={() => {
                    setMethod(entry.id);
                    if (entry.id === "efectivo") setReceipt(undefined);
                  }}
                />
                <span>{entry.label}</span>
                <b>{entry.id === "nequi" ? "Requiere comprobante" : "En mano"}</b>
              </label>
            ))}
          </div>
        </>
      ) : (
        <div className="collector-pay-inline-row">
          <label className="collector-pay-field collector-pay-amount-col" htmlFor={amountId}>
            <span>Valor recibido</span>
            <input
              id={amountId}
              value={rawAmount}
              onChange={(event) => setRawAmount(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              autoFocus
            />
          </label>

          <div className="collector-pay-method-col">
            <p className="pay-choice-label">Forma de pago</p>
            <div
              className="pay-choice pay-method collector-pay-methods compact"
              role="radiogroup"
              aria-label="Forma de pago"
            >
              {PAYMENT_METHODS.map((entry) => (
                <label key={entry.id} className={method === entry.id ? "on" : undefined}>
                  <input
                    type="radio"
                    name={methodName}
                    checked={method === entry.id}
                    onChange={() => setMethod(entry.id)}
                  />
                  <span>{entry.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <ReceiptCapture
        id={receiptId}
        required={method === "nequi"}
        compact={inline}
        value={receipt}
        onChange={setReceipt}
        label={method === "nequi" ? "Comprobante Nequi" : "Evidencia del cobro"}
        hint={
          method === "nequi"
            ? "Toma foto con la cámara del comprobante Nequi"
            : "Opcional: foto del recibo o comprobante en efectivo"
        }
      />

      {evidenceError ? <p className="receipt-error">{evidenceError}</p> : null}

      <div className="form-actions collector-pay-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn primary" disabled={!canSubmit}>
          Confirmar cobro
        </button>
      </div>
    </form>
  );
}
