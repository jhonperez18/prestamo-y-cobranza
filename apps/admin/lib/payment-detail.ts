import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { cuotaTarget } from "@/lib/loan-pay";
import { chargeLabel, displayToIso, isoToDisplay } from "@/lib/loan-preview";
import { normalizePaymentMethod, paymentMethodLabel } from "@/lib/payment-method";
import { paymentHasVisualEvidence } from "@/lib/payment-evidence";
import type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import type { LoanRow, PaymentRow, StatusKind } from "@/lib/mock-data";
import { PAYMENTS } from "@/lib/mock-data";
import { paymentRowKind, type ApplyPaySuccess } from "@/lib/loan-pay";

/** Mapa préstamo por ref. para tablas con muchos pagos. */
export function loansByRef(loans: LoanRow[]) {
  return new Map(loans.map((loan) => [loan.ref, loan]));
}

/** Parcial solo si el importe no cubre el valor exigido de la cuota. */
export function cuotaAmountForPayment(
  payment: Pick<PaymentRow, "loanRef" | "dueDate">,
  loan: LoanRow | null | undefined,
): number | undefined {
  if (!loan) return undefined;
  if (payment.dueDate && loan.schedule?.length) {
    const line = loan.schedule.find((row) => row.date === payment.dueDate);
    if (line?.amount != null && line.amount > 0) return line.amount;
  }
  if (loan.installment != null && loan.installment > 0) return loan.installment;
  return undefined;
}

export function paymentIsPartial(
  payment: Pick<PaymentRow, "kind" | "amount" | "type">,
  cuotaAmount?: number,
): boolean {
  if (cuotaAmount != null && cuotaAmount > 0) {
    return payment.amount < cuotaAmount;
  }
  if (payment.type === "Cuota" && payment.kind === "paid") return false;
  if (payment.type === "Abono") return true;
  return payment.kind === "partial";
}

export function resolvePaymentType(
  payment: Pick<PaymentRow, "amount" | "type">,
  cuotaAmount?: number,
): PaymentRow["type"] {
  if (cuotaAmount != null && cuotaAmount > 0) {
    return payment.amount >= cuotaAmount ? "Cuota" : "Abono";
  }
  return payment.type;
}

export function resolvePaymentKind(
  payment: Pick<PaymentRow, "amount" | "kind" | "type">,
  cuotaAmount?: number,
): StatusKind {
  return paymentIsPartial(payment, cuotaAmount) ? "partial" : "paid";
}

/** Alinea tipo y estado del pago con el valor cobrado y la cuota del préstamo. */
export function normalizePaymentRecord(payment: PaymentRow, loans: LoanRow[]): PaymentRow {
  const loan = payment.loanRef ? loans.find((row) => row.ref === payment.loanRef) : undefined;
  const cuota = cuotaAmountForPayment(payment, loan);
  const kind = resolvePaymentKind(payment, cuota);
  const type = resolvePaymentType(payment, cuota);
  if (kind === payment.kind && type === payment.type) return payment;
  return { ...payment, kind, type };
}

export function normalizeAllPayments(payments: PaymentRow[], loans: LoanRow[]): PaymentRow[] {
  return payments.map((payment) => normalizePaymentRecord(payment, loans));
}

/** Combina pagos guardados con el seed del sistema (corrige datos viejos en localStorage). */
export function mergeStoredPaymentsWithSeed(stored: PaymentRow[]): PaymentRow[] {
  const seedByRef = new Map(PAYMENTS.map((row) => [row.ref, row]));
  const byRef = new Map<string, PaymentRow>();

  for (const row of stored) {
    const seed = seedByRef.get(row.ref);
    byRef.set(
      row.ref,
      seed
        ? {
            ...seed,
            ...row,
            amount: row.amount,
            when: row.when || seed.when,
            paidDate: row.paidDate ?? seed.paidDate,
            paidTime: row.paidTime ?? seed.paidTime,
            evidence: row.evidence ?? seed.evidence,
          }
        : row,
    );
  }

  for (const seed of PAYMENTS) {
    if (!byRef.has(seed.ref)) byRef.set(seed.ref, { ...seed });
  }

  return [...byRef.values()].sort((a, b) => paymentDateSortKey(b).localeCompare(paymentDateSortKey(a)));
}

export function buildPaymentRow(
  base: PaymentRow,
  loan: LoanRow | null | undefined,
  pay: ApplyPaySuccess,
): PaymentRow {
  return normalizePaymentRecord(
    {
      ...base,
      type: pay.type,
      kind: paymentRowKind(pay),
    },
    loan ? [loan] : [],
  );
}

/** Cuota completa = Pagada; abono o cuota incompleta = Parcial. */
export function paymentSettlementStatus(
  payment: Pick<PaymentRow, "type" | "kind" | "amount">,
  cuotaAmount?: number,
) {
  const partial = paymentIsPartial(payment, cuotaAmount);
  return {
    label: partial ? "Parcial" : "Pagada",
    kind: (partial ? "partial" : "paid") as StatusKind,
  };
}

export function paymentTimeLabel(row: Pick<PaymentRow, "when" | "paidTime">) {
  if (row.paidTime?.trim()) return row.paidTime.trim();
  const parts = row.when.split(" · ");
  if (parts.length >= 2) return parts[parts.length - 1]!.trim();
  const match = row.when.match(/(\d{1,2}:\d{2})\s*$/);
  return match?.[1] ?? row.when;
}

export function sumPaymentsForLoan(payments: PaymentRow[], loanRef: string) {
  return payments
    .filter((row) => row.loanRef === loanRef)
    .reduce((sum, row) => sum + row.amount, 0);
}

export function sortPaymentsNewestFirst(rows: PaymentRow[]) {
  return sortPayments(rows, "fecha", "desc");
}

export type PaymentSortKey = "ref" | "fecha" | "cliente" | "cobrador" | "valor" | "tipo";
export type SortDir = "asc" | "desc";

export function paymentRecaudoIso(row: PaymentRow) {
  if (row.paidDate) return row.paidDate;
  const fromWhen = displayToIso(parseWhenParts(row.when).date);
  if (fromWhen) return fromWhen;
  const match = row.when.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!match) return "";
  const year = match[3] ?? String(new Date().getFullYear());
  return `${year}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
}

export function filterPaymentsByRecaudoRange(
  rows: PaymentRow[],
  fromIso: string,
  toIso: string,
) {
  return rows.filter((row) => {
    const iso = paymentRecaudoIso(row);
    return iso && iso >= fromIso && iso <= toIso;
  });
}

function paymentDateSortKey(row: PaymentRow) {
  if (row.paidDate) return `${row.paidDate} ${row.paidTime ?? "00:00"}`;
  const match = row.when.match(
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*[·\-]\s*(\d{1,2}:\d{2})/,
  );
  if (match) {
    const year = match[3] ?? String(new Date().getFullYear());
    const day = match[1]!.padStart(2, "0");
    const month = match[2]!.padStart(2, "0");
    return `${year}-${month}-${day} ${match[4]}`;
  }
  return row.when;
}

function paymentSortValue(row: PaymentRow, key: PaymentSortKey) {
  if (key === "ref") return row.ref;
  if (key === "fecha") return paymentDateSortKey(row);
  if (key === "cliente") return row.client.toLowerCase();
  if (key === "cobrador") return row.collector.toLowerCase();
  if (key === "valor") return row.amount;
  return row.type.toLowerCase();
}

export function sortPayments(rows: PaymentRow[], key: PaymentSortKey, dir: SortDir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = paymentSortValue(a, key);
    const right = paymentSortValue(b, key);
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * sign;
    }
    return String(left).localeCompare(String(right), "es") * sign;
  });
}

export type PaymentMovement = {
  ref: string;
  dueDate: string;
  paidDate: string;
  paidTime: string;
  type: string;
  chargeLabel: string;
  collector: string;
  assignedCollector?: string;
  collectorMatch: boolean;
  source: string;
  method: string;
  evidence?: PaymentEvidenceRef[];
  hasReceipt: boolean;
  amount: number;
  kind: PaymentRow["kind"];
  gps?: boolean;
};

function parseWhenParts(when: string) {
  const match = when.match(/^(\d{1,2}\/\d{1,2}(?:\/\d{4})?)\s*[·\-]\s*(\d{1,2}:\d{2})/);
  if (!match) return { date: when, time: "—" };
  const date = match[1]!.includes("/20") ? match[1]! : `${match[1]!.split("/").reverse().join("/")}`;
  return { date: match[1]!, time: match[2]! };
}

function assignmentForPayment(payment: PaymentRow, assignments: DailyCollectionAssignment[]) {
  if (!payment.loanRef) return undefined;
  const dispatched = assignments.filter(
    (row) => row.loanRef === payment.loanRef && row.dispatched,
  );
  if (payment.collectorRef) {
    const byCollector = dispatched.find((row) => row.collectorRef === payment.collectorRef);
    if (byCollector) return byCollector;
  }
  if (payment.routeRef) {
    const dispatchDate = payment.paidDate;
    if (dispatchDate) {
      const byDate = dispatched.find((row) => row.dispatchDate === dispatchDate);
      if (byDate) return byDate;
    }
  }
  return dispatched[0];
}

export function enrichPaymentMovement(
  payment: PaymentRow,
  loan: LoanRow | null | undefined,
  assignments: DailyCollectionAssignment[] = [],
): PaymentMovement {
  const assignment = assignmentForPayment(payment, assignments);
  const whenParts = parseWhenParts(payment.when);
  const target = loan ? cuotaTarget(loan) : null;

  const dueDate = payment.dueDate
    ? isoToDisplay(payment.dueDate)
    : assignment?.chargeDate
      ? isoToDisplay(assignment.chargeDate)
      : target?.date
        ? isoToDisplay(target.date)
        : "—";

  const paidDate = payment.paidDate ? isoToDisplay(payment.paidDate) : whenParts.date;
  const paidTime = payment.paidTime ?? whenParts.time;
  const assignedCollector = assignment?.collector;
  const collectorMatch = !assignedCollector || assignedCollector === payment.collector;
  const settlement = paymentSettlementStatus(payment, cuotaAmountForPayment(payment, loan));

  return {
    ref: payment.ref,
    dueDate,
    paidDate,
    paidTime,
    type: payment.type,
    chargeLabel: payment.chargeLabel ?? (target?.kind ? chargeLabel(target.kind) : payment.type),
    collector: payment.collector,
    assignedCollector,
    collectorMatch,
    source:
      payment.source === "pwa"
        ? "App"
        : payment.source === "caja"
          ? "Caja / oficina"
          : payment.collectorRef
            ? "App"
            : "Caja / oficina",
    method: paymentMethodLabel(normalizePaymentMethod(payment.method)),
    evidence: payment.evidence,
    hasReceipt: paymentHasVisualEvidence(payment.evidence),
    amount: payment.amount,
    kind: settlement.kind,
    gps: payment.gps,
  };
}
