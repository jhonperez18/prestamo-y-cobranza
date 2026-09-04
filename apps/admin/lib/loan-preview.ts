import { isDailyCollectionDay } from "@/lib/colombia-holidays";
import { loanStatusPill } from "@/lib/loan-status";

export type PayFrequency = "diario" | "semanal" | "quincenal" | "mensual";
export type LoanTermMonths = 1 | 2 | 3;

export type ChargeKind = "interes" | "capital" | "cuota";

export type ChargeMode = "interes" | "cuota_fija";

export type PactKind = "tasa" | "valor";

export type ScheduleLine = {
  date: string;
  amount: number;
  kind: ChargeKind;
};

export type LoanPreview = {
  days: number;
  count: number;
  interestCount: number;
  interest: number;
  total: number;
  installment: number;
  dates: string[];
  schedule: ScheduleLine[];
};

export type LoanScheduleEntry = {
  date: string;
  amount: number;
  kind?: ChargeKind;
  paid?: number;
};

export type LoanTermsRow = {
  ref?: string;
  clientRef?: string;
  client?: string;
  date: string;
  due: string;
  capital: number;
  rate?: number;
  frequency?: PayFrequency;
  mode?: ChargeMode;
  pact?: PactKind;
  installment?: number;
  schedule?: LoanScheduleEntry[];
  days?: number;
  interest?: number;
  total?: number;
  paid?: number;
  balance?: number;
  status?: string;
  kind?: string;
  notes?: string;
  collectionAlerts?: number;
};

export const LOAN_TERM_OPTIONS: { id: LoanTermMonths; label: string }[] = [
  { id: 1, label: "1 mes" },
  { id: 2, label: "2 meses" },
  { id: 3, label: "3 meses" },
];

export const PAY_FREQUENCIES: { id: PayFrequency; label: string }[] = [
  { id: "diario", label: "Diario" },
  { id: "semanal", label: "Semanal" },
  { id: "quincenal", label: "Quincenal" },
  { id: "mensual", label: "Mensual" },
];

export const CHARGE_MODES: { id: ChargeMode; label: string }[] = [
  { id: "interes", label: "Interés (capital quieto)" },
];

/** Modalidades disponibles al crear o modificar (solo capital quieto, formato unificado). */
export const LOAN_FORM_MODES = CHARGE_MODES;

export const PACT_KINDS: { id: PactKind; label: string }[] = [
  { id: "tasa", label: "Por % por cobro" },
  { id: "valor", label: "Valor pactado" },
];

export function chargeLabel(kind: ChargeKind | undefined) {
  if (kind === "capital") return "Capital";
  if (kind === "cuota") return "Cuota";
  if (kind === "interes") return "Interés";
  return "—";
}

export function modeLabel(mode: ChargeMode | undefined) {
  return CHARGE_MODES.find((item) => item.id === mode)?.label ?? "Interés (capital quieto)";
}

export function pactLabel(pact: PactKind | undefined) {
  return PACT_KINDS.find((item) => item.id === pact)?.label ?? "Por % por cobro";
}

export function rateFieldLabel(frequency: PayFrequency) {
  const labels: Record<PayFrequency, string> = {
    diario: "Interés % diario",
    semanal: "Interés % semanal",
    quincenal: "Interés % quincenal",
    mensual: "Interés % mensual",
  };
  return labels[frequency];
}

export function effectiveMode(mode?: ChargeMode): ChargeMode {
  return mode ?? "interes";
}

export function effectivePact(mode?: ChargeMode, pact?: PactKind): PactKind {
  if (effectiveMode(mode) === "cuota_fija") return "valor";
  return pact ?? "tasa";
}

/** Convierte préstamos antiguos al formato unificado sin perder el modelo de cuotas planas. */
export function standardizeLoanTerms<T extends LoanTermsRow>(loan: T): T {
  if (loan.mode === "cuota_fija") {
    return {
      ...loan,
      mode: "cuota_fija",
      pact: "valor",
      rate: 0,
    };
  }
  if (!loan.mode) {
    return { ...loan, mode: "interes", pact: loan.pact ?? "tasa" };
  }
  return loan;
}

export function loanFacts(input: {
  capital: string;
  installment: string;
  interest: string;
  total: string;
  plazo: string;
  mode?: ChargeMode;
  pact?: PactKind;
}): { label: string; value: string }[] {
  return [
    { label: "Capital (quieto)", value: input.capital },
    { label: "Interés del plazo", value: input.interest },
    { label: "Cuota de interés", value: input.installment },
    { label: "Capital al vencimiento", value: input.capital },
    { label: "Plazo", value: input.plazo },
    { label: "Monto a pagar", value: input.total },
  ];
}

export type LoanDetailField = {
  label: string;
  value: string;
  money?: boolean;
  notes?: boolean;
};

/** Campos de la ficha (solo lectura): misma estructura de 12 conceptos para todos los préstamos. */
export function buildLoanDetailFields(input: {
  capital: number;
  date: string;
  due: string;
  frequency: PayFrequency;
  mode?: ChargeMode;
  pact?: PactKind;
  rate?: number;
  installment?: number;
  interest?: number;
  total?: number;
  days?: number;
  interestCount: number;
  notes?: string;
  formatMoney: (value: number) => string;
}): LoanDetailField[] {
  const standardized = standardizeLoanTerms({
    mode: input.mode,
    pact: input.pact,
    date: input.date,
    due: input.due,
    capital: input.capital,
  });
  const mode = effectiveMode(standardized.mode);
  const pact = effectivePact(mode, standardized.pact);
  const plazo = previewPlazoLabel(input.days ?? 0, input.interestCount);
  const frequencyLabel =
    PAY_FREQUENCIES.find((item) => item.id === input.frequency)?.label ?? "Diario";

  const fields: LoanDetailField[] = [
    { label: "Capital", value: input.formatMoney(input.capital), money: true },
    { label: "Modalidad", value: modeLabel(mode) },
    { label: "Desembolso", value: input.date },
    { label: "Vencimiento", value: input.due },
    { label: "Frecuencia", value: frequencyLabel },
    { label: "Pacto", value: pactLabel(pact) },
  ];

  if (pact === "tasa") {
    fields.push({
      label: rateFieldLabel(input.frequency),
      value: input.rate != null ? `${input.rate}%` : "—",
    });
  } else {
    fields.push({
      label: "Valor de cada cobro",
      value: input.formatMoney(input.installment ?? 0),
      money: true,
    });
  }

  fields.push(
    { label: "Interés del plazo", value: input.formatMoney(input.interest ?? 0), money: true },
    { label: "Cuota de interés", value: input.formatMoney(input.installment ?? 0), money: true },
    { label: "Plazo", value: plazo },
    { label: "Monto a pagar", value: input.formatMoney(input.total ?? input.capital), money: true },
  );

  fields.push({
    label: "Observaciones",
    value: input.notes?.trim() || "—",
    notes: true,
  });

  return fields;
}

export function buildFlatLoanPreviewCards(input: {
  capital: number;
  interest: number;
  total: number;
  installment: number;
  installments: number;
  days: number;
  dueLabel: string;
  frequencyLabel: string;
  formatMoney: (value: number) => string;
}): { label: string; value: string }[] {
  return [
    { label: "Capital", value: input.formatMoney(input.capital) },
    { label: "Interés", value: input.formatMoney(input.interest) },
    { label: "Monto a pagar", value: input.formatMoney(input.total) },
    { label: "Frecuencia", value: input.frequencyLabel },
    { label: "Cuotas", value: String(input.installments) },
    { label: "Valor cuota", value: input.formatMoney(input.installment) },
    { label: "Plazo", value: `${input.days} días` },
    { label: "Vencimiento", value: input.dueLabel },
  ];
}

export function buildLoanPreviewCards(input: {
  capital: number;
  installment: number;
  interest: number;
  total: number;
  days: number;
  interestCount: number;
  mode?: ChargeMode;
  pact?: PactKind;
  formatMoney: (value: number) => string;
}) {
  return loanFacts({
    capital: input.formatMoney(input.capital),
    installment: input.formatMoney(input.installment),
    interest: input.formatMoney(input.interest),
    total: input.formatMoney(input.total),
    plazo: previewPlazoLabel(input.days, input.interestCount),
    mode: input.mode,
    pact: input.pact,
  });
}

export const LOAN_FICHA_COLUMNS = [
  { id: "ref", label: "Préstamo", align: "left" as const, width: "11%" },
  { id: "capital", label: "Capital", align: "right" as const, width: "14%" },
  { id: "interes", label: "Interés", align: "right" as const, width: "12%" },
  { id: "cuotas", label: "Cuotas", align: "right" as const, width: "8%" },
  { id: "recaudado", label: "Recaudado", align: "right" as const, width: "17%", title: "Total recaudado" },
  { id: "pendiente", label: "Pendiente", align: "right" as const, width: "17%", title: "Valor pendiente" },
  { id: "estado", label: "Estado", align: "center" as const, width: "21%" },
] as const;

export type LoanFichaRow = Record<(typeof LOAN_FICHA_COLUMNS)[number]["id"], string>;

export function loanPlazoLabel(loan: {
  date?: string;
  due?: string;
  days?: number;
  frequency?: PayFrequency;
}) {
  const freqLabel = PAY_FREQUENCIES.find((item) => item.id === loan.frequency)?.label;
  if (!loan.date || !loan.due) return "—";
  return `${loan.date} → ${loan.due}${loan.days != null ? ` · ${loan.days} días` : ""}${freqLabel ? ` · ${freqLabel}` : ""}`;
}

export function loanFichaRow(
  loan: {
    ref: string;
    capital: number;
    paid: number;
    balance: number;
    interest?: number;
    total?: number;
    installment?: number;
    schedule?: { kind?: "interes" | "capital" | "cuota" }[];
    status: string;
  },
  formatMoney: (value: number) => string,
  ledger?: { paid: number; pending: number },
): LoanFichaRow {
  const interest =
    loan.interest ??
    (loan.total != null && loan.total > loan.capital ? loan.total - loan.capital : undefined);

  let cuotas = "—";
  if (loan.schedule?.length) {
    const count = loan.schedule.filter((line) => line.kind !== "capital").length;
    if (count > 0) cuotas = String(count);
  } else if (loan.installment != null) {
    cuotas = formatMoney(loan.installment);
  }

  return {
    ref: loan.ref,
    capital: formatMoney(loan.capital),
    interes: interest != null ? formatMoney(interest) : "—",
    cuotas,
    recaudado: formatMoney(ledger?.paid ?? loan.paid),
    pendiente: formatMoney(
      ledger?.pending ??
        Math.max(0, (loan.total ?? loan.balance ?? loan.capital) - (loan.paid ?? 0)),
    ),
    estado: loan.status,
  };
}

export function sortLoansForFicha<T extends { date?: string; ref: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = displayToIso(a.date ?? "");
    const db = displayToIso(b.date ?? "");
    if (da !== db) return db.localeCompare(da);
    return b.ref.localeCompare(a.ref);
  });
}

function parts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

function toIso(year: number, month: number, day: number) {
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcDay(iso: string) {
  const { year, month, day } = parts(iso);
  return Date.UTC(year, month - 1, day);
}

export function isoToDisplay(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function displayToIso(display: string) {
  const [day, month, year] = display.split("/");
  if (!day || !month || !year) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function daysBetween(startIso: string, dueIso: string) {
  const diff = Math.round((utcDay(dueIso) - utcDay(startIso)) / 86400000);
  return diff > 0 ? diff : 0;
}

function addDays(iso: string, days: number) {
  const { year, month, day } = parts(iso);
  return toIso(year, month, day + days);
}

function addMonths(iso: string, months: number) {
  const { year, month, day } = parts(iso);
  return toIso(year, month + months, day);
}

function addPeriod(iso: string, frequency: PayFrequency) {
  if (frequency === "diario") return addDays(iso, 1);
  if (frequency === "semanal") return addDays(iso, 8);
  if (frequency === "quincenal") return addDays(iso, 15);
  return addMonths(iso, 1);
}

export function paymentDates(startIso: string, dueIso: string, frequency: PayFrequency) {
  return interestPaymentDates(startIso, dueIso, frequency);
}

/** Fechas de cobro de interés/cuota: desde el primer periodo después del desembolso hasta el vencimiento. */
export function interestPaymentDates(startIso: string, dueIso: string, frequency: PayFrequency) {
  if (!startIso || !dueIso) return [];
  const startDay = utcDay(startIso);
  const dueDay = utcDay(dueIso);
  if (dueDay < startDay) return [];
  if (dueDay === startDay) return [dueIso];

  const dates: string[] = [];
  let current = addPeriod(startIso, frequency);
  let guard = 0;
  while (utcDay(current) <= dueDay && guard < 400) {
    dates.push(current);
    current = addPeriod(current, frequency);
    guard += 1;
  }
  if (dates.length === 0 || dates[dates.length - 1] !== dueIso) {
    dates.push(dueIso);
  }
  return dates;
}

export function interestChargeCount(schedule: { kind?: ChargeKind }[]) {
  return schedule.filter((line) => line.kind !== "capital").length;
}

export function previewPlazoLabel(days: number, interestCount: number) {
  return `${days} días · ${interestCount} cuotas`;
}

/** Fechas de cobro a partir del desembolso: N periodos según frecuencia. */
export function installmentDates(startIso: string, frequency: PayFrequency, count: number) {
  if (!startIso || count <= 0) return [];
  const dates: string[] = [];
  let current = addPeriod(startIso, frequency);
  for (let i = 0; i < count; i += 1) {
    dates.push(current);
    current = addPeriod(current, frequency);
  }
  return dates;
}

/**
 * Fechas de cobro según plazo y frecuencia.
 * Diario: 30 cuotas por mes (1→30, 2→60, 3→90), lun–sáb sin festivos.
 * Semanal: 4 por mes (cada 8 días). Quincenal: 2 por mes. Mensual: 1 por mes.
 */
export function installmentCountForTerm(frequency: PayFrequency, termMonths: LoanTermMonths) {
  if (frequency === "diario") return termMonths * 30;
  if (frequency === "semanal") return termMonths * 4;
  if (frequency === "quincenal") return termMonths * 2;
  return termMonths;
}

export function collectionDatesForTerm(
  startIso: string,
  frequency: PayFrequency,
  termMonths: LoanTermMonths,
): string[] {
  if (!startIso || termMonths < 1) return [];
  const target = installmentCountForTerm(frequency, termMonths);
  const dates: string[] = [];
  let guard = 0;

  if (frequency === "diario") {
    let current = addDays(startIso, 1);
    while (dates.length < target && guard < 600) {
      if (isDailyCollectionDay(current)) dates.push(current);
      current = addDays(current, 1);
      guard += 1;
    }
    return dates;
  }

  if (frequency === "semanal") {
    let current = addDays(startIso, 8);
    while (dates.length < target && guard < 120) {
      dates.push(current);
      current = addDays(current, 8);
      guard += 1;
    }
    return dates;
  }

  if (frequency === "quincenal") {
    let current = addDays(startIso, 15);
    while (dates.length < target && guard < 80) {
      dates.push(current);
      current = addDays(current, 15);
      guard += 1;
    }
    return dates;
  }

  for (let month = 1; month <= target; month += 1) {
    dates.push(addMonths(startIso, month));
  }
  return dates;
}

/** Primera fecha de cobro según frecuencia (desde el desembolso). */
export function firstCollectionIso(startIso: string, frequency: PayFrequency) {
  if (!startIso) return "";
  if (frequency === "diario") return "";
  if (frequency === "semanal") return addDays(startIso, 8);
  if (frequency === "quincenal") return addDays(startIso, 15);
  return addMonths(startIso, 1);
}

/** Etiqueta para la casilla “Día de cobro”. */
export function firstCollectionLabel(startIso: string, frequency: PayFrequency) {
  if (!startIso) return "";
  if (frequency === "diario") return "Lun–sáb";
  const iso = firstCollectionIso(startIso, frequency);
  return iso ? isoToDisplay(iso) : "";
}

export function collectionAnchorHint(startIso: string, frequency: PayFrequency) {
  if (!startIso) return "";
  if (frequency === "diario") {
    return "Diario: 30 cuotas por mes (lun–sáb, sin festivos).";
  }
  const first = firstCollectionLabel(startIso, frequency);
  if (frequency === "semanal") {
    return `Semanal: 4 cuotas por mes (cada 8 días). Primer cobro: ${first}.`;
  }
  if (frequency === "quincenal") {
    return `Quincenal: 2 cuotas por mes (cada 15 días). Primer cobro: ${first}.`;
  }
  return `Mensual: 1 cuota por mes. Primer cobro: ${first}.`;
}

/** Reparte el monto total en N cuotas (el residuo va a la última). */
export function splitTotalAcrossDates(total: number, dates: string[]): ScheduleLine[] {
  if (dates.length === 0 || total <= 0) return [];
  const n = dates.length;
  const base = pesos(total / n);
  const used = base * (n - 1);
  return dates.map((date, index) => ({
    date,
    kind: "cuota" as const,
    amount: index === n - 1 ? total - used : base,
  }));
}

/**
 * Modelo operativo: capital + interés = monto a pagar,
 * dividido en cuotas según plazo (meses) y frecuencia de cobro.
 */
export function previewLoanFlat(input: {
  capital: number;
  interest: number;
  startIso: string;
  frequency: PayFrequency;
  termMonths?: LoanTermMonths;
  /** @deprecated Preferir termMonths; se mantiene por compatibilidad. */
  installments?: number;
}): LoanPreview | null {
  const { capital, interest, startIso, frequency } = input;
  if (capital <= 0 || interest < 0 || !startIso) return null;
  const total = pesos(capital) + pesos(interest);
  if (total <= 0) return null;

  const termMonths = input.termMonths;
  const dates =
    termMonths != null
      ? collectionDatesForTerm(startIso, frequency, termMonths)
      : installmentDates(startIso, frequency, Math.trunc(input.installments ?? 0));
  if (dates.length === 0) return null;

  const schedule = splitTotalAcrossDates(total, dates);
  const dueIso = dates[dates.length - 1];
  const days = daysBetween(startIso, dueIso);
  const installment = schedule[0]?.amount ?? 0;
  return {
    days,
    count: dates.length,
    interestCount: dates.length,
    interest: pesos(interest),
    total,
    installment,
    dates,
    schedule,
  };
}

/** Cuota de interés = capital × % por cada cobro según la frecuencia elegida. */
export function periodInstallment(capital: number, rate: number, _frequency?: PayFrequency) {
  return pesos((capital * rate) / 100);
}

function pesos(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function splitInterest(total: number, dates: string[]): ScheduleLine[] {
  if (dates.length === 0) return [];
  const base = pesos(total / dates.length);
  const used = base * (dates.length - 1);
  return dates.map((date, index) => ({
    date,
    kind: "interes",
    amount: index === dates.length - 1 ? total - used : base,
  }));
}

/**
 * Maqueta del acuerdo:
 * - Interés + %: capital quieto; cada fecha cobra el interés calculado; al vencimiento el capital.
 * - Interés + valor pactado: capital quieto; cada fecha cobra el valor acordado; al vencimiento el capital.
 * - Cuota fija: cada fecha cobra la misma cuota pactada; no se agrega el capital aparte.
 */
export function previewLoan(input: {
  capital: number;
  startIso: string;
  dueIso: string;
  frequency: PayFrequency;
  mode: ChargeMode;
  pact: PactKind;
  rate: number;
  cuota: number;
}): LoanPreview | null {
  const { capital, startIso, dueIso, frequency, mode, pact, rate, cuota } = input;
  if (capital <= 0 || !startIso || !dueIso) return null;
  const days = daysBetween(startIso, dueIso);
  const dates = interestPaymentDates(startIso, dueIso, frequency);
  if (dates.length === 0) return null;
  const interestCount = dates.length;

  if (mode === "cuota_fija") {
    if (cuota <= 0) return null;
    const schedule: ScheduleLine[] = dates.map((date) => ({ date, kind: "cuota", amount: cuota }));
    return {
      days,
      count: interestCount,
      interestCount,
      interest: 0,
      total: cuota * interestCount,
      installment: cuota,
      dates,
      schedule,
    };
  }

  if (pact === "valor") {
    if (cuota <= 0) return null;
    const interest = cuota * interestCount;
    const schedule: ScheduleLine[] = [
      ...dates.map((date) => ({ date, kind: "interes" as const, amount: cuota })),
      { date: dueIso, amount: capital, kind: "capital" },
    ];
    return {
      days,
      count: interestCount,
      interestCount,
      interest,
      total: capital + interest,
      installment: cuota,
      dates,
      schedule,
    };
  }

  const installment = periodInstallment(capital, rate, frequency);
  const interestLines: ScheduleLine[] = dates.map((date) => ({
    date,
    kind: "interes",
    amount: installment,
  }));
  const interest = installment * interestCount;
  const schedule: ScheduleLine[] = [
    ...interestLines,
    { date: dueIso, amount: capital, kind: "capital" },
  ];
  return {
    days,
    count: interestCount,
    interestCount,
    interest,
    total: capital + interest,
    installment,
    dates,
    schedule,
  };
}

function installmentCountFromTerms(terms: LoanTermsRow) {
  const fromSchedule = (terms.schedule ?? []).filter((line) => line.kind !== "capital").length;
  if (fromSchedule > 0) return fromSchedule;
  if (terms.installment && terms.installment > 0 && terms.total && terms.total > 0) {
    return Math.max(1, Math.round(terms.total / terms.installment));
  }
  return 0;
}

export function inferTermMonths(startIso: string, dueIso: string): LoanTermMonths {
  if (!startIso || !dueIso) return 1;
  let best: LoanTermMonths = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const months of [1, 2, 3] as const) {
    const end = addMonths(startIso, months);
    const diff = Math.abs(utcDay(end) - utcDay(dueIso));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = months;
    }
  }
  return best;
}

/** ¿Préstamo con capital + interés fijo repartido en cuotas? */
export function isFlatLoanTerms(loan: LoanTermsRow) {
  const terms = standardizeLoanTerms(loan);
  if (terms.mode === "cuota_fija") return true;
  const schedule = terms.schedule ?? [];
  return (
    schedule.length > 0 &&
    schedule.every((line) => (line.kind ?? "cuota") === "cuota") &&
    terms.interest != null
  );
}

/** Calcula la maqueta del acuerdo a partir de los términos guardados del préstamo. */
export function loanPreviewFromRow(loan: LoanTermsRow): LoanPreview | null {
  const terms = standardizeLoanTerms(loan);
  const startIso = displayToIso(terms.date);
  const frequency = terms.frequency ?? "diario";
  if (!startIso || terms.capital <= 0) return null;

  if (isFlatLoanTerms(terms)) {
    const dueIso = displayToIso(terms.due);
    const interest =
      terms.interest ?? Math.max(0, (terms.total ?? terms.capital) - terms.capital);
    const termMonths = dueIso ? inferTermMonths(startIso, dueIso) : 1;
    const preview = previewLoanFlat({
      capital: terms.capital,
      interest,
      startIso,
      frequency,
      termMonths,
    });
    if (preview) return preview;
    const installments = installmentCountFromTerms(terms);
    if (installments <= 0) return null;
    return previewLoanFlat({
      capital: terms.capital,
      interest,
      startIso,
      frequency,
      installments,
    });
  }

  const dueIso = displayToIso(terms.due);
  const mode = effectiveMode(terms.mode);
  const pact = effectivePact(mode, terms.pact);
  const rate = terms.rate ?? 0;
  const cuota = terms.installment ?? 0;
  if (!dueIso) return null;
  return previewLoan({
    capital: terms.capital,
    startIso,
    dueIso,
    frequency,
    mode,
    pact,
    rate,
    cuota,
  });
}

function scheduleKey(date: string, kind: ChargeKind | undefined) {
  return `${date}:${kind ?? "interes"}`;
}

/** Conserva abonos registrados en líneas previas al recalcular el cronograma. */
export function mergeSchedulePaid(
  template: ScheduleLine[],
  existing?: LoanScheduleEntry[],
): LoanScheduleEntry[] {
  const paidByKey = new Map<string, number>();
  for (const line of existing ?? []) {
    const key = scheduleKey(line.date, line.kind);
    paidByKey.set(key, Math.max(paidByKey.get(key) ?? 0, line.paid ?? 0));
  }
  return template.map((line) => ({
    ...line,
    paid: paidByKey.get(scheduleKey(line.date, line.kind)) ?? 0,
  }));
}

/** Aplica movimientos de caja/campo sobre las fechas de cobro.
 * El excedente sobre la cuota del día no se vuelca a otras fechas:
 * baja el saldo y la cuota diaria pactada se mantiene.
 */
export function applyPaymentsToSchedule(
  schedule: LoanScheduleEntry[],
  payments: { loanRef?: string; dueDate?: string; amount: number }[],
  loanRef: string,
): LoanScheduleEntry[] {
  const loanPayments = payments.filter((row) => row.loanRef === loanRef && row.dueDate);
  if (loanPayments.length === 0) return schedule;
  return schedule.map((line) => {
    const fromPayments = loanPayments
      .filter((row) => row.dueDate === line.date)
      .reduce((sum, row) => sum + row.amount, 0);
    const paid = Math.min(line.amount, Math.max(line.paid ?? 0, fromPayments));
    return { ...line, paid };
  });
}

function paidFromPayments(
  payments: { loanRef?: string; amount: number }[],
  loanRef: string,
) {
  return payments
    .filter((row) => row.loanRef === loanRef)
    .reduce((sum, row) => sum + row.amount, 0);
}

/** Recaudado y saldo alineados con movimientos reales cuando hay pagos. */
function resolveLoanLedger(
  terms: LoanTermsRow,
  total: number,
  payments?: { loanRef?: string; dueDate?: string; amount: number }[],
) {
  if (payments === undefined) {
    const paid = terms.paid ?? 0;
    const balance = terms.status === "Finalizado" ? 0 : Math.max(0, total - paid);
    return { paid, balance };
  }

  const paid = terms.ref ? paidFromPayments(payments, terms.ref) : 0;
  const balance = Math.max(0, total - paid);
  return { paid, balance: balance <= 0 && total > 0 ? 0 : balance };
}

/**
 * Fuente única: recalcula días, interés, total, cuota y cronograma
 * a partir de capital, %, frecuencia y fechas. Conserva lo ya pagado.
 */
export function normalizeLoan<T extends LoanTermsRow>(
  loan: T,
  payments?: { loanRef?: string; dueDate?: string; amount: number }[],
): T {
  const terms = standardizeLoanTerms(loan);
  const preview = loanPreviewFromRow(terms);
  if (!preview) return terms;
  let schedule = mergeSchedulePaid(preview.schedule, terms.schedule);
  if (payments && terms.ref) {
    schedule = applyPaymentsToSchedule(schedule, payments, terms.ref);
  }
  const ledger = resolveLoanLedger(terms, preview.total, payments);
  const flat = isFlatLoanTerms(terms);
  const dueIso = preview.dates[preview.dates.length - 1];
  const merged = {
    ...terms,
    days: preview.days,
    interest: preview.interest,
    total: preview.total,
    installment: preview.installment,
    schedule,
    due: dueIso ? isoToDisplay(dueIso) : terms.due,
    mode: flat ? ("cuota_fija" as const) : ("interes" as const),
    frequency: terms.frequency ?? "diario",
    pact: flat ? ("valor" as const) : effectivePact("interes", terms.pact),
    rate: flat ? 0 : effectivePact("interes", terms.pact) === "tasa" ? (terms.rate ?? 0) : 0,
    paid: ledger.paid,
    balance: ledger.balance,
  };
  const pill = loanStatusPill(merged);
  const alerts = Number((merged as { collectionAlerts?: number }).collectionAlerts) || 0;
  if (alerts >= 5) {
    return {
      ...merged,
      collectionAlerts: alerts,
      status: "Mora",
      kind: "overdue",
    } as T;
  }
  return {
    ...merged,
    collectionAlerts: alerts || undefined,
    status: pill.label,
    kind: pill.kind,
  } as T;
}

/** Préstamo con cronograma y totales recalculados (formato unificado P-8). */
export function syncLoan(
  loan: LoanTermsRow,
  payments?: { loanRef?: string; dueDate?: string; amount: number }[],
) {
  return normalizeLoan(standardizeLoanTerms(loan), payments);
}

export function syncAllLoans<T extends LoanTermsRow>(
  loans: T[],
  payments?: { loanRef?: string; dueDate?: string; amount: number }[],
): T[] {
  return loans.map((loan) => syncLoan(loan, payments) as T);
}
