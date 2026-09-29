/**
 * Pago tardío (solo panel del taller): corrige un cobro que no se registró
 * en un día que ya cerró.
 *
 * - La plata entra HOY (`paidDate` = hoy) a la caja del cobrador de la ruta.
 * - Cubre la cuota del día elegido (`dueDate` / `lateFor.date`): sin alerta ni mora por ese día.
 * - La visita de HOY sigue por cobrar (la planilla matchea por `paymentVisitDate`).
 * - El día cubierto no se reabre: su planilla sellada y su CIE- no se tocan.
 */
import { normalizeHistoryDate, type CollectorDayCloseRecord } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
import { newIdempotencyKey, pesos } from "@/lib/finance";
import { paymentVisitDate } from "@/lib/late-payment";
import { isPaymentLive } from "@/lib/live-payments";
import { applyPay, cuotaTargetOn, loanRowAfterPay, paymentRowKind } from "@/lib/loan-pay";
import { chargeLabel } from "@/lib/loan-preview";
import { collectorCashClosedOn, planillaCollectorRef } from "@/lib/route-collector-cash";
import {
  nextPaymentCode,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import { buildPaymentRow } from "@/lib/payment-detail";
import { normalizePaymentMethod, type PaymentMethod } from "@/lib/payment-method";
import { reconcilePaymentsOntoPlanilla } from "@/lib/planilla-payment-reconcile";

/** Lo que el admin llena en el panel. */
export type LatePaymentDraft = {
  /** ISO del día cerrado cuya cuota se dejó de registrar. */
  coversDate: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
};

export type LatePaymentInput = LatePaymentDraft & {
  loanRef: string;
  registeredBy: string;
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  assignments: DailyCollectionAssignment[];
  collectors: CollectorRow[];
  dayCloses: CollectorDayCloseRecord[];
  now?: Date;
};

export type LatePaymentResult =
  | { ok: false; error: string }
  | {
      ok: true;
      payment: PaymentRow;
      payments: PaymentRow[];
      loans: LoanRow[];
      clients: ClientRow[];
      assignments: DailyCollectionAssignment[];
    };

/** Cobrador dueño de la visita: el de la planilla del día cubierto; si no, el de hoy. */
function lateCollector(
  input: LatePaymentInput,
  loan: LoanRow,
  today: string,
): CollectorRow | null {
  const ref =
    planillaCollectorRef(input.assignments, loan, input.coversDate) ||
    planillaCollectorRef(input.assignments, loan, today);
  return input.collectors.find((row) => row.ref === ref) ?? null;
}

/** Días cerrados con cuota abierta: los únicos que admiten pago tardío. */
export function lateCuotaDates(
  loan: LoanRow,
  payments: PaymentRow[],
  today = todayIso(),
): string[] {
  const covered = new Set(
    payments
      .filter((row) => row.loanRef === loan.ref && isPaymentLive(row))
      .map((row) => paymentVisitDate(row)),
  );
  return (loan.schedule ?? [])
    .filter((line) => line.date < today && !covered.has(line.date))
    .filter((line) => Boolean(cuotaTargetOn(loan, line.date)))
    .map((line) => line.date);
}

export function commitLatePayment(input: LatePaymentInput): LatePaymentResult {
  const now = input.now ?? new Date();
  const today = todayIso(now);
  const coversDate = normalizeHistoryDate(input.coversDate) || input.coversDate.trim();
  const reason = input.reason.trim();

  if (!reason) return { ok: false, error: "Indica el motivo del pago tardío." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(coversDate) || coversDate >= today) {
    return { ok: false, error: "El pago tardío solo cubre un día anterior a hoy." };
  }

  const loan = input.loans.find((row) => row.ref === input.loanRef);
  if (!loan) return { ok: false, error: "Préstamo no encontrado." };

  const alreadyCovered = input.payments.some(
    (row) =>
      row.loanRef === loan.ref && isPaymentLive(row) && paymentVisitDate(row) === coversDate,
  );
  if (alreadyCovered) {
    return { ok: false, error: `Ese día (${isoToDispatchLabel(coversDate)}) ya tiene un pago registrado.` };
  }

  const target = cuotaTargetOn(loan, coversDate);
  if (!target) {
    return { ok: false, error: `No hay cuota abierta el ${isoToDispatchLabel(coversDate)}.` };
  }

  const collector = lateCollector(input, loan, today);
  if (!collector) {
    return { ok: false, error: "No se encontró el cobrador de ese cliente en la planilla." };
  }

  const todayClosed = collectorCashClosedOn({
    collectorRef: collector.ref,
    loan,
    dayCloses: input.dayCloses,
    assignments: input.assignments,
    date: today,
    now,
  });
  if (todayClosed) {
    return {
      ok: false,
      error: `La caja de hoy de ${collector.name} ya cerró. La plata no puede entrar a una caja cerrada.`,
    };
  }

  const amount = pesos(input.amount);
  const pay = applyPay(loan, "cuota", amount, target);
  if (!pay.ok) return { ok: false, error: pay.error };

  const paidTime = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const stamp = now.toISOString();
  const payment = buildPaymentRow(
    {
      ref: nextPaymentCode(input.payments),
      loanRef: loan.ref,
      when: `${isoToDispatchLabel(today)} · ${paidTime}`,
      paidDate: today,
      paidTime,
      dueDate: target.date ?? coversDate,
      chargeLabel: target.kind ? chargeLabel(target.kind) : pay.type,
      client: loan.client,
      collector: collector.name,
      collectorRef: collector.ref,
      idempotencyKey: newIdempotencyKey("tarde"),
      amount,
      type: pay.type,
      kind: paymentRowKind(pay),
      method: normalizePaymentMethod(input.method),
      source: "caja",
      updatedAt: stamp,
      lateFor: {
        date: coversDate,
        by: input.registeredBy.trim() || "admin",
        at: stamp,
        reason,
      },
    },
    loan,
    pay,
  );

  const payments = [payment, ...input.payments];
  const loans = input.loans.map((row) =>
    row.ref === loan.ref ? loanRowAfterPay(row, pay, payments) : row,
  );
  const clients = input.clients.map((row) =>
    row.ref === loan.clientRef ? { ...row, pending: Math.max(0, row.pending - amount) } : row,
  );
  const assignments = reconcilePaymentsOntoPlanilla(input.assignments, payments, loans);

  return { ok: true, payment, payments, loans, clients, assignments };
}
