/**
 * Origen del desembolso (≠ método de cobro del cliente):
 * - nequi / banco = sale de la cuenta del dueño (Haber en banco / resta pool Nequi)
 * - efectivo = sale de la caja del cobrador
 */
import { displayToIso } from "@/lib/loan-preview";
import {
  paymentsForCollector,
  routesForCollector,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import { normalizePaymentMethod } from "@/lib/payment-method";

/** Marcadores estables en notes para sobrevivir mirror sin columna DB. */
export const NEQUI_FUNDED_MARKER = "[[fb:nequi]]";
export const EFECTIVO_FUNDED_MARKER = "[[fb:efectivo]]";
export const BANCO_FUNDED_MARKER = "[[fb:banco]]";

const FUNDED_MARKERS = [
  NEQUI_FUNDED_MARKER,
  EFECTIVO_FUNDED_MARKER,
  BANCO_FUNDED_MARKER,
] as const;

export type LoanDisbursementSource = "nequi" | "efectivo" | "banco";

export function loanDisbursementSource(
  loan: Pick<LoanRow, "fundedBy" | "notes">,
): LoanDisbursementSource | null {
  if (loan.fundedBy === "nequi" || loan.notes?.includes(NEQUI_FUNDED_MARKER)) return "nequi";
  if (loan.fundedBy === "efectivo" || loan.notes?.includes(EFECTIVO_FUNDED_MARKER)) {
    return "efectivo";
  }
  if (loan.fundedBy === "banco" || loan.notes?.includes(BANCO_FUNDED_MARKER)) return "banco";
  return null;
}

export function loanFundedByNequi(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "nequi";
}

export function loanFundedByEfectivo(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "efectivo";
}

export function loanFundedByBanco(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "banco";
}

function withFundedMarker(notes: string | undefined, marker: string) {
  const cleaned = stripFundedMarkers(notes);
  if (cleaned.includes(marker)) return cleaned;
  return [cleaned, marker].filter(Boolean).join("\n");
}

/** Quita marcadores [[fb:…]] del cajón de observaciones (el origen va en fundedBy). */
export function stripFundedMarkers(notes: string | undefined): string {
  return (notes || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !(FUNDED_MARKERS as readonly string[]).includes(line))
    .join("\n")
    .trim();
}

/** Marca desembolso financiado con Nequi (alta o renovación desde supervisor/admin). */
export function markLoanFundedByNequi(loan: LoanRow): LoanRow {
  return {
    ...loan,
    fundedBy: "nequi",
    notes: withFundedMarker(loan.notes, NEQUI_FUNDED_MARKER),
  };
}

/** Marca desembolso en efectivo desde caja del cobrador. */
export function markLoanFundedByEfectivo(loan: LoanRow): LoanRow {
  return {
    ...loan,
    fundedBy: "efectivo",
    notes: withFundedMarker(loan.notes, EFECTIVO_FUNDED_MARKER),
  };
}

/** Marca desembolso financiado desde cuenta bancaria del dueño. */
export function markLoanFundedByBanco(loan: LoanRow): LoanRow {
  return {
    ...loan,
    fundedBy: "banco",
    notes: withFundedMarker(loan.notes, BANCO_FUNDED_MARKER),
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
  if (source === "banco") return "Banco";
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

/** Abono registrado en el panel (Caja / oficina), no en la ruta del cobrador. */
function isOfficePayment(row: PaymentRow) {
  if (row.source === "caja") return true;
  return (row.collector || "").trim().toLowerCase() === "caja / oficina";
}

export function sumCollectorNequiIngresos(
  payments: PaymentRow[],
  collectors: CollectorRow[],
  collectorRefs?: Iterable<string>,
): number {
  const refs = collectorRefs
    ? new Set([...collectorRefs].filter(Boolean))
    : new Set(collectors.map((row) => row.ref).filter(Boolean));
  const seen = new Set<string>();
  let sum = 0;
  const add = (row: PaymentRow) => {
    if (!row.ref || seen.has(row.ref) || row.voidedAt?.trim()) return;
    if (normalizePaymentMethod(row.method) !== "nequi") return;
    const amount = Number(row.amount) || 0;
    if (amount <= 0) return;
    seen.add(row.ref);
    sum += amount;
  };
  if (refs.size > 0) {
    for (const ref of refs) {
      for (const row of paymentsForCollector(ref, collectors, payments)) add(row);
    }
  }
  for (const row of payments) {
    if (isOfficePayment(row)) add(row);
  }
  return sum;
}

/**
 * Cobros del cobrador más abonos Nequi hechos en el sistema
 * a clientes de sus rutas (mismo día en la ficha Nequi).
 */
export function paymentsForCollectorIncludingOffice(
  collectorRef: string,
  collectors: CollectorRow[],
  payments: PaymentRow[],
  clients: ClientRow[],
  loans: LoanRow[],
  routes: RouteRow[],
): PaymentRow[] {
  const mine = paymentsForCollector(collectorRef, collectors, payments);
  const seen = new Set(mine.map((row) => row.ref));
  const routeNames = new Set(
    routesForCollector(collectorRef, routes)
      .map((row) => (row.name || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!routeNames.size) return mine;
  const clientRefs = new Set(
    clients
      .filter((row) => routeNames.has((row.route || "").trim().toLowerCase()))
      .map((row) => row.ref),
  );
  if (!clientRefs.size) return mine;
  const loanRefs = new Set(
    loans.filter((row) => row.clientRef && clientRefs.has(row.clientRef)).map((row) => row.ref),
  );
  const names = new Set(
    clients
      .filter((row) => clientRefs.has(row.ref))
      .flatMap((row) => {
        const full = `${row.name} ${row.lastName}`.trim().toLowerCase();
        const nick = (row.name || "").trim().toLowerCase();
        return [full, nick].filter(Boolean);
      }),
  );
  const extra = payments.filter((row) => {
    if (!row.ref || seen.has(row.ref) || row.voidedAt?.trim()) return false;
    if (!isOfficePayment(row)) return false;
    if (normalizePaymentMethod(row.method) !== "nequi") return false;
    if (!((row.amount ?? 0) > 0)) return false;
    if (row.loanRef && loanRefs.has(row.loanRef)) return true;
    return names.has((row.client || "").trim().toLowerCase());
  });
  return extra.length ? [...mine, ...extra] : mine;
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
