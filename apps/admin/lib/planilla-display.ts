/**
 * Vista unificada de planilla (supervisor / cobrador / resumen):
 * progreso de cuotas (paid/expected + intensidad) desde plata y calendario.
 * Cuota del día desde amountDue o respaldo de cuota del préstamo.
 */
import { accumulatedDueForLoan } from "@/lib/daily-collection-plan";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { syncLoan } from "@/lib/loan-preview";
import {
  computeLoanCuotasProgress,
  type CuotasProgress,
} from "@/lib/loan-cuotas-progress";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { todayIso } from "@/lib/daily-dispatch";
import {
  normalizePaymentMethod,
  type PaymentMethod,
} from "@/lib/payment-method";

export function planillaVisitPaid(row: Pick<DailyCollectionAssignment, "visitStatus" | "paymentRef">) {
  return (
    row.visitStatus === "cobrado" ||
    row.visitStatus === "parcial" ||
    Boolean(row.paymentRef?.trim())
  );
}

export function planillaLiveCuotasProgress(
  loan: LoanRow | null | undefined,
  payments: PaymentRow[],
  today = todayIso(),
): CuotasProgress {
  return computeLoanCuotasProgress(loan, payments, today);
}

export function planillaLiveCuota(
  row: DailyCollectionAssignment,
  loan: LoanRow | null | undefined,
  today = todayIso(),
): number {
  if (row.awaitingLoan) return 0;
  if (planillaVisitPaid(row) || row.visitStatus === "omitido") {
    return Number(row.amountDue) > 0 ? Number(row.amountDue) : 0;
  }
  if (Number(row.amountDue) > 0) return Number(row.amountDue);
  if (!loan) return 0;
  const due = accumulatedDueForLoan(loan, today).amountDue;
  if (due > 0) return due;
  const installment = Number(loan.installment) || 0;
  if (installment > 0) return Math.min(installment, Number(loan.balance) || installment);
  return 0;
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
  const cuota = planillaLiveCuota(row, loan, today);
  const saldo = loan?.balance ?? 0;
  const pay =
    (row.paymentRef
      ? payments.find((entry) => entry.ref === row.paymentRef)
      : undefined) ??
    payments.find(
      (entry) =>
        entry.loanRef === row.loanRef &&
        (entry.paidDate === today || entry.paidDate === row.dispatchDate),
    );
  const method: PaymentMethod | null = pay
    ? normalizePaymentMethod(pay.method)
    : null;
  return {
    key: `${row.itemId}-${row.collectorRef}-${row.dispatchDate}`,
    index,
    clientName: row.clientName,
    saldo,
    cuota,
    method,
    cuotas,
    visitStatus: row.visitStatus,
  };
}
