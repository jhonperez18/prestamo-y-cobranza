"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { newComboGroupId } from "@/lib/payment-combo";
import { newIdempotencyKey } from "@/lib/finance";
import { money } from "@/lib/mock-data";
import type { PayKind } from "@/lib/loan-pay";
import { isNavQuiet } from "@/lib/suppress-ghost-click";
import type { CollectorPaySubmit } from "@/lib/collector-pay-submit";

export type { CollectorPaySubmit } from "@/lib/collector-pay-submit";

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
  /** Combinado lo pinta la fila del nombre (antes del billete). */
  combined?: boolean;
  onCombinedChange?: (next: boolean) => void;
  comboInHeader?: boolean;
  /** N/P: hoy no tiene plata. No crea cobro. */
  onNoPay?: () => void;
  onCancel: () => void;
  /** Puede devolver Promise: el formulario espera y bloquea doble envío. */
  onSubmit: (payload: CollectorPaySubmit) => void | Promise<void>;
  onRenew?: () => void | Promise<void>;
};

type ComboLeg = {
  method: PaymentMethod | null;
  rawAmount: string;
  evidenceItem: PaymentEvidenceRef | undefined;
};

/**
 * Monto COP entero. Acepta pegado con puntos/comas (miles o decimales)
 * y siempre trunca a enteros positivos.
 */
function parseAmount(raw: string): number {
  const text = String(raw ?? "").trim().replace(/\s/g, "");
  if (!text) return 0;

  let normalized = text;
  const lastDot = normalized.lastIndexOf(".");
  const lastComma = normalized.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es decimal; el otro, miles.
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const parts = normalized.split(",");
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1] ?? "")) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (lastDot >= 0) {
    const parts = normalized.split(".");
    // Un solo punto con 1–2 decimales → decimal; si no, puntos de miles (CO).
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1] ?? "")) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = normalized.replace(/\./g, "");
    }
  }

  normalized = normalized.replace(/[^\d.]/g, "");
  if (!normalized || normalized === ".") return 0;
  const value = Number(normalized);
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/** Miles con punto (CO): 360000 → 360.000 */
function formatAmountInput(value: number | string): string {
  const digits =
    typeof value === "number"
      ? Number.isFinite(value)
        ? Math.trunc(Math.abs(value)).toString()
        : ""
      : String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const asNumber = Number(digits);
  if (Number.isNaN(asNumber) || !Number.isFinite(asNumber)) return "";
  return Math.trunc(asNumber)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function emptyLeg(): ComboLeg {
  return { method: null, rawAmount: "", evidenceItem: undefined };
}

export function CollectorPayForm({
  clientName,
  amountDue,
  balance,
  chargeLabel,
  variant = "sheet",
  formId = "default",
  canRenew = false,
  combined: combinedProp,
  onCombinedChange,
  comboInHeader = false,
  onNoPay,
  onCancel,
  onSubmit,
  onRenew,
}: Props) {
  const maxAmount = balance != null && balance > 0 ? balance : 0;
  const [internalCombined, setInternalCombined] = useState(false);
  const combined = combinedProp ?? internalCombined;
  const [noPay, setNoPay] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [rawAmount, setRawAmount] = useState(
    amountDue > 0 ? formatAmountInput(amountDue) : "",
  );
  const [evidenceItem, setEvidenceItem] = useState<PaymentEvidenceRef | undefined>();
  const [legA, setLegA] = useState<ComboLeg>(emptyLeg);
  const [legB, setLegB] = useState<ComboLeg>(emptyLeg);
  /** Tras firma/foto del 1.er tramo, se habilita el 2.º. */
  const [legALocked, setLegALocked] = useState(false);
  const [attempted, setAttempted] = useState(false);
  /** Bloquea Confirmar / Renovar / N/P mientras corre el commit. */
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (combined) {
      setNoPay(false);
      setMethod(null);
      setEvidenceItem(undefined);
      setLegA(emptyLeg());
      setLegB(emptyLeg());
      setLegALocked(false);
      return;
    }
    setLegA(emptyLeg());
    setLegB(emptyLeg());
    setLegALocked(false);
  }, [combined]);

  const amount = parseAmount(rawAmount);
  const evidence = useMemo(() => (evidenceItem ? [evidenceItem] : []), [evidenceItem]);
  const amountA = parseAmount(legA.rawAmount);
  const amountB = parseAmount(legB.rawAmount);
  const evidenceA = useMemo(
    () => (legA.evidenceItem ? [legA.evidenceItem] : []),
    [legA.evidenceItem],
  );
  const evidenceB = useMemo(
    () => (legB.evidenceItem ? [legB.evidenceItem] : []),
    [legB.evidenceItem],
  );

  const methodError = !combined && !noPay && !method ? "Seleccione la forma de pago." : null;
  const evidenceError =
    !combined && !noPay && method ? validatePaymentEvidence(method, evidence) : null;
  const overBalance = maxAmount > 0 && amount > maxAmount;
  const amountError =
    !combined && !noPay
      ? amount <= 0
        ? "Indique el valor recibido."
        : overBalance
          ? "El valor no puede superar el saldo."
          : null
      : null;

  const comboMethodError = combined
    ? !legA.method || !legB.method
      ? "Elegí dos métodos de pago."
      : normalizePaymentMethod(legA.method) === normalizePaymentMethod(legB.method)
        ? "Los dos métodos deben ser distintos."
        : null
    : null;
  const comboTotal = amountA + amountB;
  const comboAmountError = combined
    ? amountA <= 0 || amountB <= 0
      ? "Indicá el valor de cada método."
      : maxAmount > 0 && comboTotal > maxAmount
        ? "La suma no puede superar el saldo."
        : null
    : null;
  const comboEvidenceAError =
    combined && legA.method ? validatePaymentEvidence(legA.method, evidenceA) : null;
  const comboEvidenceBError =
    combined && legALocked && legB.method
      ? validatePaymentEvidence(legB.method, evidenceB)
      : combined && !legALocked
        ? "Completá firma/foto del primer método para seguir."
        : null;

  const blockReason = combined
    ? comboMethodError || comboAmountError || comboEvidenceAError || comboEvidenceBError
    : methodError || amountError || evidenceError;
  const canSubmit = !blockReason && !isSubmitting;
  const inline = variant === "inline";
  const amountId = `collector-pay-amount-${formId}`;
  const methodName = `collector-pay-method-${formId}`;
  const receiptId = `collector-pay-receipt-${formId}`;
  const needsReceipt = method ? paymentMethodRequiresReceipt(method) : false;

  function setAmountFromInput(raw: string) {
    setRawAmount(formatAmountInput(raw));
  }

  function setCombined(next: boolean) {
    if (combinedProp === undefined) setInternalCombined(next);
    onCombinedChange?.(next);
    if (next) setNoPay(false);
  }

  function selectMethod(next: PaymentMethod) {
    setNoPay(false);
    setMethod(next);
    setEvidenceItem(undefined);
  }

  function selectNoPay() {
    setNoPay(true);
    setMethod(null);
    setEvidenceItem(undefined);
    setCombined(false);
  }

  function enableCombined() {
    setCombined(true);
    setMethod(null);
    setEvidenceItem(undefined);
    setLegA(emptyLeg());
    setLegB(emptyLeg());
    setLegALocked(false);
    setAttempted(false);
  }

  function disableCombined() {
    setCombined(false);
    setLegA(emptyLeg());
    setLegB(emptyLeg());
    setLegALocked(false);
    setAttempted(false);
  }

  /**
   * Cierra el 1.er tramo del combinado.
   * Siempre marca `attempted` antes de validar: si falta foto/firma, el error
   * se ve al instante (el botón ya no se deshabilita en silencio).
   */
  function lockFirstLeg() {
    if (isSubmitting) return;
    setAttempted(true);
    if (!legA.method || amountA <= 0) return;
    const err = validatePaymentEvidence(legA.method, evidenceA);
    if (err) return;
    if (
      legB.method &&
      normalizePaymentMethod(legB.method) === normalizePaymentMethod(legA.method)
    ) {
      return;
    }
    setLegALocked(true);
    setAttempted(false);
  }

  async function runSubmit(payload: CollectorPaySubmit) {
    setIsSubmitting(true);
    try {
      await onSubmit(payload);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setAttempted(true);
    if (blockReason) return;

    if (noPay) {
      if (!onNoPay) return;
      setIsSubmitting(true);
      try {
        await onNoPay();
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (combined && legA.method && legB.method) {
      const total = amountA + amountB;
      const kind: PayKind = total >= amountDue && amountDue > 0 ? "cuota" : "abono";
      const comboGroupId = newComboGroupId();
      const paidTime = new Date().toLocaleTimeString("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
      });
      await runSubmit({
        amount: total,
        kind,
        method: normalizePaymentMethod(legA.method),
        evidence: evidenceA,
        idempotencyKey: newIdempotencyKey("mob-cmb"),
        combined: {
          comboGroupId,
          paidTime,
          parts: [
            {
              amount: amountA,
              method: normalizePaymentMethod(legA.method),
              evidence: evidenceA,
              idempotencyKey: newIdempotencyKey("mob-cmb-a"),
            },
            {
              amount: amountB,
              method: normalizePaymentMethod(legB.method),
              evidence: evidenceB,
              idempotencyKey: newIdempotencyKey("mob-cmb-b"),
            },
          ],
        },
      });
      return;
    }

    if (!method) return;
    const kind: PayKind = amount >= amountDue && amountDue > 0 ? "cuota" : "abono";
    await runSubmit({
      amount,
      kind,
      method: normalizePaymentMethod(method),
      evidence,
      idempotencyKey: newIdempotencyKey("mob"),
    });
  }

  /** Marca intento aunque el form aún no pueda enviarse (muestra el motivo). */
  function handleConfirmClick() {
    if (isSubmitting) return;
    setAttempted(true);
  }

  async function handleRenewClick() {
    if (!onRenew || !canRenew || isSubmitting || combined) return;
    setIsSubmitting(true);
    try {
      await onRenew();
    } finally {
      setIsSubmitting(false);
    }
  }

  function methodTone(id: PaymentMethod) {
    if (id === "efectivo") return "is-pay-efectivo";
    if (id === "nequi") return "is-pay-nequi";
    return "is-pay-banco";
  }

  const methodPicker = (
    <div
      className={`pay-choice pay-method collector-pay-methods${inline ? " compact" : ""}${onNoPay && !combined ? " has-np" : ""}`}
      role="radiogroup"
      aria-label="Forma de pago"
    >
      {PAYMENT_METHODS.map((entry) => (
        <label
          key={entry.id}
          className={[method === entry.id ? "on" : undefined, methodTone(entry.id)]
            .filter(Boolean)
            .join(" ")}
        >
          <input
            type="radio"
            name={methodName}
            checked={method === entry.id && !noPay}
            disabled={isSubmitting}
            onChange={() => selectMethod(entry.id)}
          />
          <span>{entry.label}</span>
        </label>
      ))}
      {onNoPay && !combined ? (
        <label className={noPay ? "on is-pay-np" : "is-pay-np"}>
          <input
            type="radio"
            name={methodName}
            checked={noPay}
            disabled={isSubmitting}
            onChange={selectNoPay}
          />
          <span>N/P</span>
        </label>
      ) : null}
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
        disabled={!method || isSubmitting}
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

  function renderComboLeg(
    leg: ComboLeg,
    setLeg: (next: ComboLeg) => void,
    opts: {
      label: string;
      locked: boolean;
      disabled: boolean;
      showLock?: boolean;
      amountId: string;
      receiptId: string;
      otherMethod: PaymentMethod | null;
    },
  ) {
    const needsPhoto = leg.method ? paymentMethodRequiresReceipt(leg.method) : false;
    return (
      <div
        className={`collector-pay-combo-leg${opts.locked ? " is-locked" : ""}${opts.disabled ? " is-disabled" : ""}`}
      >
        <div className="collector-pay-combo-leg-head">
          <span>{opts.label}</span>
          {opts.locked ? <em>listo</em> : null}
        </div>
        <div
          className="pay-choice pay-method collector-pay-methods compact collector-pay-combo-methods"
          role="radiogroup"
          aria-label={opts.label}
        >
          {PAYMENT_METHODS.map((entry) => {
            const blocked =
              opts.otherMethod != null &&
              normalizePaymentMethod(opts.otherMethod) === entry.id;
            return (
              <label
                key={entry.id}
                className={[
                  leg.method === entry.id ? "on" : undefined,
                  methodTone(entry.id),
                  blocked ? "is-blocked" : undefined,
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <input
                  type="radio"
                  name={`${methodName}-${opts.label}`}
                  checked={leg.method === entry.id}
                  disabled={opts.disabled || opts.locked || blocked || isSubmitting}
                  onChange={() =>
                    setLeg({ method: entry.id, rawAmount: leg.rawAmount, evidenceItem: undefined })
                  }
                />
                <span>{entry.label}</span>
              </label>
            );
          })}
        </div>
        <label className="collector-pay-field collector-pay-amount-only" htmlFor={opts.amountId}>
          <span className="sr-only">Valor {opts.label}</span>
          <input
            id={opts.amountId}
            value={leg.rawAmount}
            onChange={(event) =>
              setLeg({
                ...leg,
                rawAmount: formatAmountInput(event.target.value),
              })
            }
            inputMode="numeric"
            placeholder="0"
            disabled={opts.disabled || opts.locked || !leg.method || isSubmitting}
            aria-label={`Valor ${opts.label}`}
          />
        </label>
        {leg.method && !opts.disabled ? (
          needsPhoto ? (
            <ReceiptCapture
              id={opts.receiptId}
              required
              compact={inline}
              hideLabel
              value={leg.evidenceItem}
              onChange={(item) => setLeg({ ...leg, evidenceItem: item })}
              hint={inline ? undefined : "Foto del comprobante"}
            />
          ) : (
            <SignaturePad
              required
              compact={inline}
              hideLabel
              value={leg.evidenceItem}
              onChange={(item) => setLeg({ ...leg, evidenceItem: item })}
            />
          )
        ) : null}
        {opts.showLock &&
        !opts.locked &&
        !opts.disabled &&
        leg.method &&
        parseAmount(leg.rawAmount) > 0 ? (
          <button
            type="button"
            className="collector-mobile-pay-link collector-pay-combo-lock"
            disabled={isSubmitting}
            aria-label={needsPhoto ? "Guardar foto y seguir" : "Guardar firma y seguir"}
            title={
              comboEvidenceAError && attempted
                ? comboEvidenceAError
                : needsPhoto
                  ? "Guarda la foto del comprobante y pasa al 2.º método"
                  : "Guarda la firma y pasa al 2.º método"
            }
            onClick={lockFirstLeg}
          >
            {needsPhoto ? "guardar foto · seguir" : "guardar firma · seguir"}
          </button>
        ) : null}
      </div>
    );
  }

  const confirmTitle = isSubmitting
    ? "Guardando cobro…"
    : blockReason
      ? blockReason
      : inline
        ? "Confirmar cobro"
        : "Confirmar";

  return (
    <form
      className={
        inline
          ? `collector-pay-form collector-pay-inline${combined ? " is-combined" : ""}`
          : `collector-pay-form${combined ? " is-combined" : ""}`
      }
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      aria-busy={isSubmitting}
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
        </>
      ) : null}

      {comboInHeader ? null : (
        <div className="collector-pay-combo-toggle-row">
          {combined ? (
            <button
              type="button"
              className="collector-pay-combo-toggle on"
              disabled={isSubmitting}
              onClick={disableCombined}
            >
              Combinado
            </button>
          ) : (
            <button
              type="button"
              className="collector-pay-combo-toggle"
              disabled={isSubmitting}
              onClick={enableCombined}
            >
              Combinado
            </button>
          )}
          {combined ? (
            <span className="collector-pay-combo-hint">Dos métodos · misma hora</span>
          ) : null}
        </div>
      )}

      {combined ? (
        <div className="collector-pay-combo-legs">
          {renderComboLeg(legA, setLegA, {
            label: "1.º",
            locked: legALocked,
            disabled: false,
            showLock: true,
            amountId: `${amountId}-a`,
            receiptId: `${receiptId}-a`,
            otherMethod: legB.method,
          })}
          {renderComboLeg(legB, setLegB, {
            label: "2.º",
            locked: false,
            disabled: !legALocked,
            amountId: `${amountId}-b`,
            receiptId: `${receiptId}-b`,
            otherMethod: legA.method,
          })}
          {comboTotal > 0 ? (
            <p className="collector-pay-combo-sum">
              Suma {money(comboTotal)}
              {maxAmount > 0 ? ` · saldo ${money(maxAmount)}` : ""}
            </p>
          ) : null}
        </div>
      ) : noPay ? (
        methodPicker
      ) : (
        <>
          {methodPicker}
          {inline ? (
            <div className="collector-pay-inline-row">
              <div className="collector-pay-amount-col">{amountField}</div>
            </div>
          ) : (
            amountField
          )}
          {evidenceBlock}
        </>
      )}

      {attempted && blockReason ? (
        <p className="receipt-error" role="alert" aria-live="assertive">
          {blockReason}
        </p>
      ) : null}

      <div className={`form-actions collector-pay-actions${inline ? " is-links" : ""}`}>
        <button
          type="button"
          className={inline ? "collector-mobile-pay-link" : "btn compact"}
          disabled={isSubmitting}
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
          aria-label={confirmTitle}
          disabled={isSubmitting}
          title={confirmTitle}
          onClick={handleConfirmClick}
        >
          {isSubmitting ? (inline ? "guardando…" : "Guardando…") : inline ? "confirmar" : "Confirmar"}
        </button>
        {onRenew && !combined ? (
          <button
            type="button"
            className={
              inline
                ? "collector-mobile-pay-link collector-pay-renew-link"
                : "btn compact secondary"
            }
            disabled={!canRenew || isSubmitting}
            aria-disabled={!canRenew || isSubmitting}
            title={
              isSubmitting
                ? "Guardando…"
                : canRenew
                  ? "Renueva el saldo + 20% a 1 mes · capital sale de efectivo (caja)"
                  : "Disponible cuando se cumpla el plazo del préstamo"
            }
            onClick={() => {
              void handleRenewClick();
            }}
          >
            {inline ? "renovar" : "Renovar"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
