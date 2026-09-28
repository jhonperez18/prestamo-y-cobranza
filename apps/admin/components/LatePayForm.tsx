"use client";

import { useMemo, useState, type FormEvent } from "react";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { cuotaTargetOn, validatePay } from "@/lib/loan-pay";
import { isoToDisplay } from "@/lib/loan-preview";
import { lateCuotaDates, type LatePaymentDraft } from "@/lib/commit-late-payment";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  normalizePaymentMethod,
} from "@/lib/payment-method";

type Props = {
  loan: LoanRow;
  payments: PaymentRow[];
  onCancel: () => void;
  onRegister: (draft: LatePaymentDraft) => Promise<boolean>;
};

function parseAmount(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function LatePayForm({ loan, payments, onCancel, onRegister }: Props) {
  const dates = useMemo(() => lateCuotaDates(loan, payments).reverse(), [loan, payments]);
  const [coversDate, setCoversDate] = useState(dates[0] ?? "");
  const target = coversDate ? cuotaTargetOn(loan, coversDate) : null;
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = raw ? parseAmount(raw) : target?.remaining ?? 0;
  const error = amount > 0 ? validatePay(loan, "cuota", amount) : null;
  const canRegister = Boolean(coversDate && target && amount > 0 && !error && reason.trim() && !busy);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRegister) return;
    setBusy(true);
    try {
      await onRegister({
        coversDate,
        amount,
        method: normalizePaymentMethod(method),
        reason: reason.trim(),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!dates.length) {
    return (
      <div className="pay-box">
        <h2>Pago tardío</h2>
        <p className="pick-hint">Este préstamo no tiene cuotas de días anteriores sin pago.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="pay-box" onSubmit={onSubmit}>
      <h2>Pago tardío</h2>
      <p className="pick-hint">
        La plata entra hoy a la caja del cobrador. Cubre la cuota del día elegido. El cierre de
        ese día no cambia, y la cuota de hoy sigue por cobrar.
      </p>

      <p className="pay-choice-label">Día de la cuota que no se registró</p>
      <div className="pay-choice" role="radiogroup" aria-label="Día de la cuota">
        {dates.map((date) => {
          const line = cuotaTargetOn(loan, date);
          return (
            <label key={date} className={coversDate === date ? "on" : undefined}>
              <input
                type="radio"
                name="late-date"
                checked={coversDate === date}
                onChange={() => {
                  setCoversDate(date);
                  setRaw("");
                }}
              />
              <span>{isoToDisplay(date)}</span>
              <b>{line ? money(line.remaining) : "—"}</b>
            </label>
          );
        })}
      </div>

      <p className="pay-choice-label">Monto</p>
      <div className="pay-choice" role="group" aria-label="Monto">
        <label className="on">
          <span aria-hidden="true" />
          <span>Valor</span>
          <input
            className="pay-other"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            inputMode="numeric"
            placeholder={target ? money(target.remaining) : "Escriba el valor"}
          />
        </label>
      </div>

      <p className="pay-choice-label">Forma de pago</p>
      <div className="pay-choice pay-method" role="radiogroup" aria-label="Forma de pago">
        {PAYMENT_METHODS.map((entry) => (
          <label key={entry.id} className={method === entry.id ? "on" : undefined}>
            <input
              type="radio"
              name="late-method"
              checked={method === entry.id}
              onChange={() => setMethod(entry.id)}
            />
            <span>{entry.label}</span>
          </label>
        ))}
      </div>

      <p className="pay-choice-label">Motivo (queda en el registro)</p>
      <div className="pay-choice" role="group" aria-label="Motivo">
        <label className="on">
          <span aria-hidden="true" />
          <input
            className="pay-other"
            style={{ gridColumn: "2 / 4" }}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej.: el cobrador lo recibió y no lo anotó"
          />
        </label>
      </div>

      {error ? <p className="pick-hint">{error}</p> : null}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={!canRegister}>
          {busy ? "Guardando…" : "Registrar pago tardío"}
        </button>
      </div>
    </form>
  );
}
