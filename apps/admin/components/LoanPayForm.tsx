"use client";

import { useState, type FormEvent } from "react";
import { money, type LoanRow } from "@/lib/mock-data";
import { cuotaTarget, payHint, targetLabel, validatePay, type PayKind } from "@/lib/loan-pay";
import {
  PAYMENT_METHODS,
  type PaymentMethod,
  normalizePaymentMethod,
} from "@/lib/payment-method";

type Props = {
  loan: LoanRow;
  mode: PayKind;
  onCancel: () => void;
  onRegister: (amount: number, method: PaymentMethod) => void;
};

type PayChoice = "cuota" | "otro" | "todo";

function parseAmount(raw: string) {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

export function LoanPayForm({ loan, mode, onCancel, onRegister }: Props) {
  const target = cuotaTarget(loan);
  const cuotaValue = target?.remaining ?? 0;
  const totalHoy = loan.balance;
  const [choice, setChoice] = useState<PayChoice>(mode === "cuota" ? "cuota" : "otro");
  const [raw, setRaw] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("efectivo");
  const amount =
    choice === "cuota" ? cuotaValue : choice === "todo" ? totalHoy : parseAmount(raw);
  const title = mode === "cuota" ? "Pagar cuota" : "Abono";
  const error = amount > 0 ? validatePay(loan, mode, amount) : null;
  const hint = payHint(loan, mode, amount);
  const canRegister = amount > 0 && !error;
  const canTodo = mode === "cuota" && totalHoy > 0;
  const facts = [
    ["Capital inicial", money(loan.capital)],
    ["Valor cuota", cuotaValue > 0 ? money(cuotaValue) : "—"],
    ["Cuota en cobro", targetLabel(target)],
    ["Total del préstamo a la fecha", money(totalHoy)],
  ] as const;

  function pick(next: PayChoice) {
    setChoice(next);
    if (next !== "otro") setRaw("");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canRegister) return;
    onRegister(amount, normalizePaymentMethod(method));
  }

  return (
    <form className="pay-box" onSubmit={onSubmit}>
      <h2>{title}</h2>
      <div className="table-wrap">
        <table className="data mini-grid">
          <thead>
            <tr className="col-titles">
              <th>Concepto</th>
              <th className="right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {facts.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="money right">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="pay-choice-label">Monto a registrar</p>
      <div className="pay-choice" role="radiogroup" aria-label="Monto a registrar">
        <label className={choice === "cuota" ? "on" : undefined}>
          <input
            type="radio"
            name="pay-choice"
            checked={choice === "cuota"}
            disabled={cuotaValue <= 0}
            onChange={() => pick("cuota")}
          />
          <span>Valor cuota</span>
          <b>{cuotaValue > 0 ? money(cuotaValue) : "—"}</b>
        </label>
        <label className={choice === "otro" ? "on" : undefined}>
          <input type="radio" name="pay-choice" checked={choice === "otro"} onChange={() => pick("otro")} />
          <span>Otro monto</span>
          {choice === "otro" ? (
            <input
              id="pay-amount"
              className="pay-other"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              inputMode="numeric"
              placeholder="Escriba el valor"
              autoFocus
            />
          ) : (
            <b>—</b>
          )}
        </label>
        {canTodo ? (
          <label className={choice === "todo" ? "on" : undefined}>
            <input type="radio" name="pay-choice" checked={choice === "todo"} onChange={() => pick("todo")} />
            <span>Pagar todo</span>
            <b>{money(totalHoy)}</b>
          </label>
        ) : null}
      </div>

      <p className="pay-choice-label">Forma de pago</p>
      <div className="pay-choice pay-method" role="radiogroup" aria-label="Forma de pago">
        {PAYMENT_METHODS.map((entry) => (
          <label key={entry.id} className={method === entry.id ? "on" : undefined}>
            <input
              type="radio"
              name="pay-method"
              checked={method === entry.id}
              onChange={() => setMethod(entry.id)}
            />
            <span>{entry.label}</span>
            <b>{entry.hint}</b>
          </label>
        ))}
      </div>

      <p className="pick-hint">{hint}</p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={!canRegister}>
          Registrar
        </button>
      </div>
    </form>
  );
}
