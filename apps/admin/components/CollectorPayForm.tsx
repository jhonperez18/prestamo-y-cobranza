"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ReceiptCapture } from "@/components/ReceiptCapture";
import { SignaturePad } from "@/components/SignaturePad";
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
  /** Saldo pendiente del préstamo: se puede pagar hasta este valor (cancelar todo). */
  balance?: number;
  chargeLabel?: string;
  variant?: "sheet" | "inline";
  formId?: string;
  /** Solo activo cuando el plazo del préstamo ya venció. */
  canRenew?: boolean;
  onCancel: () => void;
  onSubmit: (payload: CollectorPaySubmit) => void;
  onRenew?: () => void;
};

function parseAmount(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

/** Miles con punto (CO): 360000 → 360.000 */
function formatAmountInput(value: number | string) {
  const digits =
    typeof value === "number"
      ? Math.trunc(Math.abs(value)).toString()
      : value.replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function CollectorPayForm({
  clientName,
  amountDue,
  balance,
  chargeLabel,
  variant = "sheet",
  formId = "default",
  canRenew = false,
  onCancel,
  onSubmit,
  onRenew,
}: Props) {
  const maxAmount = balance != null && balance > 0 ? balance : 0;
  const [rawAmount, setRawAmount] = useState(
    amountDue > 0 ? formatAmountInput(amountDue) : "",
  );
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [evidenceItem, setEvidenceItem] = useState<PaymentEvidenceRef | undefined>();
  const [attempted, setAttempted] = useState(false);
  const amount = parseAmount(rawAmount);
  const evidence = useMemo(() => (evidenceItem ? [evidenceItem] : []), [evidenceItem]);
  const evidenceError = validatePaymentEvidence(method, evidence);
  const overBalance = maxAmount > 0 && amount > maxAmount;
  const amountError =
    amount <= 0 ? "Indique el valor recibido." : overBalance ? "El valor no puede superar el saldo." : null;
  const blockReason = amountError || evidenceError;
  const canSubmit = !blockReason;
  const inline = variant === "inline";
  const amountId = `collector-pay-amount-${formId}`;
  const methodName = `collector-pay-method-${formId}`;
  const receiptId = `collector-pay-receipt-${formId}`;

  function setAmountFromInput(raw: string) {
    setRawAmount(formatAmountInput(raw));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
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
            {maxAmount > 0 ? (
              <div>
                <span>Saldo</span>
                <b>{money(maxAmount)}</b>
              </div>
            ) : null}
          </div>

          <label className="collector-pay-field" htmlFor={amountId}>
            <span>Valor recibido</span>
            <input
              id={amountId}
              value={rawAmount}
              onChange={(event) => setAmountFromInput(event.target.value)}
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
                    setEvidenceItem(undefined);
                  }}
                />
                <span>{entry.label}</span>
                <b>{entry.id === "nequi" ? "Requiere comprobante" : "Requiere firma"}</b>
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="collector-pay-inline-row">
            <label className="collector-pay-field collector-pay-amount-col" htmlFor={amountId}>
              <span>Valor recibido</span>
              <input
                id={amountId}
                value={rawAmount}
                onChange={(event) => setAmountFromInput(event.target.value)}
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
                      onChange={() => {
                        setMethod(entry.id);
                        setEvidenceItem(undefined);
                      }}
                    />
                    <span>{entry.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {method === "nequi" ? (
        <ReceiptCapture
          id={receiptId}
          required
          compact={inline}
          value={evidenceItem}
          onChange={setEvidenceItem}
          label="Comprobante Nequi"
          hint="Toma foto con la cámara del comprobante Nequi"
        />
      ) : (
        <SignaturePad
          required
          compact={inline}
          value={evidenceItem}
          onChange={setEvidenceItem}
        />
      )}

      {blockReason && (attempted || evidenceItem || amount > 0) ? (
        <p className="receipt-error" role="alert">
          {blockReason}
        </p>
      ) : !inline && !evidenceItem ? (
        <p className="collector-pay-hint">
          {method === "nequi"
            ? "Adjunta el comprobante Nequi para confirmar."
            : "El cliente debe firmar para confirmar el cobro."}
        </p>
      ) : null}

      <div className={`form-actions collector-pay-actions${inline ? " is-links" : ""}`}>
        <button
          type="button"
          className={inline ? "collector-mobile-pay-link" : "btn compact"}
          onClick={onCancel}
        >
          {inline ? "cerrar" : "Cancelar"}
        </button>
        <button
          type="submit"
          className={inline ? "collector-mobile-pay-link" : "btn compact primary"}
          disabled={!canSubmit}
          title={blockReason ?? undefined}
        >
          {inline ? "confirmar" : "Confirmar"}
        </button>
        {onRenew ? (
          <button
            type="button"
            className={
              inline
                ? "collector-mobile-pay-link collector-pay-renew-link"
                : "btn compact secondary"
            }
            disabled={!canRenew}
            title={
              canRenew
                ? "Renueva el saldo + 20% a 1 mes"
                : "Disponible cuando se cumpla el plazo del préstamo"
            }
            onClick={onRenew}
          >
            {inline ? "renovar" : "Renovar"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
