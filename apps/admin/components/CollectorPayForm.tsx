"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ReceiptCapture } from "@/components/ReceiptCapture";
import { SignaturePad } from "@/components/SignaturePad";
import {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  paymentMethodRequiresReceipt,
  type PaymentMethod,
} from "@/lib/payment-method";
import {
  validatePaymentEvidence,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";
import { money } from "@/lib/mock-data";
import type { PayKind } from "@/lib/loan-pay";
import { isNavQuiet } from "@/lib/suppress-ghost-click";

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
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [rawAmount, setRawAmount] = useState(
    amountDue > 0 ? formatAmountInput(amountDue) : "",
  );
  const [evidenceItem, setEvidenceItem] = useState<PaymentEvidenceRef | undefined>();
  const [attempted, setAttempted] = useState(false);
  const amount = parseAmount(rawAmount);
  const evidence = useMemo(() => (evidenceItem ? [evidenceItem] : []), [evidenceItem]);
  const methodError = !method ? "Seleccione la forma de pago." : null;
  const evidenceError = method ? validatePaymentEvidence(method, evidence) : null;
  const overBalance = maxAmount > 0 && amount > maxAmount;
  const amountError =
    amount <= 0 ? "Indique el valor recibido." : overBalance ? "El valor no puede superar el saldo." : null;
  const blockReason = methodError || amountError || evidenceError;
  const canSubmit = !blockReason;
  const inline = variant === "inline";
  const amountId = `collector-pay-amount-${formId}`;
  const methodName = `collector-pay-method-${formId}`;
  const receiptId = `collector-pay-receipt-${formId}`;
  const needsReceipt = method ? paymentMethodRequiresReceipt(method) : false;

  function setAmountFromInput(raw: string) {
    setRawAmount(formatAmountInput(raw));
  }

  function selectMethod(next: PaymentMethod) {
    setMethod(next);
    setEvidenceItem(undefined);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (!canSubmit || !method) return;
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

  /** Siempre clickeable: si falta firma/valor, muestra el error en vez de “no hacer nada”. */
  function handleConfirmClick() {
    setAttempted(true);
  }

  const methodPicker = (
    <div
      className={`pay-choice pay-method collector-pay-methods${inline ? " compact" : ""}`}
      role="radiogroup"
      aria-label="Forma de pago"
    >
      {PAYMENT_METHODS.map((entry) => (
        <label
          key={entry.id}
          className={[
            method === entry.id ? "on" : undefined,
            entry.id === "efectivo"
              ? "is-pay-efectivo"
              : entry.id === "nequi"
                ? "is-pay-nequi"
                : "is-pay-banco",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <input
            type="radio"
            name={methodName}
            checked={method === entry.id}
            onChange={() => selectMethod(entry.id)}
          />
          <span>{entry.label}</span>
        </label>
      ))}
    </div>
  );

  const amountField = (
    <label className="collector-pay-field collector-pay-amount-only" htmlFor={amountId}>
      <span className="sr-only">Valor recibido</span>
      <input
        id={amountId}
        value={rawAmount}
        onChange={(event) => setAmountFromInput(event.target.value)}
        inputMode="numeric"
        placeholder="0"
        disabled={!method}
        aria-label="Valor recibido"
      />
    </label>
  );

  const evidenceBlock = !method ? null : needsReceipt ? (
    <ReceiptCapture
      id={receiptId}
      required
      compact={inline}
      hideLabel
      value={evidenceItem}
      onChange={setEvidenceItem}
      hint={inline ? undefined : "Tomá foto o buscá el archivo (p. ej. captura de WhatsApp)"}
    />
  ) : (
    <SignaturePad
      required
      compact={inline}
      hideLabel
      value={evidenceItem}
      onChange={setEvidenceItem}
    />
  );

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
              <span>Cuota</span>
              <b>{amountDue > 0 ? money(amountDue) : "—"}</b>
            </div>
            {maxAmount > 0 ? (
              <div>
                <span>Saldo</span>
                <b>{money(maxAmount)}</b>
              </div>
            ) : null}
          </div>

          {methodPicker}
          {amountField}
        </>
      ) : (
        <>
          {methodPicker}
          <div className="collector-pay-inline-row">
            <div className="collector-pay-amount-col">{amountField}</div>
          </div>
        </>
      )}

      {evidenceBlock}

      {attempted && blockReason ? (
        <p className="receipt-error" role="alert">
          {blockReason}
        </p>
      ) : null}

      <div className={`form-actions collector-pay-actions${inline ? " is-links" : ""}`}>
        <button
          type="button"
          className={inline ? "collector-mobile-pay-link" : "btn compact"}
          onClick={() => {
            if (isNavQuiet()) return;
            onCancel();
          }}
        >
          {inline ? "cerrar" : "Cancelar"}
        </button>
        <button
          type="submit"
          className={
            inline
              ? canSubmit
                ? "collector-mobile-pay-link"
                : "collector-mobile-pay-link is-blocked"
              : "btn compact primary"
          }
          aria-disabled={!canSubmit}
          disabled={!canSubmit}
          title={blockReason ?? undefined}
          onClick={handleConfirmClick}
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
                ? "Renueva el saldo + 20% a 1 mes · capital sale de efectivo (caja)"
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
