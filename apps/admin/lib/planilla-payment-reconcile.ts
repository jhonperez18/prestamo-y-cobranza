/**
 * Une cobros (PG) con visitas de planilla.
 * Regla: si existe pago del día para el préstamo/cliente, la visita queda cobrada.
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { PaymentRow } from "@/lib/mock-data";

function sameDay(a: string | undefined, b: string) {
  return (a || "").trim() === b.trim();
}

function clientNamesMatch(payClient: string, visitClient: string) {
  const a = payClient.trim().toLowerCase();
  const b = visitClient.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || b.startsWith(a) || a.startsWith(b);
}

function paymentMatchesVisit(pay: PaymentRow, row: DailyCollectionAssignment) {
  if (pay.collectorRef && row.collectorRef && pay.collectorRef !== row.collectorRef) {
    return false;
  }
  if (pay.loanRef && row.loanRef && pay.loanRef === row.loanRef) return true;
  return clientNamesMatch(pay.client || "", row.clientName || "");
}

/**
 * Si ya hay PG del día para el préstamo/cliente, marca la visita cobrada.
 * Repara el desfase: banco/registros con dinero + planilla pendiente.
 */
export function reconcilePaymentsOntoPlanilla(
  assignments: DailyCollectionAssignment[],
  payments: PaymentRow[],
): DailyCollectionAssignment[] {
  if (!assignments.length || !payments.length) return assignments;

  return assignments.map((row) => {
    if (row.awaitingLoan) return row;
    if (row.visitStatus === "omitido") return row;
    if (row.visitStatus === "cobrado" && row.paymentRef) return row;

    const day = row.dispatchDate;
    const match =
      payments.find(
        (pay) =>
          sameDay(pay.paidDate, day) &&
          Boolean(pay.loanRef) &&
          Boolean(row.loanRef) &&
          pay.loanRef === row.loanRef &&
          (!pay.collectorRef || !row.collectorRef || pay.collectorRef === row.collectorRef),
      ) ??
      payments.find((pay) => {
        if (!sameDay(pay.paidDate, day)) return false;
        if (pay.collectorRef && row.collectorRef && pay.collectorRef !== row.collectorRef) {
          return false;
        }
        return clientNamesMatch(pay.client || "", row.clientName || "");
      });

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

  return assignments.map((row) => {
    if (opts?.date && row.dispatchDate !== opts.date) return row;
    if (opts?.collectorRef && row.collectorRef !== opts.collectorRef) return row;
    if (row.awaitingLoan) return row;
    if (row.dayClosedAt) return row;
    if (row.visitStatus === "omitido") return row;
    if (row.visitStatus === "cobrado" && row.paymentRef) return row;

    const day = (row.dispatchDate || "").trim();
    if (!day) return row;

    const match = payments
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
