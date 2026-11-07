"use client";

import { useEffect, useMemo, useState } from "react";
import {
  installmentCountForTerm,
  isoToDisplay,
  LOAN_TERM_OPTIONS,
  type LoanTermMonths,
  type PayFrequency,
} from "@/lib/loan-preview";
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

function parseMoney(raw: string): number {
  const value = Number(String(raw).replace(/[^\d]/g, "").trim());
  return Number.isFinite(value) ? value : Number.NaN;
}

const TERM_OTRO = "otro";

/** Meses de plazo a partir de hoy → fecha final (misma regla de 30 días/mes del preview). */
function monthsFromDue(today: string, dueIso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !/^\d{4}-\d{2}-\d{2}$/.test(dueIso)) return 1;
  const start = Date.parse(`${today}T12:00:00Z`);
  const end = Date.parse(`${dueIso}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  return Math.max(1, Math.round(days / 30));
}

function applyTermMonthsChoice(
  months: number,
  setTermChoice: (value: string) => void,
  setRawOtherMonths: (value: string) => void,
) {
  const clean = Math.max(1, Math.trunc(months));
  if (LOAN_TERM_OPTIONS.some((option) => option.id === clean)) {
    setTermChoice(String(clean));
    return;
  }
  setTermChoice(TERM_OTRO);
  setRawOtherMonths(String(clean));
}

/**
 * Renovar: lo que debe (fijo) + el porcentaje que se elija, con plazo y primer cobro.
 * Propone 20 % a 1 mes. No mueve plata: la deuda pasa al préstamo de continuación.
 * Solo organiza la ficha; al confirmar sigue el mismo `RenewalTerms`.
 */
export function LoanRenewForm({ loan, today, variant = "sheet", onCancel, onConfirm }: Props) {
  const inline = variant === "inline";
  const proposal = useMemo(() => renewalPreview(loan, today, defaultRenewalTerms()), [loan, today]);
  const proposalDue = proposal?.preview.dates[proposal.preview.dates.length - 1] ?? today;
  const [rawPercent, setRawPercent] = useState(String(defaultRenewalTerms().ratePercent));
  const [termChoice, setTermChoice] = useState<string>(String(defaultRenewalTerms().termMonths));
  const [rawOtherMonths, setRawOtherMonths] = useState("4");
  const [firstIso, setFirstIso] = useState(proposal?.preview.dates[0] ?? today);
  const [dueIso, setDueIso] = useState(proposalDue);
  const [dueDirty, setDueDirty] = useState(false);
  const [rawCuota, setRawCuota] = useState("");
  const [cuotaDirty, setCuotaDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const frequency = (loan.frequency ?? "diario") as PayFrequency;
  const termMonths: LoanTermMonths =
    termChoice === TERM_OTRO
      ? Math.max(1, Math.trunc(Number(rawOtherMonths) || 0))
      : Math.max(1, Math.trunc(Number(termChoice) || 1));

  const terms: RenewalTerms = {
    ratePercent: parsePercent(rawPercent),
    termMonths,
    firstCollectionIso: firstIso || undefined,
  };
  const termsError = renewalTermsError(terms, today);
  const built = termsError ? null : renewalPreview(loan, today, terms);
  const blockReason = termsError ?? (built ? null : "No se pudo armar el préstamo nuevo.");

  const suggestedCuota = built?.preview.installment ?? 0;
  const builtDates = built?.preview.dates ?? [];
  const builtDue = builtDates[builtDates.length - 1] ?? "";

  useEffect(() => {
    if (cuotaDirty) return;
    if (suggestedCuota > 0) setRawCuota(String(suggestedCuota));
  }, [suggestedCuota, cuotaDirty]);

  useEffect(() => {
    if (dueDirty) return;
    if (builtDue) setDueIso(builtDue);
  }, [builtDue, dueDirty]);

  function applyCuotaEdit(raw: string) {
    const cleaned = raw.replace(/[^\d]/g, "");
    setCuotaDirty(true);
    setRawCuota(cleaned);
    const cuota = parseMoney(cleaned);
    const capital = Math.trunc(loan.balance);
    const count = installmentCountForTerm(frequency, termMonths);
    if (!(cuota > 0) || !(capital > 0) || !(count > 0)) return;
    const interest = Math.max(0, cuota * count - capital);
    const rate = Math.round((interest / capital) * 10000) / 100;
    setRawPercent(String(rate));
  }

  function applyDueEdit(nextDue: string) {
    setDueDirty(true);
    setDueIso(nextDue);
    setCuotaDirty(false);
    if (!nextDue) return;
    applyTermMonthsChoice(monthsFromDue(today, nextDue), setTermChoice, setRawOtherMonths);
  }

  function touchPlazo(nextChoice: string) {
    setDueDirty(false);
    setCuotaDirty(false);
    setTermChoice(nextChoice);
  }

  async function confirm() {
    if (isSubmitting || blockReason) return;
    setIsSubmitting(true);
    try {
      await onConfirm(terms);
    } finally {
      setIsSubmitting(false);
    }
  }

  const shownDue = dueDirty ? dueIso : builtDue || dueIso;

  return (
    <form
      className={
        inline
          ? "collector-pay-form collector-pay-inline loan-renew-form"
          : "collector-pay-form loan-renew-form"
      }
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

      <div className="loan-renew-grid" role="group" aria-label="Condiciones de renovación">
        <label className="loan-renew-cell">
          <span>Debe</span>
          <b className="loan-renew-read">{money(Math.trunc(loan.balance))}</b>
        </label>
        <label className="loan-renew-cell">
          <span>Porcentaje</span>
          <input
            value={rawPercent}
            onChange={(event) => {
              setCuotaDirty(false);
              setRawPercent(event.target.value);
            }}
            inputMode="decimal"
            disabled={isSubmitting}
            aria-label="Porcentaje de la renovación"
          />
        </label>

        <label className="loan-renew-cell">
          <span>Plazo</span>
          <div className="loan-renew-plazo">
            <select
              value={termChoice}
              onChange={(event) => touchPlazo(event.target.value)}
              disabled={isSubmitting}
              aria-label="Plazo de la renovación"
            >
              {LOAN_TERM_OPTIONS.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.label}
                </option>
              ))}
              <option value={TERM_OTRO}>Otro</option>
            </select>
            {termChoice === TERM_OTRO ? (
              <input
                value={rawOtherMonths}
                onChange={(event) => {
                  setDueDirty(false);
                  setCuotaDirty(false);
                  setRawOtherMonths(event.target.value.replace(/[^\d]/g, ""));
                }}
                inputMode="numeric"
                disabled={isSubmitting}
                aria-label="Meses personalizados"
                placeholder="Meses"
              />
            ) : null}
          </div>
        </label>
        <label className="loan-renew-cell">
          <span>Cuota</span>
          <input
            value={rawCuota}
            onChange={(event) => applyCuotaEdit(event.target.value)}
            inputMode="numeric"
            disabled={isSubmitting}
            aria-label="Cuota de la renovación"
          />
        </label>

        <label className="loan-renew-cell">
          <span>Primer cobro</span>
          <input
            type="date"
            value={firstIso}
            min={today}
            onChange={(event) => {
              setDueDirty(false);
              setCuotaDirty(false);
              setFirstIso(event.target.value);
            }}
            disabled={isSubmitting}
            aria-label="Fecha del primer cobro"
          />
        </label>
        <label className="loan-renew-cell">
          <span>Fecha final</span>
          <input
            type="date"
            value={shownDue}
            min={firstIso || today}
            onChange={(event) => applyDueEdit(event.target.value)}
            disabled={isSubmitting}
            aria-label="Fecha final de la renovación"
          />
        </label>
      </div>

      {built ? (
        <div className="loan-renew-summary" aria-label="Cómo queda">
          <div>
            <span>Inicio</span>
            <b>{isoToDisplay(today)}</b>
          </div>
          <div>
            <span>Vence</span>
            <b>{builtDue ? isoToDisplay(builtDue) : "—"}</b>
          </div>
          <div>
            <span>Interés</span>
            <b>{money(built.interest)}</b>
          </div>
          <div>
            <span>Cuota</span>
            <b>
              {money(built.preview.installment)}
              {built.preview.count > 1 ? ` × ${built.preview.count}` : ""}
            </b>
          </div>
          <div className="loan-renew-summary-total">
            <span>Total</span>
            <b>{money(built.preview.total)}</b>
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
