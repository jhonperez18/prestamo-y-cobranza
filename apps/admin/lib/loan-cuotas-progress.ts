/**
 * Columna Mora = progreso de cuotas vs ficha del préstamo.
 *
 * Misma fuente que «Nuevo préstamo» / «Ficha del préstamo»:
 *   syncLoan → cronograma + valor cuota + N cuotas (plazo).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGLAS (no reinterpretar en UI):
 *
 * 1. Cronograma = schedule del préstamo sincronizado (lun–sáb, sin festivos),
 *    idéntico al de la ficha («35 días · 30 cuotas»).
 *
 * 2. installment = valor de cada cuota de la ficha.
 *
 * 3. expected = cuántas fechas del cronograma son ≤ hoy
 *    («días que van» de cobro).
 *
 * 4. covered = floor(paidTotal / installment)
 *    (cuota grande cubre varias; plata es la verdad).
 *
 * 5. paid (display) = min(covered, expected)
 *    Nunca 20/9: si adelantó, se ve 9/9 y la barra en verde.
 *
 * 6. lagDays (barra) solo por plata vs lo esperado a hoy:
 *      behind = max(0, expected * installment − paidTotal)
 *      lagDays = ceil(behind / installment)
 *      ≤2 → 0 | 3 → 1 (amarillo) | 4 → 2 | 5 → 3 | ≥6 → 4
 *
 * 7. Label: `${paid}/${expected}` si expected > 0.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { todayIso } from "@/lib/daily-dispatch";
import {
  displayToIso,
  interestChargeCount,
  syncLoan,
} from "@/lib/loan-preview";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";

export const CUOTAS_LAG_YELLOW_FROM = 3;
export const CUOTAS_INTENSITY_MAX = 4;

export type CuotasProgress = {
  /** Cubiertas entre las esperadas a hoy (para el label). */
  paid: number;
  /** Días/cuotas del cronograma vencidos a hoy. */
  expected: number;
  /** Total de cuotas del acuerdo (ficha: «30 cuotas»). */
  total: number;
  /** Cuotas cubiertas por plata en todo el préstamo (puede ser > expected). */
  covered: number;
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

/**
 * Fechas de cobro = mismas de la ficha (tras syncLoan).
 * Sin capital aparte; orden ISO.
 */
export function loanCollectionDateIsos(loan: LoanRow): string[] {
  const synced = syncLoan(loan) as LoanRow;
  const fromSchedule = uniqueSortedIsos(
    (synced.schedule ?? [])
      .filter((line) => (line.kind ?? "cuota") !== "capital")
      .map((line) => line.date),
  );
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
    covered: 0,
    paidTotal: 0,
    installment: 0,
    lagDays: 0,
    intensity: 0,
    label: "",
    title: "Sin préstamo activo",
  };
  if (!loan?.ref || !asOf) return empty;

  // Misma normalización que la ficha del préstamo.
  const synced = syncLoan(loan, payments) as LoanRow;
  const asOfIso = toCollectionIso(asOf) || asOf;

  const dates = uniqueSortedIsos(
    (synced.schedule ?? [])
      .filter((line) => (line.kind ?? "cuota") !== "capital")
      .map((line) => line.date),
  );
  const total = dates.length || interestChargeCount(synced.schedule ?? []);
  const expected = Math.min(total, dates.filter((d) => d <= asOfIso).length);

  const paidTotal = payments
    .filter((row) => {
      if (row.loanRef !== synced.ref) return false;
      if ((Number(row.amount) || 0) <= 0) return false;
      const payDay = toCollectionIso(row.paidDate || "");
      if (!payDay) return true;
      return payDay <= asOfIso;
    })
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  const installment = pesos(Number(synced.installment) || 0);
  const covered =
    installment > 0
      ? Math.min(total || Number.MAX_SAFE_INTEGER, Math.floor(paidTotal / installment + 1e-9))
      : 0;
  // Display vs días que van: no superar lo esperado (adelanto → 9/9, no 20/9).
  const paid = Math.min(covered, expected);

  const expectedAmount = installment > 0 ? expected * installment : 0;
  const behind = Math.max(0, expectedAmount - paidTotal);
  const lagDays =
    installment > 0 && behind > 0
      ? Math.max(0, Math.ceil(behind / installment - 1e-9))
      : 0;
  const intensity = cuotasIntensityFromLag(lagDays);

  if (expected <= 0) {
    return {
      paid: 0,
      expected: 0,
      total,
      covered,
      paidTotal,
      installment,
      lagDays: 0,
      intensity: 0,
      label: "",
      title: "Aún no inicia el cobro (primer día hábil después del desembolso)",
    };
  }

  const label = `${paid}/${expected}`;
  const ahead = covered > expected;
  const title = ahead
    ? `Mora ${label} · al día (cubrió ${covered} de ${total} cuotas; esperado a hoy ${expected})`
    : lagDays <= 0
      ? `Mora ${label} · al día · ${total} cuotas del acuerdo`
      : lagDays < CUOTAS_LAG_YELLOW_FROM
        ? `Mora ${label} · atraso leve (${lagDays} día${lagDays === 1 ? "" : "s"}-cuota)`
        : `Mora ${label} · atraso ${lagDays} días-cuota (barra nivel ${intensity})`;

  return {
    paid,
    expected,
    total,
    covered,
    paidTotal,
    installment,
    lagDays,
    intensity,
    label,
    title,
  };
}
