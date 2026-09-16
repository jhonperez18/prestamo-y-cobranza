/**
 * Progreso de cuotas (reemplazo operativo de Alerta 1–3 / Mora en planilla).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGLAS FIRMES (no reinterpretar en UI):
 *
 * 1. Calendario de cobro = mismas fechas del préstamo (schedule) o, si no hay,
 *    lun–sáb sin festivos CO desde el día siguiente al desembolso
 *    (igual que `collectionDatesForTerm` / cronograma).
 *
 * 2. expected(asOf) = cuántas fechas de cobro caen en [primera, asOf] inclusive.
 *    Antes del primer cobro → 0 (no mostrar ratio).
 *    Nunca supera el total de cuotas del acuerdo.
 *
 * 3. paid = floor(paidTotal / installment)  (plata, no “número de PG-”).
 *    Una cuota grande que cubre N días sube `paid` en N.
 *    capped a installmentsTotal.
 *
 * 4. lagDays (atraso en “días-cuota”) se calcula SOLO por plata:
 *      behind = max(0, expected * installment − paidTotal)
 *      lagDays = ceil(behind / installment)
 *    Así, si el ratio se viera “feo” pero el saldo ya cubrió lo esperado,
 *    lagDays = 0 y la barra baja.
 *
 * 5. Intensidad (barra al lado del denominador):
 *      lagDays ≤ 2 → 0 (tranquilo)
 *      lagDays = 3 → 1 (amarillo nace)
 *      lagDays = 4 → 2
 *      lagDays = 5 → 3
 *      lagDays ≥ 6 → 4 (máximo)
 *
 * 6. Display: `${paid}/${expected}` solo si expected > 0.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { addCalendarDaysIso, isDailyCollectionDay } from "@/lib/colombia-holidays";
import { todayIso } from "@/lib/daily-dispatch";
import {
  displayToIso,
  isFlatLoanTerms,
  loanPreviewFromRow,
} from "@/lib/loan-preview";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";

export const CUOTAS_LAG_YELLOW_FROM = 3;
export const CUOTAS_INTENSITY_MAX = 4;

export type CuotasProgress = {
  /** Cuotas cubiertas por dinero: floor(paidTotal / installment). */
  paid: number;
  /** Cuotas que debían ir pagadas a la fecha (días/fechas de cobro vencidos). */
  expected: number;
  /** Total de cuotas del acuerdo (denominador máximo del plazo). */
  total: number;
  paidTotal: number;
  installment: number;
  /** Días-cuota de atraso monetario (fuente de la barra). */
  lagDays: number;
  /** 0..4 intensidad visual. */
  intensity: number;
  /** Texto corto `2/15` o vacío si aún no arranca cobro. */
  label: string;
  title: string;
};

function pesos(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function uniqueSortedIsos(dates: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of dates) {
    const d = String(raw || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  out.sort();
  return out;
}

/**
 * Fechas de cobro del préstamo (sin capital aparte).
 * Prioridad: schedule guardado → preview → reconstrucción diaria por `days`.
 */
export function loanCollectionDateIsos(loan: Pick<LoanRow, "date" | "due" | "frequency" | "days" | "schedule" | "capital" | "interest" | "total" | "installment" | "mode" | "pact" | "rate">): string[] {
  const fromSchedule = uniqueSortedIsos(
    (loan.schedule ?? [])
      .filter((line) => (line.kind ?? "cuota") !== "capital")
      .map((line) => line.date),
  );
  if (fromSchedule.length > 0) return fromSchedule;

  const preview = loanPreviewFromRow(loan);
  if (preview?.dates?.length) return uniqueSortedIsos(preview.dates);

  const startIso = displayToIso(loan.date);
  if (!startIso) return [];
  const frequency = loan.frequency ?? "diario";
  if (frequency !== "diario") return [];

  const target = Math.max(1, pesos(Number(loan.days) || 0) || 30);
  const dates: string[] = [];
  let cur = addCalendarDaysIso(startIso, 1);
  let guard = 0;
  while (dates.length < target && guard < 900) {
    if (isDailyCollectionDay(cur)) dates.push(cur);
    cur = addCalendarDaysIso(cur, 1);
    guard += 1;
  }
  return dates;
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

  const dates = loanCollectionDateIsos(loan);
  const total = dates.length;
  const expected = dates.filter((d) => d <= asOf).length;

  const loanPays = payments.filter((row) => row.loanRef === loan.ref);
  const paidTotal = loanPays.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const preview = loanPreviewFromRow(loan);
  const installment = pesos(
    Number(loan.installment) ||
      Number(preview?.installment) ||
      (total > 0 && isFlatLoanTerms(loan)
        ? pesos((Number(loan.total) || Number(loan.capital) + Number(loan.interest || 0)) / total)
        : 0),
  );

  const paidRaw =
    installment > 0
      ? Math.floor(paidTotal / installment + 1e-9)
      : 0;
  const paid = total > 0 ? Math.min(total, Math.max(0, paidRaw)) : Math.max(0, paidRaw);

  // Atraso monetario: no usar paid vs expected a ciegas (cuota grande / residuo).
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
      ? `Cuotas ${label} · al día (esperado a hoy: ${expected})`
      : lagDays < CUOTAS_LAG_YELLOW_FROM
        ? `Cuotas ${label} · atraso leve (${lagDays} día${lagDays === 1 ? "" : "s"}-cuota)`
        : `Cuotas ${label} · atraso ${lagDays} días-cuota (barra nivel ${intensity})`;

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
