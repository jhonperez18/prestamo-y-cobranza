/**
 * Limpia cobros del día que no cerraron visita en planilla
 * (o duplicados del mismo cliente/día). No deben vivir en Registros.
 */
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { paymentRefForMovement, type BankMovement } from "@/lib/bank";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { syncAllLoans } from "@/lib/loan-preview";

function paymentDay(payment: PaymentRow) {
  return (payment.paidDate || "").trim();
}

function clientRefForPayment(payment: PaymentRow, loans: LoanRow[]) {
  if (!payment.loanRef) return "";
  return loans.find((row) => row.ref === payment.loanRef)?.clientRef ?? "";
}

/**
 * Conserva solo cobros del día cuya visita quedó `cobrado` en planilla
 * (un código por cliente/préstamo). Elimina el resto.
 */
export function purgeUnclosedPlanillaPayments(input: {
  date?: string;
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  loans: LoanRow[];
}): { payments: PaymentRow[]; loans: LoanRow[]; removedRefs: string[] } {
  const date = input.date ?? todayIso();
  const dayAssignments = input.assignments.filter((row) => row.dispatchDate === date);

  const closedByLoan = new Map<string, string>();
  const closedByClient = new Map<string, string>();
  for (const row of dayAssignments) {
    if (row.visitStatus !== "cobrado") continue;
    const keepRef = row.paymentRef?.trim() || "";
    if (row.loanRef) closedByLoan.set(row.loanRef, keepRef);
    if (row.clientRef) closedByClient.set(row.clientRef, keepRef);
  }

  const dayPayments = input.payments.filter((row) => paymentDay(row) === date);
  const otherPayments = input.payments.filter((row) => paymentDay(row) !== date);

  const keep = new Set<string>();
  const byLoan = new Map<string, PaymentRow[]>();
  for (const payment of dayPayments) {
    const loanRef = payment.loanRef || "";
    const list = byLoan.get(loanRef) ?? [];
    list.push(payment);
    byLoan.set(loanRef, list);
  }

  for (const [loanRef, list] of byLoan) {
    const clientRef = list[0] ? clientRefForPayment(list[0], input.loans) : "";
    const closed =
      (loanRef && closedByLoan.has(loanRef)) ||
      (clientRef && closedByClient.has(clientRef));
    if (!closed) {
      // Sigue en “Por cobrar” → ningún PG de hoy debe estar en banco.
      continue;
    }
    const preferred =
      (loanRef && closedByLoan.get(loanRef)) ||
      (clientRef && closedByClient.get(clientRef)) ||
      "";
    const chosen =
      (preferred && list.find((row) => row.ref === preferred)) ||
      list.slice().sort((a, b) => b.ref.localeCompare(a.ref))[0];
    if (chosen) keep.add(chosen.ref);
  }

  const removedRefs: string[] = [];
  const keptDay: PaymentRow[] = [];
  for (const payment of dayPayments) {
    if (keep.has(payment.ref)) {
      keptDay.push(payment);
    } else {
      removedRefs.push(payment.ref);
    }
  }

  const payments = [...keptDay, ...otherPayments];
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
