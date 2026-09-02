"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import type { BankAccount } from "@/lib/bank";
import { displayToday } from "@/lib/bank";
import { createMiscPayment, updateMiscPayment, type MiscPayment } from "@/lib/misc-payments";
import {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  type PaymentMethod,
} from "@/lib/payment-method";

type Props = {
  bankAccounts: BankAccount[];
  existing: MiscPayment[];
  payment?: MiscPayment | null;
  onSave: (payment: MiscPayment) => void;
  onCancel: () => void;
  onToast: (message?: string) => void;
};

type FormState = {
  paidDate: string;
  label: string;
  amount: string;
  bankAccountRef: string;
  method: PaymentMethod;
};

export function MiscPaymentNewForm({
  bankAccounts,
  existing,
  payment = null,
  onSave,
  onCancel,
  onToast,
}: Props) {
  const editing = Boolean(payment);
  const activeAccounts = useMemo(
    () => bankAccounts.filter((row) => row.active),
    [bankAccounts],
  );

  const [form, setForm] = useState<FormState>(() => ({
    paidDate: payment?.paidDate ?? displayToday(),
    label: payment?.label ?? "Pago varios",
    amount: payment ? String(payment.amount) : "",
    bankAccountRef: payment?.bankAccountRef ?? activeAccounts[0]?.ref ?? "",
    method: payment?.method ?? "efectivo",
  }));

  const methodHint = PAYMENT_METHODS.find((row) => row.id === form.method)?.hint ?? "";

  const setNow = () => {
    setForm((prev) => ({ ...prev, paidDate: displayToday() }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(form.amount.replace(/\D/g, ""));
    if (amount <= 0) {
      onToast("Indique el importe del pago.");
      return;
    }
    if (!form.bankAccountRef) {
      onToast("Seleccione una cuenta bancaria.");
      return;
    }
    const payload = {
      paidDate: form.paidDate,
      label: form.label,
      amount,
      bankAccountRef: form.bankAccountRef,
      method: normalizePaymentMethod(form.method),
    };
    const row = editing && payment
      ? updateMiscPayment(payment, payload)
      : createMiscPayment({ ...payload, existing });
    onSave(row);
    onToast(editing ? `Pago ${row.ref} actualizado.` : `Pago ${row.ref} registrado.`);
  };

  return (
    <section className="panel misc-payment-panel">
      <div className="head">
        <h1>{editing ? "Modificar pago varios" : "Nuevo pago varios"}</h1>
      </div>

      <form className="sheet misc-payment-sheet" onSubmit={submit}>
        <div className="sheet-body">
          <div className="sheet-fields">
            <div className="sheet-row">
              <label className="sheet-label" htmlFor="misc-paid-date">
                Fecha pago
              </label>
              <div className="misc-payment-date">
                <input
                  id="misc-paid-date"
                  type="date"
                  required
                  value={form.paidDate}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, paidDate: event.target.value }))
                  }
                />
                <button type="button" className="misc-payment-now" onClick={setNow}>
                  Ahora
                </button>
              </div>
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="misc-label">
                Etiqueta
              </label>
              <input
                id="misc-label"
                required
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
              />
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="misc-amount">
                Importe
              </label>
              <input
                id="misc-amount"
                inputMode="numeric"
                required
                placeholder="0"
                value={form.amount}
                onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              />
            </div>

            <div className="sheet-row">
              <span className="sheet-label">Cuenta bancaria</span>
              <div className="misc-payment-field-with-icon">
                <span className="misc-payment-bank-ico" aria-hidden>
                  <Icon name="bank" />
                </span>
                <select
                  id="misc-bank-account"
                  required
                  value={form.bankAccountRef}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, bankAccountRef: event.target.value }))
                  }
                >
                  {activeAccounts.length === 0 ? (
                    <option value="">Sin cuentas activas</option>
                  ) : (
                    activeAccounts.map((account) => (
                      <option key={account.ref} value={account.ref}>
                        {account.name} · {account.bankName}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="sheet-row">
              <span className="sheet-label">Forma de pago</span>
              <div className="misc-payment-field-with-icon">
                <select
                  id="misc-method"
                  value={form.method}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      method: normalizePaymentMethod(event.target.value),
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.label}
                    </option>
                  ))}
                </select>
                <span className="misc-payment-info" title={methodHint} aria-label={methodHint}>
                  i
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions misc-payment-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            {editing ? "Guardar cambios" : "Guardar pago"}
          </button>
        </div>
      </form>
    </section>
  );
}
