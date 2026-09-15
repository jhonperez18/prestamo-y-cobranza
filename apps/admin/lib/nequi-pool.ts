/**
 * Pool Nequi del negocio: cobros Nequi − capital desembolsado (préstamo/renovación).
 * Los desembolsos de supervisor/admin salen de Nequi (no de la caja del cobrador).
 */
import { displayToIso } from "@/lib/loan-preview";
import {
  paymentsForCollector,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import { normalizePaymentMethod } from "@/lib/payment-method";

/** Marcadores estables en notes para sobrevivir mirror sin columna DB. */
export const NEQUI_FUNDED_MARKER = "[[fb:nequi]]";
export const EFECTIVO_FUNDED_MARKER = "[[fb:efectivo]]";

export type LoanDisbursementSource = "nequi" | "efectivo";

export function loanDisbursementSource(
  loan: Pick<LoanRow, "fundedBy" | "notes">,
): LoanDisbursementSource | null {
  if (loan.fundedBy === "nequi" || loan.notes?.includes(NEQUI_FUNDED_MARKER)) return "nequi";
  if (loan.fundedBy === "efectivo" || loan.notes?.includes(EFECTIVO_FUNDED_MARKER)) {
    return "efectivo";
  }
  return null;
}

export function loanFundedByNequi(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "nequi";
}

export function loanFundedByEfectivo(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "efectivo";
}

function withFundedMarker(notes: string | undefined, marker: string, other: string) {
  const cleaned = (notes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== other)
    .join("\n");
  if (cleaned.includes(marker)) return cleaned;
  return [cleaned, marker].filter(Boolean).join("\n");
}

/** Marca desembolso financiado con Nequi (alta o renovación desde supervisor/admin). */
export function markLoanFundedByNequi(loan: LoanRow): LoanRow {
  return {
    ...loan,
    fundedBy: "nequi",
    notes: withFundedMarker(loan.notes, NEQUI_FUNDED_MARKER, EFECTIVO_FUNDED_MARKER),
  };
}

/** Marca desembolso en efectivo desde caja del cobrador. */
export function markLoanFundedByEfectivo(loan: LoanRow): LoanRow {
  return {
    ...loan,
    fundedBy: "efectivo",
    notes: withFundedMarker(loan.notes, EFECTIVO_FUNDED_MARKER, NEQUI_FUNDED_MARKER),
  };
}

export function hydrateLoanFundedBy(loan: LoanRow): LoanRow {
  const source = loanDisbursementSource(loan);
  if (!source) return loan;
  if (loan.fundedBy === source) return loan;
  return { ...loan, fundedBy: source };
}

export function loanDisbursementSourceLabel(source: LoanDisbursementSource | null) {
  if (source === "nequi") return "Nequi";
  if (source === "efectivo") return "Efectivo";
  return "—";
}

export function loanDisbursementMovementRef(loanRef: string) {
  return `DSB-${(loanRef || "").trim()}`;
}

export function sumNequiFundedDisbursements(loans: LoanRow[]): number {
  let sum = 0;
  for (const loan of loans) {
    if (!loanFundedByNequi(loan)) continue;
    const capital = Number(loan.capital) || 0;
    if (capital > 0) sum += capital;
  }
  return sum;
}

export function sumCollectorNequiIngresos(
  payments: PaymentRow[],
  collectors: CollectorRow[],
  collectorRefs?: Iterable<string>,
): number {
  const refs = collectorRefs
    ? new Set([...collectorRefs].filter(Boolean))
    : new Set(collectors.map((row) => row.ref).filter(Boolean));
  if (refs.size === 0) return 0;
  let sum = 0;
  for (const ref of refs) {
    for (const row of paymentsForCollector(ref, collectors, payments)) {
      if (normalizePaymentMethod(row.method) !== "nequi") continue;
      const amount = Number(row.amount) || 0;
      if (amount > 0) sum += amount;
    }
  }
  return sum;
}

/** Total acumulado Nequi = cobros Nequi − capitales desembolsados desde Nequi. */
export function nequiAcumuladoNet(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  collectors: CollectorRow[];
  collectorRefs?: Iterable<string>;
}): number {
  const ingresos = sumCollectorNequiIngresos(
    input.payments,
    input.collectors,
    input.collectorRefs,
  );
  return ingresos - sumNequiFundedDisbursements(input.loans);
}

export function loanDisbursementIsoDate(loan: LoanRow): string {
  return displayToIso(loan.date) || loan.date || "";
}
