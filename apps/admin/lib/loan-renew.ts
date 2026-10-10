import { todayIso } from "@/lib/daily-dispatch";
import {
  displayToIso,
  firstCollectionIso,
  installmentCountForTerm,
  isoToDisplay,
  previewLoanFlat,
  type LoanPreview,
  type LoanTermMonths,
  type PayFrequency,
} from "@/lib/loan-preview";
import { isLoanActive, money, type LoanRow } from "@/lib/mock-data";
import { markLoanExistingPortfolio } from "@/lib/nequi-pool";

export { loanRenewalOf, loanRenewedInto } from "@/lib/loan-renewal-marks";

/** Lo que propone el formulario de Renovar; quien renueva lo puede cambiar. */
export const DEFAULT_RENEWAL_RATE_PERCENT = 20;
export const DEFAULT_RENEWAL_TERM_MONTHS: LoanTermMonths = 1;
const MAX_RENEWAL_RATE_PERCENT = 100;

/** Condiciones del préstamo de continuación. El capital no se elige: es lo que debe. */
export type RenewalTerms = {
  ratePercent: number;
  termMonths: LoanTermMonths;
  /** Primer cobro (ISO). Sin valor: el siguiente día de cobro (`defaultRenewalFirstCollection`). */
  firstCollectionIso?: string;
};

export function defaultRenewalTerms(): RenewalTerms {
  return {
    ratePercent: DEFAULT_RENEWAL_RATE_PERCENT,
    termMonths: DEFAULT_RENEWAL_TERM_MONTHS,
  };
}

function pesos(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function termLabel(months: LoanTermMonths) {
  return Number(months) === 1 ? "1 mes" : `${months} meses`;
}

/** Motivo por el que las condiciones no sirven (o null). */
export function renewalTermsError(terms: RenewalTerms, today = todayIso()): string | null {
  const rate = Number(terms.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RENEWAL_RATE_PERCENT) {
    return `El porcentaje va de 0 a ${MAX_RENEWAL_RATE_PERCENT}.`;
  }
  if (!(Number(terms.termMonths) > 0)) return "Elija el plazo.";
  const first = terms.firstCollectionIso;
  if (first && !/^\d{4}-\d{2}-\d{2}$/.test(first)) return "Fecha de primer cobro no válida.";
  if (first && first < today) return "El primer cobro no puede ser antes de hoy.";
  return null;
}

/** Renovación disponible cuando ya venció el plazo y aún hay saldo. */
export function canRenewLoan(loan: LoanRow | null | undefined, today = todayIso()) {
  if (!loan || loan.balance <= 0) return false;
  if (!isLoanActive(loan)) return false;
  const dueIso = displayToIso(loan.due);
  if (!dueIso) return false;
  return dueIso <= today;
}

function nextDayIso(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** Hoy la visita queda «Renovado hoy»: el día 1 del préstamo nuevo es el siguiente día de cobro. */
export function defaultRenewalFirstCollection(today: string, frequency: PayFrequency) {
  return frequency === "diario"
    ? firstCollectionIso(nextDayIso(today), frequency)
    : firstCollectionIso(today, frequency);
}

export type RenewalPreview = {
  capital: number;
  interest: number;
  frequency: PayFrequency;
  terms: RenewalTerms;
  preview: LoanPreview;
};

export function renewalPreview(
  loan: LoanRow,
  today = todayIso(),
  terms: RenewalTerms = defaultRenewalTerms(),
): RenewalPreview | null {
  if (renewalTermsError(terms, today)) return null;
  const capital = pesos(loan.balance);
  if (capital <= 0) return null;
  const interest = pesos((capital * Number(terms.ratePercent)) / 100);
  const frequency = (loan.frequency ?? "diario") as PayFrequency;
  const firstCollection =
    terms.firstCollectionIso || defaultRenewalFirstCollection(today, frequency);
  const preview = previewLoanFlat({
    capital,
    interest,
    startIso: today,
    frequency,
    installments: installmentCountForTerm(frequency, terms.termMonths),
    firstCollectionIso: firstCollection,
  });
  if (!preview) return null;
  return { capital, interest, frequency, terms: { ...terms, firstCollectionIso: firstCollection }, preview };
}

/** Aviso tras renovar: «debía X + N % = Y». */
export function renewalSummary(created: Pick<LoanRow, "capital" | "total">, terms: RenewalTerms) {
  return `Renovado: debía ${money(created.capital)} + ${terms.ratePercent} % = ${money(created.total ?? 0)} · ${termLabel(terms.termMonths)}`;
}

export type LoanRenewalResult = {
  /** Préstamo anterior cerrado por renovación. */
  closed: LoanRow;
  /** Préstamo de continuación: lo que debía + el porcentaje elegido. */
  created: LoanRow;
};

/**
 * Renovar: primero se corta el vencido (lo que debe = saldo) y después nace el de continuación
 * con ese saldo + el porcentaje elegido. No sale plata: el cliente ya la tiene. La deuda sigue
 * en el P- nuevo como cartera (sin caja, Banco ni Nequi). Hoy la visita queda «Renovado hoy».
 * Pagado del vencido = solo lo cobrado (lo calcula la base); lo que debía no cuenta como pagado.
 */
export function buildRenewalLoans(
  source: LoanRow,
  newRef: string,
  today = todayIso(),
  terms: RenewalTerms = defaultRenewalTerms(),
): LoanRenewalResult | null {
  if (!canRenewLoan(source, today)) return null;
  const built = renewalPreview(source, today, terms);
  if (!built) return null;
  const { capital, interest, frequency, preview } = built;
  const dueIso = preview.dates[preview.dates.length - 1];

  const closed: LoanRow = {
    ...source,
    balance: 0,
    status: "Finalizado",
    kind: "paid",
    notes: source.notes?.trim()
      ? `${source.notes.trim()}\nCerrado por renovación → ${newRef}`
      : `Cerrado por renovación → ${newRef}`,
  };

  const created = markLoanExistingPortfolio(
    {
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
      notes: `Renovación de ${source.ref} · saldo ${capital} + ${terms.ratePercent}% (${interest}) · ${termLabel(terms.termMonths)}`,
    },
  );

  return { closed, created };
}
