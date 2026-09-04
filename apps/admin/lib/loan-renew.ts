import { todayIso } from "@/lib/daily-dispatch";
import {
  displayToIso,
  isoToDisplay,
  previewLoanFlat,
  type PayFrequency,
} from "@/lib/loan-preview";
import type { LoanRow } from "@/lib/mock-data";

export const RENEWAL_INTEREST_RATE = 0.2;
export const RENEWAL_TERM_MONTHS = 1 as const;

function pesos(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

/** Renovación disponible cuando ya venció el plazo y aún hay saldo. */
export function canRenewLoan(loan: LoanRow | null | undefined, today = todayIso()) {
  if (!loan || loan.balance <= 0) return false;
  if (loan.status === "Finalizado") return false;
  const dueIso = displayToIso(loan.due);
  if (!dueIso) return false;
  return dueIso <= today;
}

export function renewalPreview(loan: LoanRow, today = todayIso()) {
  const capital = pesos(loan.balance);
  if (capital <= 0) return null;
  const interest = pesos(capital * RENEWAL_INTEREST_RATE);
  const frequency = (loan.frequency ?? "diario") as PayFrequency;
  const preview = previewLoanFlat({
    capital,
    interest,
    startIso: today,
    frequency,
    termMonths: RENEWAL_TERM_MONTHS,
  });
  if (!preview) return null;
  return { capital, interest, frequency, preview };
}

export type LoanRenewalResult = {
  /** Préstamo anterior cerrado por renovación. */
  closed: LoanRow;
  /** Préstamo nuevo: saldo + 20% a 1 mes. */
  created: LoanRow;
};

/**
 * Genera un préstamo nuevo sobre el saldo (capital = saldo, +20%, 1 mes)
 * y cierra el préstamo vencido.
 */
export function buildRenewalLoans(
  source: LoanRow,
  newRef: string,
  today = todayIso(),
): LoanRenewalResult | null {
  if (!canRenewLoan(source, today)) return null;
  const built = renewalPreview(source, today);
  if (!built) return null;
  const { capital, interest, frequency, preview } = built;
  const dueIso = preview.dates[preview.dates.length - 1];
  const agreementTotal = source.total ?? source.capital + (source.interest ?? 0);

  const closed: LoanRow = {
    ...source,
    paid: Math.max(source.paid, agreementTotal),
    balance: 0,
    status: "Finalizado",
    kind: "paid",
    notes: source.notes?.trim()
      ? `${source.notes.trim()}\nCerrado por renovación → ${newRef}`
      : `Cerrado por renovación → ${newRef}`,
  };

  const created: LoanRow = {
    ref: newRef,
    clientRef: source.clientRef,
    client: source.client,
    date: isoToDisplay(today),
    due: dueIso ? isoToDisplay(dueIso) : source.due,
    capital,
    paid: 0,
    balance: preview.total,
    status: "Activo",
    kind: "ok",
    frequency,
    mode: "cuota_fija",
    pact: "valor",
    rate: 0,
    days: preview.days,
    interest,
    total: preview.total,
    installment: preview.installment,
    schedule: preview.schedule,
    notes: `Renovación de ${source.ref} · capital ${capital} + 20% (${interest}) · 1 mes`,
  };

  return { closed, created };
}

/** @deprecated Prefer buildRenewalLoans (préstamo nuevo). */
export function renewLoanFromBalance(loan: LoanRow, today = todayIso()): LoanRow | null {
  const result = buildRenewalLoans(loan, loan.ref, today);
  return result?.created ?? null;
}
