/**
 * Utilidades de limpieza de movimientos bancarios tras dedupe de PG.
 * Ya no se borran cobros por “planilla pendiente”: eso se repara con
 * reconcilePaymentsOntoPlanilla (PG → visita cobrada).
 */
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { paymentRefForMovement, type BankMovement } from "@/lib/bank";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { syncAllLoans } from "@/lib/loan-preview";
import {
  dedupeDailyPaymentsByVisit,
  reconcilePaymentsOntoPlanilla,
} from "@/lib/planilla-payment-reconcile";

/**
 * @deprecated Prefer reconcilePaymentsOntoPlanilla + dedupeDailyPaymentsByVisit.
 * Conservado por compatibilidad: ahora sella visitas y solo quita PG duplicados.
 */
export function purgeUnclosedPlanillaPayments(input: {
  date?: string;
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  loans: LoanRow[];
}): { payments: PaymentRow[]; loans: LoanRow[]; removedRefs: string[] } {
  void input.date;
  void todayIso;
  const assignments = reconcilePaymentsOntoPlanilla(input.assignments, input.payments);
  const { payments, removedRefs } = dedupeDailyPaymentsByVisit(input.payments, assignments);
  const loans = syncAllLoans(input.loans, payments) as LoanRow[];
  return { payments, loans, removedRefs };
}

/** Quita del libro banco los movimientos de cobros eliminados. */
export function stripRemovedPaymentMovements(
  movements: BankMovement[],
  removedRefs: string[],
): BankMovement[] {
  if (!removedRefs.length) return movements;
  const drop = new Set(removedRefs);
  return movements.filter((row) => {
    const pg = paymentRefForMovement(row);
    return !pg || !drop.has(pg);
  });
}
