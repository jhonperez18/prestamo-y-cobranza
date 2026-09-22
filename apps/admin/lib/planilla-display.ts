/**
 * Vista unificada de planilla (supervisor / cobrador / resumen).
 *
 * Contrato de cuota en cobro:
 * - En planilla y default de pago = cuota PACTADA del préstamo
 *   (valor fijo diario/semanal/mensual de la ficha), tope saldo.
 * - El cobrador puede escribir otro valor (adelanto o atrasos).
 * - Mora/alertas usan otro módulo; no inflan el monto de cuota.
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { syncLoan } from "@/lib/loan-preview";
import {
  computeLoanCuotasProgress,
  type CuotasProgress,
} from "@/lib/loan-cuotas-progress";
import { isPaymentLive } from "@/lib/live-payments";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { todayIso } from "@/lib/daily-dispatch";
import {
  normalizePaymentMethod,
  type PaymentMethod,
} from "@/lib/payment-method";
import { paymentBelongsToVisit } from "@/lib/planilla-payment-reconcile";

export function planillaVisitPaid(row: Pick<DailyCollectionAssignment, "visitStatus" | "paymentRef">) {
  return (
    row.visitStatus === "cobrado" ||
    row.visitStatus === "parcial" ||
    Boolean(row.paymentRef?.trim())
  );
}

/**
 * PG vivo del día para esta visita.
 * E/N solo con pago vivo: PG anulado o de otro préstamo no pintan método.
 */
export function planillaLivePaymentForVisit(
  row: DailyCollectionAssignment,
  payments: PaymentRow[],
  today = todayIso(),
): PaymentRow | undefined {
  const linkedRef = (row.paymentRef || "").trim();
  if (linkedRef) {
    const linked = payments.find((entry) => entry.ref === linkedRef);
    if (linked && paymentBelongsToVisit(linked, row)) return linked;
  }
  const day = (row.dispatchDate || today || "").trim();
  if (!day || !row.loanRef) return undefined;
  return payments.find(
    (entry) =>
      isPaymentLive(entry) &&
      (entry.paidDate || "").trim() === day &&
      paymentBelongsToVisit(entry, row),
  );
}

/**
 * Cuota pactada = valor de cada cobro de la ficha, tope saldo.
 * Misma cifra en planilla, default de pago y reportes.
 */
export function planillaCuotaPactada(loan: LoanRow | null | undefined): number {
  if (!loan) return 0;
  const synced = syncLoan(loan) as LoanRow;
  const installment = Math.trunc(Number(synced.installment) || 0);
  if (installment <= 0) return 0;
  const balance = Math.trunc(Number(synced.balance) || 0);
  if (balance <= 0) return 0;
  return Math.min(installment, balance);
}

export function planillaLiveCuotasProgress(
  loan: LoanRow | null | undefined,
  payments: PaymentRow[],
  today = todayIso(),
): CuotasProgress {
  return computeLoanCuotasProgress(loan, payments, today);
}

/**
 * Monto de cuota en planilla = siempre la pactada de la ficha.
 * El cobrado real (si el cobrador escribió otro valor) vive en el PG- / reportes.
 */
export function planillaLiveCuota(
  row: DailyCollectionAssignment,
  loan: LoanRow | null | undefined,
  _payments: PaymentRow[] = [],
  _today = todayIso(),
): number {
  if (row.awaitingLoan) return 0;
  return planillaCuotaPactada(loan);
}

export function planillaSyncedLoan(
  loans: LoanRow[],
  loanRef: string | undefined,
  payments: PaymentRow[],
): LoanRow | null {
  if (!loanRef) return null;
  const raw = loans.find((row) => row.ref === loanRef);
  return raw ? (syncLoan(raw, payments) as LoanRow) : null;
}

export function enrichSupervisorPlanillaRow(
  row: DailyCollectionAssignment,
  index: number,
  loans: LoanRow[],
  payments: PaymentRow[],
  today = todayIso(),
) {
  const loan = planillaSyncedLoan(loans, row.loanRef, payments);
  const cuotas = planillaLiveCuotasProgress(loan, payments, today);
  const cuota = planillaLiveCuota(row, loan, payments, today);
  const saldo = loan?.balance ?? 0;
  const pay = planillaLivePaymentForVisit(row, payments, today);
  /** E/N solo con PG vivo; si hay pago, estado = cobrado (nunca E + Pend.). */
  const method: PaymentMethod | null = pay
    ? normalizePaymentMethod(pay.method)
    : null;
  let visitStatus = row.visitStatus ?? "pendiente";
  if (pay) {
    visitStatus = row.visitStatus === "parcial" ? "parcial" : "cobrado";
  } else if (visitStatus === "cobrado" || visitStatus === "parcial") {
    visitStatus = "pendiente";
  }
  return {
    key: `${row.itemId}-${row.collectorRef}-${row.dispatchDate}`,
    index,
    clientName: row.clientName,
    saldo,
    cuota,
    method,
    cuotas,
    visitStatus,
  };
}
