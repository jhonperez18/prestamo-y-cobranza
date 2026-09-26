"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  interestFromPct,
  type QuickLoanDraft,
} from "@/lib/street-client-loan";
import type { LoanDisbursementSource } from "@/lib/nequi-pool";
import {
  PAY_FREQUENCIES,
  previewLoanFlat,
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

/** Tasa % o plazo en meses: acepta coma/punto y decimales. */
function parseDecimal(raw: string): number {
  const n = Number(String(raw).trim().replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : NaN;
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
  const [rateRaw, setRateRaw] = useState("20");
  const [termRaw, setTermRaw] = useState("1");
  const [frequency, setFrequency] = useState<PayFrequency>("diario");
  const [fundedBy, setFundedBy] = useState<LoanDisbursementSource>(initial);
  const [cuotaRaw, setCuotaRaw] = useState("");
  const cuotaTouchedRef = useRef(false);

  const capital = parseMoney(capitalRaw);
  const ratePct = parseDecimal(rateRaw);
  const termMonths = parseDecimal(termRaw);
  const interest =
    Number.isFinite(ratePct) && ratePct >= 0 ? interestFromPct(capital, ratePct) : 0;
  const cuotaManual = parseMoney(cuotaRaw);

  const autoPreview = useMemo(
    () =>
      Number.isFinite(termMonths) && termMonths > 0
        ? previewLoanFlat({
            capital,
            interest,
            startIso: todayIso(),
            frequency,
            termMonths,
          })
        : null,
    [capital, interest, frequency, termMonths],
  );

  const preview = useMemo(
    () =>
      Number.isFinite(termMonths) && termMonths > 0
        ? previewLoanFlat({
            capital,
            interest,
            startIso: todayIso(),
            frequency,
            termMonths,
            installmentAmount:
              cuotaTouchedRef.current && cuotaManual > 0 ? cuotaManual : undefined,
          })
        : null,
    [capital, interest, frequency, termMonths, cuotaManual, cuotaRaw],
  );

  // Cuota automática al cambiar capital / interés / plazo / frecuencia (si el usuario no la fijó a mano).
  useEffect(() => {
    if (cuotaTouchedRef.current) return;
    if (!autoPreview?.installment) {
      setCuotaRaw("");
      return;
    }
    setCuotaRaw(formatMiles(String(autoPreview.installment)));
  }, [autoPreview?.installment]);

  const canSave = Boolean(
    preview &&
      capital > 0 &&
      interest >= 0 &&
      Number.isFinite(ratePct) &&
      ratePct >= 0 &&
      Number.isFinite(termMonths) &&
      termMonths > 0,
  );
  const showOriginPicker = options.length > 1;

  return (
    <form
      className="quick-loan-form is-compact"
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
          installmentAmount:
            cuotaManual > 0 ? cuotaManual : preview.installment > 0 ? preview.installment : undefined,
        });
      }}
    >
      <div className="quick-loan-row is-capital-terms">
        <label className="quick-loan-field">
          <span>Capital</span>
          <input
            inputMode="numeric"
            value={capitalRaw}
            onChange={(event) => {
              cuotaTouchedRef.current = false;
              setCapitalRaw(formatMiles(event.target.value));
            }}
            placeholder="0"
            autoFocus
          />
        </label>

        <label className="quick-loan-field is-tight">
          <span>Interés</span>
          <span className="quick-loan-input-with-suffix">
            <input
              inputMode="decimal"
              value={rateRaw}
              onChange={(event) => {
                cuotaTouchedRef.current = false;
                setRateRaw(event.target.value);
              }}
              placeholder="20"
              aria-label="Interés en porcentaje"
            />
            <em aria-hidden>%</em>
          </span>
        </label>

        <label className="quick-loan-field is-tight is-term">
          <span>Tiempo</span>
          <span className="quick-loan-input-with-suffix">
            <input
              inputMode="decimal"
              value={termRaw}
              onChange={(event) => {
                cuotaTouchedRef.current = false;
                setTermRaw(event.target.value);
              }}
              placeholder="1"
              aria-label="Tiempo en meses"
            />
            <em aria-hidden>mes</em>
          </span>
        </label>
      </div>

      <div className="quick-loan-row">
        <label className="quick-loan-field">
          <span>Frecuencia</span>
          <select
            value={frequency}
            onChange={(event) => {
              cuotaTouchedRef.current = false;
              setFrequency(event.target.value as PayFrequency);
            }}
          >
            {PAY_FREQUENCIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="quick-loan-row">
        <label className="quick-loan-field">
          <span>Cuota</span>
          <input
            inputMode="numeric"
            value={cuotaRaw}
            onChange={(event) => {
              const next = formatMiles(event.target.value);
              cuotaTouchedRef.current = Boolean(next);
              setCuotaRaw(next);
            }}
            placeholder="0"
            aria-label="Valor de la cuota"
          />
        </label>
        <div className="quick-loan-field is-summary-cell" aria-hidden={!preview}>
          <span>Total</span>
          <em>{preview ? money(preview.total, { symbol: false }) : "—"}</em>
        </div>
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
          {preview.count} cobros · cuota {money(preview.installment, { symbol: false })}
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
