"use client";

import { useMemo, useState } from "react";
import {
  interestFromPct,
  QUICK_INTEREST_PCT,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";
import type { LoanDisbursementSource } from "@/lib/nequi-pool";
import {
  LOAN_TERM_OPTIONS,
  PAY_FREQUENCIES,
  previewLoanFlat,
  type LoanTermMonths,
  type PayFrequency,
} from "@/lib/loan-preview";
import { todayIso } from "@/lib/daily-dispatch";
import { money } from "@/lib/mock-data";

type Props = {
  clientName: string;
  clientRef: string;
  /**
   * Orígenes permitidos del desembolso.
   * Cobrador: solo efectivo. Supervisor/admin: nequi | banco.
   */
  fundedByOptions?: LoanDisbursementSource[];
  defaultFundedBy?: LoanDisbursementSource;
  onCancel: () => void;
  onSave: (draft: QuickLoanDraft) => void;
};

function parseMoney(raw: string) {
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatMiles(raw: string) {
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("es-CO");
}

const ORIGIN_LABEL: Record<LoanDisbursementSource, string> = {
  nequi: "Nequi",
  banco: "Banco",
  efectivo: "Efectivo",
};

export function QuickLoanForm({
  clientName,
  clientRef,
  fundedByOptions = ["nequi", "banco"],
  defaultFundedBy,
  onCancel,
  onSave,
}: Props) {
  const options =
    fundedByOptions.length > 0 ? fundedByOptions : (["nequi"] as LoanDisbursementSource[]);
  const initial =
    defaultFundedBy && options.includes(defaultFundedBy) ? defaultFundedBy : options[0];
  const [capitalRaw, setCapitalRaw] = useState("");
  const [ratePct, setRatePct] = useState<(typeof QUICK_INTEREST_PCT)[number]>(20);
  const [termMonths, setTermMonths] = useState<LoanTermMonths>(1);
  const [frequency, setFrequency] = useState<PayFrequency>("diario");
  const [fundedBy, setFundedBy] = useState<LoanDisbursementSource>(initial);

  const capital = parseMoney(capitalRaw);
  const interest = interestFromPct(capital, ratePct);
  const preview = useMemo(
    () =>
      previewLoanFlat({
        capital,
        interest,
        startIso: todayIso(),
        frequency,
        termMonths,
      }),
    [capital, interest, frequency, termMonths],
  );

  const canSave = Boolean(preview && capital > 0 && interest >= 0);
  const showOriginPicker = options.length > 1;

  return (
    <form
      className="quick-loan-form"
      aria-label={`Préstamo para ${clientName}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave || !preview) return;
        onSave({
          clientRef,
          capital,
          interest,
          rate: ratePct,
          frequency,
          termMonths,
          fundedBy,
        });
      }}
    >
      <div className="quick-loan-row">
        <label className="quick-loan-field">
          <span>Capital</span>
          <input
            inputMode="numeric"
            value={capitalRaw}
            onChange={(event) => setCapitalRaw(formatMiles(event.target.value))}
            placeholder="0"
            autoFocus
          />
        </label>

        <label className="quick-loan-field">
          <span>Interés</span>
          <select
            value={ratePct}
            onChange={(event) =>
              setRatePct(Number(event.target.value) as (typeof QUICK_INTEREST_PCT)[number])
            }
          >
            {QUICK_INTEREST_PCT.map((pct) => (
              <option key={pct} value={pct}>
                {pct}% ({money(interestFromPct(capital, pct), { symbol: false })})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="quick-loan-row">
        <label className="quick-loan-field">
          <span>Tiempo</span>
          <select
            value={termMonths}
            onChange={(event) => setTermMonths(Number(event.target.value) as LoanTermMonths)}
          >
            {LOAN_TERM_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="quick-loan-field">
          <span>Frecuencia</span>
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as PayFrequency)}
          >
            {PAY_FREQUENCIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {showOriginPicker ? (
        <label className="quick-loan-field">
          <span>Origen del desembolso</span>
          <select
            value={fundedBy}
            onChange={(event) => setFundedBy(event.target.value as LoanDisbursementSource)}
            aria-label="Origen del desembolso"
          >
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {ORIGIN_LABEL[opt]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="quick-loan-summary is-muted">
          Origen: {ORIGIN_LABEL[fundedBy]}
          {fundedBy === "efectivo" ? " · se descuenta de la caja" : ""}
        </p>
      )}

      {preview ? (
        <p className="quick-loan-summary">
          Total {money(preview.total, { symbol: false })} · Cuota{" "}
          {money(preview.installment, { symbol: false })} · {preview.count} cobros
        </p>
      ) : (
        <p className="quick-loan-summary is-muted">Ingrese el capital para ver la cuota.</p>
      )}

      <div className="quick-loan-actions">
        <button type="button" className="btn secondary" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={!canSave}>
          Crear préstamo
        </button>
      </div>
    </form>
  );
}
