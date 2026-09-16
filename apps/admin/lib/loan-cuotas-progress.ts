/**
 * Progreso de cuotas / columna Mora (planilla).
 *
 * Fuente de verdad única — no reinterpretar en UI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGLAS:
 *
 * 1. Calendario = fechas de cobro del préstamo (schedule normalizado a ISO),
 *    o preview/cronograma estándar (lun–sáb, sin festivos CO).
 *    Nunca usar `loan.days` (días calendario) como número de cuotas.
 *
 * 2. expected(asOf) = cuántas fechas de cobro ≤ asOf.
 *    Antes del primer cobro → 0 (sin label).
 *
 * 3. paid = floor(paidTotalHastaAsOf / installment).
 *    Cuota grande sube varias. Solo pagos con fecha ≤ asOf.
 *
 * 4. lagDays (barra) solo por plata:
 *      behind = max(0, expected * installment − paidTotal)
 *      lagDays = ceil(behind / installment)
 *
 * 5. Intensidad:
 *      ≤2 → 0 | 3 → 1 (amarillo) | 4 → 2 | 5 → 3 | ≥6 → 4
 *
 * 6. Label: `${paid}/${expected}` si expected > 0.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { addCalendarDaysIso, isDailyCollectionDay } from "@/lib/colombia-holidays";
import { todayIso } from "@/lib/daily-dispatch";
import {
  collectionDatesForTerm,
  displayToIso,
  installmentCountForTerm,
  isFlatLoanTerms,
  loanPreviewFromRow,
  type LoanTermMonths,
  type PayFrequency,
} from "@/lib/loan-preview";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";

export const CUOTAS_LAG_YELLOW_FROM = 3;
export const CUOTAS_INTENSITY_MAX = 4;

export type CuotasProgress = {
  paid: number;
  expected: number;
  total: number;
  paidTotal: number;
  installment: number;
  lagDays: number;
  intensity: number;
  label: string;
  title: string;
};

function pesos(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

/** ISO o dd/mm/aaaa → ISO. */
export function toCollectionIso(raw: string | undefined | null) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return displayToIso(value);
}

function uniqueSortedIsos(dates: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of dates) {
    const iso = toCollectionIso(raw);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push(iso);
  }
  out.sort();
  return out;
}

function termMonthsFromLoan(loan: Pick<LoanRow, "date" | "due" | "days">): LoanTermMonths {
  const start = toCollectionIso(loan.date);
  const due = toCollectionIso(loan.due);
  if (start && due && due > start) {
    const ms = Date.parse(`${due}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`);
    const calendarDays = Math.max(1, Math.round(ms / 86400000));
    const months = Math.max(1, Math.round(calendarDays / 30)) as LoanTermMonths;
    if (months === 1 || months === 2 || months === 3) return months;
  }
  return 1;
}

function expectedCuotaCount(
  loan: Pick<LoanRow, "date" | "due" | "days" | "frequency" | "installment" | "total" | "capital" | "interest">,
  previewCount: number,
): number {
  if (previewCount > 0) return previewCount;
  const installment = pesos(Number(loan.installment) || 0);
  const total = pesos(
    Number(loan.total) || Number(loan.capital) + Number(loan.interest || 0),
  );
  if (installment > 0 && total > 0) {
    return Math.max(1, Math.round(total / installment));
  }
  const frequency = (loan.frequency ?? "diario") as PayFrequency;
  return installmentCountForTerm(frequency, termMonthsFromLoan(loan));
}

/**
 * Fechas de cobro del préstamo (sin capital).
 * Prioridad: schedule usable → preview → reconstrucción por frecuencia/cuotas.
 */
export function loanCollectionDateIsos(
  loan: Pick<
    LoanRow,
    | "date"
    | "due"
    | "frequency"
    | "days"
    | "schedule"
    | "capital"
    | "interest"
    | "total"
    | "installment"
    | "mode"
    | "pact"
    | "rate"
  >,
): string[] {
  const preview = loanPreviewFromRow(loan);
  const targetCount = expectedCuotaCount(loan, preview?.count ?? preview?.dates?.length ?? 0);

  const fromSchedule = uniqueSortedIsos(
    (loan.schedule ?? [])
      .filter((line) => (line.kind ?? "cuota") !== "capital")
      .map((line) => line.date),
  );

  // Schedule completo (o casi) manda; incompleto → preview.
  if (fromSchedule.length > 0) {
    if (targetCount <= 0 || fromSchedule.length >= Math.max(1, targetCount - 1)) {
      return fromSchedule;
    }
  }

  if (preview?.dates?.length) return uniqueSortedIsos(preview.dates);

  const startIso = toCollectionIso(loan.date);
  if (!startIso) return fromSchedule;
  const frequency = (loan.frequency ?? "diario") as PayFrequency;
  const count = Math.max(1, targetCount || fromSchedule.length || 30);

  if (frequency === "diario") {
    const dates: string[] = [];
    let cur = addCalendarDaysIso(startIso, 1);
    let guard = 0;
    while (dates.length < count && guard < 900) {
      if (isDailyCollectionDay(cur)) dates.push(cur);
      cur = addCalendarDaysIso(cur, 1);
      guard += 1;
    }
    return dates;
  }

  const termMonths = termMonthsFromLoan(loan);
  const rebuilt = collectionDatesForTerm(startIso, frequency, termMonths);
  if (rebuilt.length) return uniqueSortedIsos(rebuilt);
  return fromSchedule;
}

export function cuotasIntensityFromLag(lagDays: number): number {
  const lag = Math.max(0, Math.trunc(lagDays));
  if (lag <= 2) return 0;
  if (lag === 3) return 1;
  if (lag === 4) return 2;
  if (lag === 5) return 3;
  return CUOTAS_INTENSITY_MAX;
}

export function computeLoanCuotasProgress(
  loan: LoanRow | null | undefined,
  payments: PaymentRow[],
  asOf = todayIso(),
): CuotasProgress {
  const empty: CuotasProgress = {
    paid: 0,
    expected: 0,
    total: 0,
    paidTotal: 0,
    installment: 0,
    lagDays: 0,
    intensity: 0,
    label: "",
    title: "Sin préstamo activo",
  };
  if (!loan?.ref || !asOf) return empty;

  const asOfIso = toCollectionIso(asOf) || asOf;
  const dates = loanCollectionDateIsos(loan);
  const total = dates.length;
  const expected = dates.filter((d) => d <= asOfIso).length;

  const paidTotal = payments
    .filter((row) => {
      if (row.loanRef !== loan.ref) return false;
      if ((Number(row.amount) || 0) <= 0) return false;
      const payDay = toCollectionIso(row.paidDate || row.when || "");
      if (!payDay) return true; // sin fecha: cuenta (cobro vivo)
      return payDay <= asOfIso;
    })
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const preview = loanPreviewFromRow(loan);
  const installment = pesos(
    Number(loan.installment) ||
      Number(preview?.installment) ||
      (total > 0 && isFlatLoanTerms(loan)
        ? pesos((Number(loan.total) || Number(loan.capital) + Number(loan.interest || 0)) / total)
        : 0),
  );

  const paidRaw = installment > 0 ? Math.floor(paidTotal / installment + 1e-9) : 0;
  const paid = total > 0 ? Math.min(total, Math.max(0, paidRaw)) : Math.max(0, paidRaw);

  const expectedAmount = installment > 0 ? expected * installment : 0;
  const behind = Math.max(0, expectedAmount - paidTotal);
  const lagDays =
    installment > 0 && behind > 0
      ? Math.max(0, Math.ceil(behind / installment - 1e-9))
      : 0;
  const intensity = cuotasIntensityFromLag(lagDays);

  if (expected <= 0) {
    return {
      paid,
      expected: 0,
      total,
      paidTotal,
      installment,
      lagDays: 0,
      intensity: 0,
      label: "",
      title: "Aún no inicia el cobro (primer día hábil después del desembolso)",
    };
  }

  const label = `${paid}/${expected}`;
  const title =
    lagDays <= 0
      ? `Mora ${label} · al día (esperado a hoy: ${expected})`
      : lagDays < CUOTAS_LAG_YELLOW_FROM
        ? `Mora ${label} · atraso leve (${lagDays} día${lagDays === 1 ? "" : "s"}-cuota)`
        : `Mora ${label} · atraso ${lagDays} días-cuota (barra nivel ${intensity})`;

  return {
    paid,
    expected,
    total,
    paidTotal,
    installment,
    lagDays,
    intensity,
    label,
    title,
  };
}
