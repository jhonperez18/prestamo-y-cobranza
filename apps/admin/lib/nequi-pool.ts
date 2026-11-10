/**
 * Origen del desembolso (≠ método de cobro del cliente):
 * - nequi / banco = sale de la cuenta del dueño (Haber en banco / resta pool Nequi)
 * - efectivo = sale de la caja del cobrador
 * - cartera = préstamo que ya estaba en la calle (carga inicial): no sale plata de ningún lado
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { pesos } from "@/lib/finance";
import { displayToIso } from "@/lib/loan-preview";
import { loanRenewalOf } from "@/lib/loan-renewal-marks";
import {
  paymentsForCollector,
  routesForCollector,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";
import { normalizePaymentMethod, paymentDisplayMethod } from "@/lib/payment-method";

/** Marcadores estables en notes para sobrevivir mirror sin columna DB. */
export const NEQUI_FUNDED_MARKER = "[[fb:nequi]]";
export const EFECTIVO_FUNDED_MARKER = "[[fb:efectivo]]";
export const BANCO_FUNDED_MARKER = "[[fb:banco]]";
export const CARTERA_FUNDED_MARKER = "[[fb:cartera]]";
/** Préstamo combinado: un P-, dos salidas (caja + banco). */
export const COMBINADO_FUNDED_MARKER = "[[fb:combinado]]";
/** Montos del split: `[[split:efectivo:300000]]` / `[[split:banco:500000]]`. */
export const SPLIT_MARKER_RE = /\[\[split:(efectivo|banco|nequi):(\d+)\]\]/gi;

const FUNDED_MARKERS = [
  NEQUI_FUNDED_MARKER,
  EFECTIVO_FUNDED_MARKER,
  BANCO_FUNDED_MARKER,
  CARTERA_FUNDED_MARKER,
  COMBINADO_FUNDED_MARKER,
] as const;

/** Letra en listas de préstamos (caja / banco). C = combinado. */
export type LoanFundLetter = "E" | "B" | "C" | "N";

export type LoanDisbursementSource =
  | "nequi"
  | "efectivo"
  | "banco"
  | "cartera"
  | "combinado";

export type LoanSplitAmounts = {
  cashOut: number;
  bankOut: number;
};

export function loanDisbursementSource(
  loan: Pick<LoanRow, "fundedBy" | "notes">,
): LoanDisbursementSource | null {
  if (loanIsCombinadoFunded(loan)) return "combinado";
  if (loan.fundedBy === "nequi" || loan.notes?.includes(NEQUI_FUNDED_MARKER)) return "nequi";
  if (loan.fundedBy === "efectivo" || loan.notes?.includes(EFECTIVO_FUNDED_MARKER)) {
    return "efectivo";
  }
  if (loan.fundedBy === "banco" || loan.notes?.includes(BANCO_FUNDED_MARKER)) return "banco";
  if (loan.fundedBy === "cartera" || loan.notes?.includes(CARTERA_FUNDED_MARKER)) return "cartera";
  return null;
}

/** Cartera existente: el capital ya estaba en la calle; no es desembolso de caja, banco ni Nequi. */
export function loanIsExistingPortfolio(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "cartera";
}

/** Renovación sin plata: lo que el cliente debía + 20 %. Se muestra «Renovado»; nunca toca caja, Banco ni Nequi. */
export function isCashlessRenewal(loan: Pick<LoanRow, "fundedBy" | "notes"> | undefined | null): boolean {
  return Boolean(loan && loanRenewalOf(loan) && loanIsExistingPortfolio(loan));
}

export function loanFundedByNequi(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  return loanDisbursementSource(loan) === "nequi";
}

export function loanFundedByEfectivo(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  const source = loanDisbursementSource(loan);
  return source === "efectivo" || source === "combinado";
}

export function loanFundedByBanco(loan: Pick<LoanRow, "fundedBy" | "notes">): boolean {
  const source = loanDisbursementSource(loan);
  return source === "banco" || source === "combinado";
}

/** Combinado: una ficha, sale de caja y de banco. La letra en listas es C. */
export function loanIsCombinadoFunded(
  loan: Pick<LoanRow, "fundedBy" | "notes"> | undefined | null,
): boolean {
  if (!loan) return false;
  if (String(loan.fundedBy || "").trim().toLowerCase() === "combinado") return true;
  return Boolean(loan.notes?.includes(COMBINADO_FUNDED_MARKER));
}

function stripSplitMarkers(notes: string | undefined): string {
  return (notes || "")
    .replace(/\[\[split:(?:efectivo|banco|nequi):\d+\]\]/gi, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Texto de Observaciones para pantalla / formulario.
 * Sin marcadores internos [[fb:…]] / [[split:…]] ni el relleno automático
 * «Préstamo rápido · …» (la casilla va vacía por defecto).
 */
export function loanNotesForDisplay(notes: string | undefined): string {
  const cleaned = stripSplitMarkers(stripFundedMarkers(notes));
  return cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^pr[eé]stamo\s+r[aá]pido\b/i.test(line))
    .join("\n")
    .trim();
}

/** Exportado para guardar sin reinyectar marcadores del cajón. */
export function stripLoanInternalNotes(notes: string | undefined): string {
  return stripSplitMarkers(stripFundedMarkers(notes));
}

function parseSplitMarker(
  notes: string | undefined,
  kind: "efectivo" | "banco" | "nequi",
): number {
  if (!notes) return 0;
  const re = new RegExp(`\\[\\[split:${kind}:(\\d+)\\]\\]`, "i");
  const match = notes.match(re);
  return match ? pesos(Number(match[1]) || 0) : 0;
}

/** Lee el split del combinado (notes o campos de ficha). */
export function loanSplitAmounts(
  loan: Pick<LoanRow, "capital" | "fundedBy" | "notes" | "cashOut" | "bankOut">,
): LoanSplitAmounts | null {
  if (!loanIsCombinadoFunded(loan)) return null;
  const capital = pesos(Number(loan.capital) || 0);
  let cashOut = pesos(Number(loan.cashOut) || 0);
  let bankOut = pesos(Number(loan.bankOut) || 0);
  if (cashOut <= 0) cashOut = parseSplitMarker(loan.notes, "efectivo");
  if (bankOut <= 0) {
    bankOut = parseSplitMarker(loan.notes, "banco") || parseSplitMarker(loan.notes, "nequi");
  }
  if (cashOut > 0 && bankOut > 0) return { cashOut, bankOut };
  if (cashOut > 0 && cashOut < capital) return { cashOut, bankOut: capital - cashOut };
  if (bankOut > 0 && bankOut < capital) return { cashOut: capital - bankOut, bankOut };
  return null;
}

/** Candado: ambos > 0 y suman el capital. */
export function loanSplitIsValid(capital: number, cashOut: number, bankOut: number): boolean {
  const cap = pesos(capital);
  const cash = pesos(cashOut);
  const bank = pesos(bankOut);
  return cap > 0 && cash > 0 && bank > 0 && cash + bank === cap;
}

/**
 * Lo que sale de caja del cobrador.
 * Combinado → solo cashOut. Efectivo → capital. Banco/Nequi/cartera → 0.
 */
export function loanCashOutflowCapital(
  loan: Pick<LoanRow, "capital" | "fundedBy" | "notes" | "cashOut" | "bankOut">,
): number {
  if (loanIsCombinadoFunded(loan)) {
    const split = loanSplitAmounts(loan);
    return split ? split.cashOut : 0;
  }
  if (loanDisbursementSource(loan) === "efectivo") {
    return pesos(Number(loan.capital) || 0);
  }
  return 0;
}

/**
 * Letra de origen en listas de préstamos.
 * Cobrador (caja): E o C. Banco: B o C. Nequi: N o C.
 */
export function loanFundLetter(
  loan: Pick<LoanRow, "fundedBy" | "notes"> | undefined | null,
): LoanFundLetter {
  if (loanIsCombinadoFunded(loan)) return "C";
  const source = loan ? loanDisbursementSource(loan) : null;
  if (source === "banco") return "B";
  if (source === "nequi") return "N";
  return "E";
}

export function loanFundLetterTitle(letter: LoanFundLetter): string {
  if (letter === "E") return "Efectivo";
  if (letter === "B") return "Banco";
  if (letter === "N") return "Nequi";
  return "Combinado";
}

/**
 * Texto de lista sin la palabra «Préstamo» / «Anexo»: `P-705 · Nombre`.
 * El renglón GAS- sigue guardando «Préstamo · …»; aquí solo se pinta.
 */
/** P-… y nombre por separado (lista «Lo que prestó»: 4 columnas). */
export function loanListParts(
  line: Pick<{ loanRef?: string; label: string }, "loanRef" | "label">,
): { loanRef: string; name: string } {
  const ref = String(line.loanRef || "").trim();
  let rest = String(line.label || "")
    .replace(/^(Préstamo|Anexo)\s*·\s*/i, "")
    .trim();
  if (ref) {
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rest = rest.replace(new RegExp(`^${escaped}\\s*·\\s*`, "i"), "").trim();
    return { loanRef: ref, name: rest };
  }
  const m = /^(P-\d+|P-pend-[a-z0-9]+)\s*·\s*(.*)$/i.exec(rest);
  if (m) return { loanRef: m[1], name: (m[2] || "").trim() };
  return { loanRef: "", name: rest || String(line.label || "").trim() };
}

export function loanListDisplayText(
  line: Pick<{ loanRef?: string; label: string }, "loanRef" | "label">,
): string {
  const { loanRef, name } = loanListParts(line);
  if (loanRef && name) return `${loanRef} · ${name}`;
  return loanRef || name;
}

export function loanListFundLetter(
  line: Pick<{ fundLetter?: LoanFundLetter; category?: string }, "fundLetter" | "category">,
): LoanFundLetter {
  const marked = String(line.fundLetter || "")
    .trim()
    .toUpperCase();
  if (marked === "E" || marked === "B" || marked === "C" || marked === "N") {
    return marked;
  }
  return "E";
}

function withFundedMarker(notes: string | undefined, marker: string) {
  const cleaned = stripSplitMarkers(stripFundedMarkers(notes));
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
  const { cashOut: _c, bankOut: _b, ...rest } = loan;
  return {
    ...rest,
    fundedBy: "nequi",
    notes: withFundedMarker(loan.notes, NEQUI_FUNDED_MARKER),
  };
}

/** Marca desembolso en efectivo desde caja del cobrador. */
export function markLoanFundedByEfectivo(loan: LoanRow): LoanRow {
  const { cashOut: _c, bankOut: _b, ...rest } = loan;
  return {
    ...rest,
    fundedBy: "efectivo",
    notes: withFundedMarker(loan.notes, EFECTIVO_FUNDED_MARKER),
  };
}

/** Marca desembolso financiado desde cuenta bancaria del dueño. */
export function markLoanFundedByBanco(loan: LoanRow): LoanRow {
  const { cashOut: _c, bankOut: _b, ...rest } = loan;
  return {
    ...rest,
    fundedBy: "banco",
    notes: withFundedMarker(loan.notes, BANCO_FUNDED_MARKER),
  };
}

/** Marca préstamo de cartera existente (carga inicial desde planilla manual). */
export function markLoanExistingPortfolio(loan: LoanRow): LoanRow {
  const { cashOut: _c, bankOut: _b, ...rest } = loan;
  return {
    ...rest,
    fundedBy: "cartera",
    notes: withFundedMarker(loan.notes, CARTERA_FUNDED_MARKER),
  };
}

/**
 * Un P- combinado: capital = cashOut + bankOut.
 * Caja resta cashOut; Banco resta bankOut. Ambos > 0.
 */
export function markLoanFundedByCombinado(
  loan: LoanRow,
  cashOut: number,
  bankOut: number,
): LoanRow {
  const cash = pesos(cashOut);
  const bank = pesos(bankOut);
  const capital = pesos(Number(loan.capital) || 0);
  if (!loanSplitIsValid(capital, cash, bank)) {
    throw new Error("Combinado inválido: efectivo + banco deben sumar el capital.");
  }
  const base = stripSplitMarkers(stripFundedMarkers(loan.notes));
  const notes = [base, COMBINADO_FUNDED_MARKER, `[[split:efectivo:${cash}]]`, `[[split:banco:${bank}]]`]
    .filter(Boolean)
    .join("\n");
  return {
    ...loan,
    fundedBy: "combinado",
    cashOut: cash,
    bankOut: bank,
    notes,
  };
}

export function hydrateLoanFundedBy(loan: LoanRow): LoanRow {
  const source = loanDisbursementSource(loan);
  if (!source) return loan;
  if (source === "combinado") {
    const split = loanSplitAmounts({ ...loan, fundedBy: "combinado" });
    const next: LoanRow = {
      ...loan,
      fundedBy: "combinado",
      ...(split ? { cashOut: split.cashOut, bankOut: split.bankOut } : {}),
    };
    if (
      next.fundedBy === loan.fundedBy &&
      next.cashOut === loan.cashOut &&
      next.bankOut === loan.bankOut
    ) {
      return loan;
    }
    return next;
  }
  if (loan.fundedBy === source && loan.cashOut == null && loan.bankOut == null) return loan;
  const { cashOut: _c, bankOut: _b, ...rest } = loan;
  return { ...rest, fundedBy: source };
}

export function loanDisbursementSourceLabel(source: LoanDisbursementSource | null) {
  if (source === "nequi") return "Nequi";
  if (source === "efectivo") return "Efectivo";
  if (source === "banco") return "Banco";
  if (source === "cartera") return "Cartera";
  if (source === "combinado") return "Combinado";
  return "—";
}

/** Texto de Modalidad / origen en la ficha. */
export function loanOriginDisplayLabel(
  loan: Pick<LoanRow, "fundedBy" | "notes" | "capital" | "cashOut" | "bankOut">,
): string {
  const source = loanDisbursementSource(loan);
  if (source === "combinado") {
    const split = loanSplitAmounts(loan);
    if (split) {
      return `Combinado (caja ${split.cashOut.toLocaleString("es-CO")} / banco ${split.bankOut.toLocaleString("es-CO")})`;
    }
    return "Combinado (caja / banco)";
  }
  if (source === "efectivo") return "Caja";
  if (source === "banco") return "Banco";
  if (source === "nequi") return "Nequi";
  if (source === "cartera") return "Cartera";
  return "—";
}

export function loanDisbursementMovementRef(loanRef: string) {
  return `DSB-${(loanRef || "").trim()}`;
}

/**
 * Plata que sale de Banco / Nequi.
 * Combinado → solo bankOut. Banco/Nequi enteros → capital.
 * El interés es lo que el cliente debe de más; no sale de la cuenta.
 * Nunca `total` ni `capital + interés`.
 */
export function loanBankOutflowCapital(
  loan: Pick<LoanRow, "capital" | "interest" | "total" | "fundedBy" | "notes" | "cashOut" | "bankOut">,
): number {
  if (loanIsCombinadoFunded(loan)) {
    const split = loanSplitAmounts(loan);
    return split ? split.bankOut : 0;
  }
  return pesos(Number(loan.capital) || 0);
}

export function sumNequiFundedDisbursements(loans: LoanRow[]): number {
  let sum = 0;
  for (const loan of loans) {
    if (!loanFundedByNequi(loan)) continue;
    const capital = loanBankOutflowCapital(loan);
    if (capital > 0) sum += capital;
  }
  return sum;
}

/** Abono registrado en el panel (Caja / oficina), no en la ruta del cobrador. */
export function isOfficePayment(row: PaymentRow) {
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
 * Cobros del cobrador más abonos del sistema (Caja / oficina) a clientes de sus rutas.
 * A → Nequi; M / T / N → Banco. El efectivo de oficina no entra (no es recaudo de ruta).
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
    if (!((row.amount ?? 0) > 0)) return false;
    if (paymentDisplayMethod(row, loans, clients) === "efectivo") return false;
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

export function loanDisbursementIsoDate(
  loan: Pick<LoanRow, "date"> & { start_date?: string },
): string {
  const raw = String(loan.date || loan.start_date || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}[T\s]/.test(raw) || /(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return businessTodayIso(new Date(parsed));
  }
  return displayToIso(raw);
}
