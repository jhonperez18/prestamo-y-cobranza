/**
 * Vista unificada de planilla (supervisor / cobrador / resumen):
 * alertas en vivo desde el préstamo; se ocultan si ya pagó hoy.
 * Cuota desde amountDue o respaldo de cuota del préstamo.
 */
import {
  COLLECTION_ALERTS_BEFORE_MORA,
  collectionAlertLabel,
  liveLoanCollectionAlerts,
  loanPaidOnDate,
} from "@/lib/collection-alerts";
import { accumulatedDueForLoan } from "@/lib/daily-collection-plan";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { syncLoan } from "@/lib/loan-preview";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { todayIso } from "@/lib/daily-dispatch";

export function planillaVisitPaid(row: Pick<DailyCollectionAssignment, "visitStatus" | "paymentRef">) {
  return (
    row.visitStatus === "cobrado" ||
    row.visitStatus === "parcial" ||
    Boolean(row.paymentRef?.trim())
  );
}

/** Contador para badge: 0 si pagó; 1–3 alerta; 4 = mora (mostrar como M). */
export function planillaLiveAlertCount(
  row: DailyCollectionAssignment,
  loan: LoanRow | null | undefined,
  payments: PaymentRow[],
  today = todayIso(),
): number {
  if (planillaVisitPaid(row)) return 0;
  const loanRef = loan?.ref || row.loanRef;
  if (loanPaidOnDate(loanRef, payments, today)) return 0;
  if (loan) return liveLoanCollectionAlerts(loan, payments, today);
  return Number(row.alertCount) || 0;
}

export function planillaAlertBadgeText(alertCount: number) {
  if (alertCount <= 0) return "";
  if (alertCount >= COLLECTION_ALERTS_BEFORE_MORA) return "M";
  return String(alertCount);
}

export function planillaAlertTitle(alertCount: number) {
  if (alertCount <= 0) return undefined;
  if (alertCount >= COLLECTION_ALERTS_BEFORE_MORA) {
    return "Mora · alerta 4 (4 días hábiles sin pago)";
  }
  return (
    collectionAlertLabel(alertCount) ||
    `Alerta ${alertCount} · días hábiles sin pago (si no paga hoy, mañana sube)`
  );
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
  const alertCount = planillaLiveAlertCount(row, loan, payments, today);
  const cuota = planillaLiveCuota(row, loan, today);
  const saldo = loan?.balance ?? 0;
  return {
    key: `${row.itemId}-${row.collectorRef}-${row.dispatchDate}`,
    index,
    clientName: row.clientName,
    saldo,
    cuota,
    alertCount,
    alertBadge: planillaAlertBadgeText(alertCount),
    alertTitle: planillaAlertTitle(alertCount),
    visitStatus: row.visitStatus,
    inMora: alertCount >= COLLECTION_ALERTS_BEFORE_MORA,
  };
}
