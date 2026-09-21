/**
 * Une cobros (PG) con visitas de planilla.
 * Regla: si existe pago vivo del día → visita cobrada.
 * Si el PG se anula → la visita vuelve a pendiente (reversa).
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { accumulatedDueForLoan } from "@/lib/daily-collection-plan";
import { isPaymentLive } from "@/lib/live-payments";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";

function sameDay(a: string | undefined, b: string) {
  return (a || "").trim() === b.trim();
}

function normalizePersonName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Nombre exacto (EDUARDO ≠ EDUARDO P). Nunca usar startsWith entre fichas distintas. */
function clientNamesMatch(payClient: string, visitClient: string) {
  const a = normalizePersonName(payClient);
  const b = normalizePersonName(visitClient);
  if (!a || !b) return false;
  return a === b;
}

function paymentMatchesVisit(pay: PaymentRow, row: DailyCollectionAssignment) {
  if (pay.collectorRef && row.collectorRef && pay.collectorRef !== row.collectorRef) {
    return false;
  }
  // Préstamo manda: un PG de P-0 no puede cerrar la visita de P-18.
  if (pay.loanRef && row.loanRef) {
    return pay.loanRef === row.loanRef;
  }
  if (pay.loanRef && !row.loanRef) return false;
  if (!pay.loanRef && row.loanRef) {
    return clientNamesMatch(pay.client || "", row.clientName || "");
  }
  return clientNamesMatch(pay.client || "", row.clientName || "");
}

/** El PG enlazado pertenece a esta visita (mismo préstamo). */
export function paymentBelongsToVisit(
  pay: PaymentRow | undefined,
  row: DailyCollectionAssignment,
): boolean {
  if (!pay || !isPaymentLive(pay)) return false;
  return paymentMatchesVisit(pay, row);
}

function restoreAmountDue(
  row: DailyCollectionAssignment,
  loans: LoanRow[] | undefined,
): number {
  const loan = loans?.find((entry) => entry.ref === row.loanRef);
  if (loan) {
    const due = accumulatedDueForLoan(loan, row.dispatchDate);
    if (due.amountDue > 0) return due.amountDue;
    const installment = Number(loan.installment) || 0;
    const balance = Number(loan.balance) || 0;
    if (installment > 0) return Math.min(installment, balance > 0 ? balance : installment);
    if (balance > 0) return balance;
  }
  return Math.max(0, Number(row.amountDue) || 0);
}

/**
 * Marca cobrado si hay PG vivo del día; si el PG apuntado fue anulado, revierte a pendiente.
 */
export function reconcilePaymentsOntoPlanilla(
  assignments: DailyCollectionAssignment[],
  payments: PaymentRow[],
  loans?: LoanRow[],
): DailyCollectionAssignment[] {
  if (!assignments.length) return assignments;

  const live = payments.filter(isPaymentLive);
  const liveByRef = new Map(live.map((row) => [row.ref, row] as const));

  return assignments.map((row) => {
    if (row.awaitingLoan) return row;
    if (row.visitStatus === "omitido") return row;

    const linkedRef = (row.paymentRef || "").trim();
    const linkedPay = linkedRef ? liveByRef.get(linkedRef) : undefined;
    const linkedOk = Boolean(linkedPay && paymentBelongsToVisit(linkedPay, row));

    if (
      linkedRef &&
      (row.visitStatus === "cobrado" || row.visitStatus === "parcial") &&
      !linkedOk
    ) {
      // PG anulado, ausente o de OTRO préstamo/cliente → vuelve a pendiente.
      return {
        ...row,
        visitStatus: "pendiente" as const,
        paymentRef: undefined,
        dayClosedAt: undefined,
        skipReason: undefined,
        amountDue: restoreAmountDue(row, loans),
      };
    }

    // Cobrado sin PG vivo (ref borrada o anulado): también reabrir.
    if (
      (row.visitStatus === "cobrado" || row.visitStatus === "parcial") &&
      !linkedRef
    ) {
      return {
        ...row,
        visitStatus: "pendiente" as const,
        paymentRef: undefined,
        dayClosedAt: undefined,
        skipReason: undefined,
        amountDue: restoreAmountDue(row, loans),
      };
    }

    if (row.visitStatus === "cobrado" && linkedOk) {
      return row;
    }

    const day = row.dispatchDate;
    const match = live.find(
      (pay) => sameDay(pay.paidDate, day) && paymentMatchesVisit(pay, row),
    );

    if (!match) return row;
    return {
      ...row,
      loanRef: row.loanRef || match.loanRef || "",
      amountDue: 0,
      visitStatus: "cobrado" as const,
      paymentRef: match.ref,
    };
  });
}

/**
 * Días abiertos atrasados: si el cobro quedó registrado en un día posterior
 * (mismo cliente/préstamo), sella la visita atrasada como cobrada.
 * Así al cerrar el 07 no marca “omitido/alerta” a quien ya pagó el 08.
 */
export function sealOpenVisitsWithLaterPayments(
  assignments: DailyCollectionAssignment[],
  payments: PaymentRow[],
  opts?: { date?: string; collectorRef?: string; untilDate?: string },
): DailyCollectionAssignment[] {
  if (!assignments.length || !payments.length) return assignments;
  const until = (opts?.untilDate || "").trim();
  const live = payments.filter(isPaymentLive);

  return assignments.map((row) => {
    if (opts?.date && row.dispatchDate !== opts.date) return row;
    if (opts?.collectorRef && row.collectorRef !== opts.collectorRef) return row;
    if (row.awaitingLoan) return row;
    if (row.dayClosedAt) return row;
    if (row.visitStatus === "omitido") return row;

    const linkedRef = (row.paymentRef || "").trim();
    if (row.visitStatus === "cobrado" && linkedRef) {
      const linked = live.find((p) => p.ref === linkedRef);
      if (!linked || !paymentBelongsToVisit(linked, row)) {
        return {
          ...row,
          visitStatus: "pendiente" as const,
          paymentRef: undefined,
        };
      }
      return row;
    }

    const day = (row.dispatchDate || "").trim();
    if (!day) return row;

    const match = live
      .filter((pay) => {
        const paid = (pay.paidDate || "").trim();
        if (!paid || paid < day) return false;
        if (until && paid > until) return false;
        return paymentMatchesVisit(pay, row);
      })
      .sort((a, b) => (a.paidDate || "").localeCompare(b.paidDate || ""))[0];

    if (!match) return row;
    return {
      ...row,
      loanRef: row.loanRef || match.loanRef || "",
      amountDue: 0,
      alertCount: 0,
      kind: "cuota" as const,
      chargeLabel: "Cuota",
      visitStatus: "cobrado" as const,
      paymentRef: match.ref,
    };
  });
}

/** Tras reconciliar, deja un solo PG por préstamo/día (el de la visita). */
export function dedupeDailyPaymentsByVisit(
  payments: PaymentRow[],
  assignments: DailyCollectionAssignment[],
): { payments: PaymentRow[]; removedRefs: string[] } {
  const keep = new Set<string>();
  for (const row of assignments) {
    if (row.paymentRef) keep.add(row.paymentRef);
  }

  const removedRefs: string[] = [];
  const byLoanDay = new Map<string, PaymentRow[]>();
  for (const pay of payments) {
    if (!isPaymentLive(pay)) continue;
    const day = (pay.paidDate || "").trim();
    const loan = pay.loanRef || "";
    if (!day || !loan) continue;
    const key = `${loan}::${day}`;
    const list = byLoanDay.get(key) ?? [];
    list.push(pay);
    byLoanDay.set(key, list);
  }

  const drop = new Set<string>();
  for (const [, list] of byLoanDay) {
    if (list.length <= 1) continue;
    const preferred =
      list.find((row) => keep.has(row.ref)) ??
      list.slice().sort((a, b) => b.ref.localeCompare(a.ref))[0];
    for (const row of list) {
      if (row.ref !== preferred?.ref) drop.add(row.ref);
    }
  }

  const next: PaymentRow[] = [];
  for (const pay of payments) {
    if (drop.has(pay.ref)) removedRefs.push(pay.ref);
    else next.push(pay);
  }
  return { payments: next, removedRefs };
}
