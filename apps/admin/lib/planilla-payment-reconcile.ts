/**
 * Une cobros (PG) con visitas de planilla.
 * Regla: si existe pago vivo del día → visita cobrada.
 * “Del día” = `paymentVisitDate`: un pago tardío cubre su visita, no la de hoy.
 * Si el PG se anula y el préstamo sigue cobrable → la visita vuelve a pendiente.
 * Si el préstamo ya cerró (finalizado / saldo 0) → PG fantasma no reabre la ruta
 * (evita cliente doble + rebote al prestar el mismo día).
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { accumulatedDueForLoan } from "@/lib/daily-collection-plan";
import { readDemoJson } from "@/lib/demo-persist";
import { paymentVisitDate } from "@/lib/late-payment";
import { isPaymentLive } from "@/lib/live-payments";
import { isLoanActive, isLoanVoided, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { isAssignmentAwaitingLoan } from "@/lib/planilla-display";

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
 * Préstamo que ya no debe cobrar en ruta: finalizado, borrado o saldo 0.
 * No inventa pagos; solo evita que vuelva a «por cobrar».
 */
export function loanSettledOffRoute(
  loanRef: string | undefined,
  loans: LoanRow[] | undefined,
): boolean {
  const ref = String(loanRef || "").trim();
  if (!ref || !loans?.length) return false;
  const loan = loans.find((entry) => entry.ref === ref);
  if (!loan) return false;
  if (isLoanVoided(loan)) return true;
  if (!isLoanActive(loan)) return true;
  return Number(loan.balance) <= 0;
}

/** Cobrado cerrado sin PG inventado: fuera de ruta; cobrados reales salen de los PG vivos. */
export function sealSettledVisit(row: DailyCollectionAssignment): DailyCollectionAssignment {
  return {
    ...row,
    visitStatus: "cobrado",
    paymentRef: undefined,
    amountDue: 0,
    skipReason: undefined,
  };
}

function paymentRefStillQueued(ref: string): boolean {
  if (typeof window === "undefined" || !ref) return false;
  try {
    const queue = readDemoJson<{ ref?: string }[]>("nexo-demo-payment-mirror-queue", []);
    return queue.some((row) => String(row.ref || "").trim() === ref);
  } catch {
    return false;
  }
}

function reopenToPending(
  row: DailyCollectionAssignment,
  loans: LoanRow[] | undefined,
): DailyCollectionAssignment {
  return {
    ...row,
    visitStatus: "pendiente" as const,
    paymentRef: undefined,
    skipReason: undefined,
    amountDue: restoreAmountDue(row, loans),
  };
}

/**
 * Marca cobrado si hay PG vivo del día; si el PG apuntado fue anulado y el préstamo
 * sigue cobrable, revierte a pendiente. Préstamo ya liquidado + PG fantasma → sella
 * fuera de ruta (no reabre, no cliente doble).
 */
export function reconcilePaymentsOntoPlanilla(
  assignments: DailyCollectionAssignment[],
  payments: PaymentRow[],
  loans?: LoanRow[],
): DailyCollectionAssignment[] {
  if (!assignments.length) return assignments;

  const live = payments.filter(isPaymentLive);
  const liveByRef = new Map(live.map((row) => [row.ref, row] as const));
  const loanByRef = new Map<string, LoanRow>();
  for (const loan of loans ?? []) {
    if (loan.ref) loanByRef.set(loan.ref, loan);
  }
  const byDay = new Map<string, PaymentRow[]>();
  const byDayLoan = new Map<string, PaymentRow[]>();
  for (const pay of live) {
    const day = paymentVisitDate(pay);
    if (!day) continue;
    const dayList = byDay.get(day);
    if (dayList) dayList.push(pay);
    else byDay.set(day, [pay]);
    const loanKey = `${day}|${pay.loanRef || ""}`;
    const loanList = byDayLoan.get(loanKey);
    if (loanList) loanList.push(pay);
    else byDayLoan.set(loanKey, [pay]);
  }
  const queued = new Set<string>();
  if (typeof window !== "undefined") {
    try {
      const queue = readDemoJson<{ ref?: string }[]>("nexo-demo-payment-mirror-queue", []);
      for (const entry of queue) {
        const ref = String(entry.ref || "").trim();
        if (ref) queued.add(ref);
      }
    } catch {
      /* sin cola */
    }
  }
  const settledOffRoute = (loanRef: string | undefined) => {
    const ref = String(loanRef || "").trim();
    if (!ref) return false;
    const loan = loanByRef.get(ref);
    if (!loan) return false;
    if (isLoanVoided(loan)) return true;
    if (!isLoanActive(loan)) return true;
    return Number(loan.balance) <= 0;
  };
  const matchVisit = (row: DailyCollectionAssignment) => {
    const day = row.dispatchDate;
    const candidates = row.loanRef
      ? (byDayLoan.get(`${day}|${row.loanRef}`) ?? [])
      : (byDay.get(day) ?? []);
    return candidates.find((pay) => paymentMatchesVisit(pay, row));
  };

  return assignments.flatMap((row) => {
    if (isAssignmentAwaitingLoan(row)) return [row];
    if (row.visitStatus === "omitido") return [row];
    // Jornada/planilla ya cerrada: no reabrir por PG anulado o ausente (otro celular lo vería abierto).
    if (row.dayClosedAt) return [row];

    const settled = settledOffRoute(row.loanRef);

    // Cuota de préstamo ya cerrado sin PG vivo: se elimina (no vuelve a ruta ni a cobrados falsos).
    if (
      settled &&
      (row.visitStatus === "pendiente" || row.visitStatus === "parcial" || !row.visitStatus)
    ) {
      return [];
    }

    const linkedRef = (row.paymentRef || "").trim();
    const linkedPay = linkedRef ? liveByRef.get(linkedRef) : undefined;
    const linkedOk = Boolean(linkedPay && paymentBelongsToVisit(linkedPay, row));

    if (
      linkedRef &&
      (row.visitStatus === "cobrado" || row.visitStatus === "parcial") &&
      !linkedOk
    ) {
      // Aún subiendo: no tratar como fantasma.
      if (queued.has(linkedRef)) return [row];
      // PG fantasma + préstamo liquidado: fuera para siempre.
      if (settled) return [];
      // PG anulado, ausente o de OTRO préstamo/cliente → vuelve a pendiente.
      return [reopenToPending(row, loans)];
    }

    // Cobrado sin PG vivo (ref borrada o anulado).
    if (
      (row.visitStatus === "cobrado" || row.visitStatus === "parcial") &&
      !linkedRef
    ) {
      if (settled) return [];
      return [reopenToPending(row, loans)];
    }

    if (row.visitStatus === "cobrado" && linkedOk) {
      return [row];
    }

    const match = matchVisit(row);

    if (!match) return [row];
    return [
      {
        ...row,
        loanRef: row.loanRef || match.loanRef || "",
        amountDue: 0,
        visitStatus: "cobrado" as const,
        paymentRef: match.ref,
      },
    ];
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
  opts?: { date?: string; collectorRef?: string; untilDate?: string; loans?: LoanRow[] },
): DailyCollectionAssignment[] {
  if (!assignments.length || !payments.length) return assignments;
  const until = (opts?.untilDate || "").trim();
  const live = payments.filter(isPaymentLive);
  const loans = opts?.loans;

  return assignments.map((row) => {
    if (opts?.date && row.dispatchDate !== opts.date) return row;
    if (opts?.collectorRef && row.collectorRef !== opts.collectorRef) return row;
    if (isAssignmentAwaitingLoan(row)) return row;
    if (row.dayClosedAt) return row;
    if (row.visitStatus === "omitido") return row;

    const linkedRef = (row.paymentRef || "").trim();
    if (row.visitStatus === "cobrado" && linkedRef) {
      const linked = live.find((p) => p.ref === linkedRef);
      if (!linked || !paymentBelongsToVisit(linked, row)) {
        if (paymentRefStillQueued(linkedRef)) return row;
        // Fantasma en préstamo liquidado: se deja cobrado sin ref; el servidor la borra al subir.
        if (loanSettledOffRoute(row.loanRef, loans)) return sealSettledVisit(row);
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
        const paid = paymentVisitDate(pay);
        if (!paid || paid < day) return false;
        if (until && paid > until) return false;
        return paymentMatchesVisit(pay, row);
      })
      .sort((a, b) => paymentVisitDate(a).localeCompare(paymentVisitDate(b)))[0];

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

/**
 * Varios abonos el mismo día son válidos. No se borra ningún PG-
 * por repetir préstamo y fecha.
 */
export function dedupeDailyPaymentsByVisit(
  payments: PaymentRow[],
  _assignments: DailyCollectionAssignment[],
): { payments: PaymentRow[]; removedRefs: string[] } {
  return { payments, removedRefs: [] };
}
