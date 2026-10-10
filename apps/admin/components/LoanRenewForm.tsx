"use client";

import { useMemo, useState } from "react";
import { LOAN_TERM_OPTIONS, isoToDisplay, type LoanTermMonths } from "@/lib/loan-preview";
import {
  defaultRenewalTerms,
  renewalPreview,
  renewalTermsError,
  type RenewalTerms,
} from "@/lib/loan-renew";
import { money, type LoanRow } from "@/lib/mock-data";

type Props = {
  loan: LoanRow;
  today: string;
  variant?: "sheet" | "inline";
  onCancel: () => void;
  /** Puede devolver Promise: el formulario espera y bloquea doble envío. */
  onConfirm: (terms: RenewalTerms) => void | Promise<void>;
};

function parsePercent(raw: string): number {
  const value = Number(String(raw).replace(",", ".").trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Renovar: lo que debe (fijo) + el porcentaje que se elija, con plazo y primer cobro.
 * Propone 20 % a 1 mes. No mueve plata: la deuda pasa al préstamo de continuación.
 */
export function LoanRenewForm({ loan, today, variant = "sheet", onCancel, onConfirm }: Props) {
  const inline = variant === "inline";
  const proposal = useMemo(() => renewalPreview(loan, today, defaultRenewalTerms()), [loan, today]);
  const [rawPercent, setRawPercent] = useState(String(defaultRenewalTerms().ratePercent));
  const [termMonths, setTermMonths] = useState<LoanTermMonths>(defaultRenewalTerms().termMonths);
  const [firstIso, setFirstIso] = useState(proposal?.preview.dates[0] ?? today);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const terms: RenewalTerms = {
    ratePercent: parsePercent(rawPercent),
    termMonths,
    firstCollectionIso: firstIso || undefined,
  };
  const termsError = renewalTermsError(terms, today);
  const built = termsError ? null : renewalPreview(loan, today, terms);
  const blockReason = termsError ?? (built ? null : "No se pudo armar el préstamo nuevo.");

  async function confirm() {
    if (isSubmitting || blockReason) return;
    setIsSubmitting(true);
    try {
      await onConfirm(terms);
    } finally {
      setIsSubmitting(false);
    }
  }

  const dates = built?.preview.dates ?? [];
  const dueIso = dates[dates.length - 1];

  return (
    <form
      className={inline ? "collector-pay-form collector-pay-inline loan-renew-form" : "collector-pay-form loan-renew-form"}
      onSubmit={(event) => {
        event.preventDefault();
        void confirm();
      }}
      aria-busy={isSubmitting}
    >
      <header className="collector-pay-head">
        <h2>Renovar {loan.ref}</h2>
        <p>{loan.client}</p>
      </header>

      <div className="collector-pay-facts">
        <div>
          <span>Debe</span>
          <b>{money(Math.trunc(loan.balance))}</b>
        </div>
      </div>

      <label className="collector-pay-field">
        <span>Porcentaje (%)</span>
        <input
          value={rawPercent}
          onChange={(event) => setRawPercent(event.target.value)}
          inputMode="decimal"
          disabled={isSubmitting}
          aria-label="Porcentaje de la renovación"
        />
      </label>

      <label className="collector-pay-field">
        <span>Plazo</span>
        <select
          value={termMonths}
          onChange={(event) => setTermMonths(Number(event.target.value))}
          disabled={isSubmitting}
          aria-label="Plazo de la renovación"
        >
          {LOAN_TERM_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="collector-pay-field">
        <span>Primer cobro</span>
        <input
          type="date"
          value={firstIso}
          min={today}
          onChange={(event) => setFirstIso(event.target.value)}
          disabled={isSubmitting}
          aria-label="Fecha del primer cobro"
        />
      </label>

      {built ? (
        <div className="collector-pay-facts">
          <div>
            <span>Interés</span>
            <b>{money(built.interest)}</b>
          </div>
          <div>
            <span>Total</span>
            <b>{money(built.preview.total)}</b>
          </div>
          <div>
            <span>Cuota</span>
            <b>
              {money(built.preview.installment)} × {built.preview.count}
            </b>
          </div>
          <div>
            <span>Vence</span>
            <b>{dueIso ? isoToDisplay(dueIso) : "—"}</b>
          </div>
        </div>
      ) : null}

      {blockReason ? (
        <p className="receipt-error" role="alert" aria-live="assertive">
          {blockReason}
        </p>
      ) : null}

      <div className={`form-actions collector-pay-actions${inline ? " is-links" : ""}`}>
        <button
          type="button"
          className={inline ? "collector-mobile-pay-link" : "btn compact"}
          disabled={isSubmitting}
          onClick={onCancel}
        >
          {inline ? "volver" : "Volver"}
        </button>
        <button
          type="submit"
          className={
            inline
              ? blockReason
                ? "collector-mobile-pay-link is-blocked"
                : "collector-mobile-pay-link"
              : "btn compact primary"
          }
          disabled={isSubmitting || Boolean(blockReason)}
          title="Sin plata: no toca la caja, Banco ni Nequi"
        >
          {isSubmitting ? (inline ? "guardando…" : "Guardando…") : inline ? "renovar" : "Renovar"}
        </button>
      </div>
    </form>
  );
}
