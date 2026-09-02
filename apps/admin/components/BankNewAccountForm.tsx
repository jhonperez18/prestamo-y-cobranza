"use client";

import { useState, type FormEvent } from "react";
import type { BankAccount, BankAccountType } from "@/lib/bank";
import {
  bankAccountTypeLabel,
  isBankAccountRefTaken,
  nextBankAccountRef,
  normalizeBankAccount,
  normalizeBankAccountRef,
} from "@/lib/bank";

type Props = {
  accounts: BankAccount[];
  onSave: (account: BankAccount) => void;
  onCancel: () => void;
  onToast: (message?: string) => void;
};

const ACCOUNT_TYPES: BankAccountType[] = ["corriente", "ahorros", "caja", "nequi", "otro"];

const COLOMBIA_PROVINCES = [
  "",
  "Amazonas",
  "Antioquia",
  "Arauca",
  "Atlántico",
  "Bogotá D.C.",
  "Bolívar",
  "Boyacá",
  "Caldas",
  "Caquetá",
  "Casanare",
  "Cauca",
  "Cesar",
  "Chocó",
  "Córdoba",
  "Cundinamarca",
  "Guainía",
  "Guaviare",
  "Huila",
  "La Guajira",
  "Magdalena",
  "Meta",
  "Nariño",
  "Norte de Santander",
  "Putumayo",
  "Quindío",
  "Risaralda",
  "San Andrés",
  "Santander",
  "Sucre",
  "Tolima",
  "Valle del Cauca",
  "Vaupés",
  "Vichada",
];

type FormState = {
  ref: string;
  name: string;
  bankName: string;
  accountNumber: string;
  accountType: BankAccountType;
  currency: string;
  status: "abierto" | "cerrado";
  country: string;
  province: string;
  address: string;
  openingBalance: string;
};

const EMPTY_FORM: FormState = {
  ref: "",
  name: "",
  bankName: "",
  accountNumber: "",
  accountType: "corriente",
  currency: "COP",
  status: "abierto",
  country: "Colombia (CO)",
  province: "",
  address: "",
  openingBalance: "",
};

export function BankNewAccountForm({ accounts, onSave, onCancel, onToast }: Props) {
  const suggestedRef = nextBankAccountRef(accounts);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ref: suggestedRef });

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ref = normalizeBankAccountRef(form.ref);
    if (!ref) {
      onToast("Indique la referencia de la cuenta.");
      return;
    }
    if (isBankAccountRefTaken(accounts, ref)) {
      onToast(`La referencia "${ref}" ya está en uso. Elija otra.`);
      return;
    }
    if (!form.name.trim()) {
      onToast("Indique la etiqueta de la cuenta o caja.");
      return;
    }
    const openingBalance = Number(form.openingBalance.replace(/\D/g, "")) || 0;
    const row = normalizeBankAccount({
      ref,
      name: form.name.trim(),
      bankName: form.bankName.trim() || "Sin banco",
      accountNumber: form.accountNumber.trim() || "Sin número",
      accountType: form.accountType,
      currency: form.currency,
      country: form.country,
      province: form.province,
      address: form.address.trim(),
      active: form.status === "abierto",
      openingBalance,
    });
    onSave(row);
    onToast(`Cuenta ${row.ref} creada.`);
  };

  return (
    <div className="bank-panel bank-new-account-panel">
      <form className="sheet bank-account-sheet" onSubmit={submit}>
        <div className="bank-form-banner">
          <span className="bank-form-banner-ico" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 10h18M5 10V20M9 10V20M15 10V20M19 10V20M2 20h20" />
              <path d="M12 3 2 10h20L12 3z" />
            </svg>
          </span>
          <h2>Nueva cuenta financiera</h2>
        </div>

        <div className="sheet-body">
          <div className="sheet-fields">
            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-ref">
                Ref.
              </label>
              <input
                id="bank-ref"
                required
                placeholder={`Ej. ${suggestedRef}, CAJA-01, Operativa`}
                value={form.ref}
                onChange={(event) => setField("ref", event.target.value)}
              />
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-label">
                Etiqueta cuenta o caja
              </label>
              <input
                id="bank-label"
                required
                placeholder="Ej. Cuenta operativa / Caja principal"
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
              />
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-type">
                Tipo de cuenta
              </label>
              <select
                id="bank-type"
                value={form.accountType}
                onChange={(event) => setField("accountType", event.target.value as BankAccountType)}
              >
                {ACCOUNT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {bankAccountTypeLabel(type)}
                  </option>
                ))}
              </select>
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-currency">
                Divisa
              </label>
              <select
                id="bank-currency"
                value={form.currency}
                onChange={(event) => setField("currency", event.target.value)}
              >
                <option value="COP">Colombia Peso ($)</option>
                <option value="USD">Dólar estadounidense (USD)</option>
                <option value="EUR">Euro (EUR)</option>
              </select>
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-status">
                Estado
              </label>
              <select
                id="bank-status"
                value={form.status}
                onChange={(event) =>
                  setField("status", event.target.value as FormState["status"])
                }
              >
                <option value="abierto">Abierto</option>
                <option value="cerrado">Cerrado</option>
              </select>
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-country">
                País de la cuenta
              </label>
              <select
                id="bank-country"
                value={form.country}
                onChange={(event) => setField("country", event.target.value)}
              >
                <option value="Colombia (CO)">Colombia (CO)</option>
                <option value="Estados Unidos (US)">Estados Unidos (US)</option>
                <option value="Otro">Otro</option>
              </select>
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-province">
                Provincia
              </label>
              <select
                id="bank-province"
                value={form.province}
                onChange={(event) => setField("province", event.target.value)}
              >
                {COLOMBIA_PROVINCES.map((province) => (
                  <option key={province || "none"} value={province}>
                    {province || "—"}
                  </option>
                ))}
              </select>
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-bank">
                Banco / entidad
              </label>
              <input
                id="bank-bank"
                placeholder="Ej. Bancolombia, Nequi…"
                value={form.bankName}
                onChange={(event) => setField("bankName", event.target.value)}
              />
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-number">
                Número de cuenta
              </label>
              <input
                id="bank-number"
                placeholder="Número o referencia"
                value={form.accountNumber}
                onChange={(event) => setField("accountNumber", event.target.value)}
              />
            </div>

            <div className="sheet-row">
              <label className="sheet-label" htmlFor="bank-balance">
                Saldo inicial
              </label>
              <input
                id="bank-balance"
                inputMode="numeric"
                placeholder="0"
                value={form.openingBalance}
                onChange={(event) => setField("openingBalance", event.target.value)}
              />
            </div>

            <div className="sheet-row sheet-row-top">
              <label className="sheet-label" htmlFor="bank-address">
                Domiciliación de cuenta
              </label>
              <textarea
                id="bank-address"
                rows={4}
                placeholder="Dirección o datos de domiciliación…"
                value={form.address}
                onChange={(event) => setField("address", event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="form-actions bank-account-actions">
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            Guardar cuenta
          </button>
        </div>
      </form>
    </div>
  );
}
