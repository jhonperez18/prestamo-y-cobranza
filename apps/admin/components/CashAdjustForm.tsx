"use client";

import { useState } from "react";
import { money } from "@/lib/mock-data";

type Props = {
  dateLabel: string;
  /** Saldo que selló el cierre de T. */
  calculated: number;
  /** Ajuste ya hecho hoy (re-editar corrige el mismo renglón). */
  currentReal?: number;
  currentReason?: string;
  onSubmit: (real: number, reason: string) => Promise<boolean>;
  onCancel: () => void;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

export function CashAdjustForm({
  dateLabel,
  calculated,
  currentReal,
  currentReason,
  onSubmit,
  onCancel,
}: Props) {
  const [realText, setRealText] = useState(currentReal == null ? "" : String(currentReal));
  const [reason, setReason] = useState(currentReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const real = realText ? Number(realText) : null;
  const delta = real == null ? null : real - calculated;

  async function submit() {
    if (busy) return;
    if (real == null) {
      setError("Escriba el saldo real contado.");
      return;
    }
    if (reason.trim().length < 3) {
      setError("Escriba el motivo del ajuste.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const ok = await onSubmit(real, reason.trim());
      if (!ok) setBusy(false);
    } catch (err) {
      console.error("cash-adjust-submit", err);
      setError("No se pudo guardar el ajuste.");
      setBusy(false);
    }
  }

  return (
    <form
      className="supervisor-nuevo-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="supervisor-mobile-subhead">
        Ajuste de saldo · T · {dateLabel}. Saldo del cierre: {money(calculated)}. El saldo real
        pasa a ser el Inicial de M de mañana.
      </p>
      {error ? <p className="supervisor-nuevo-msg">{error}</p> : null}
      <label className="quick-loan-field">
        <span>Saldo real</span>
        <input
          inputMode="numeric"
          value={realText}
          onChange={(event) => setRealText(digitsOnly(event.target.value))}
          placeholder={String(calculated)}
          autoFocus
          required
        />
      </label>
      {delta != null ? (
        <p className="supervisor-mobile-subhead">
          Diferencia: {delta > 0 ? "+" : delta < 0 ? "−" : ""}
          {money(Math.abs(delta), { symbol: false })}
        </p>
      ) : null}
      <label className="quick-loan-field">
        <span>Motivo</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Por qué cambia el saldo"
          required
        />
      </label>
      <div className="quick-loan-actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Guardando…" : "Guardar ajuste"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
