import { lineStatus } from "@/lib/loan-pay";
import {
  applyPaymentsToSchedule,
  chargeLabel,
  isoToDisplay,
  isFlatLoanTerms,
  loanPreviewFromRow,
  mergeSchedulePaid,
  type LoanPreview,
  type LoanScheduleEntry,
} from "@/lib/loan-preview";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";

export type LoanScheduleSnapshotLine = {
  dateIso: string;
  date: string;
  concept: string;
  amount: number;
  paid: number;
  statusKind: "paid" | "partial" | "pending" | "overdue";
};

export type LoanFinancials = {
  schedule: LoanScheduleSnapshotLine[];
  totalAgreement: number;
  paidTotal: number;
  balancePending: number;
  interestTotal: number;
  interestPaid: number;
  interestPending: number;
  capitalTotal: number;
  capitalPaid: number;
  capitalPending: number;
  capitalDueDate: string;
  installmentsTotal: number;
  installmentsPaid: number;
  installmentsPending: number;
  interestTerm: number;
  installment: number;
  days: number | undefined;
  previewTotal: number;
};

export function loanPaySummaryRows(f: LoanFinancials, formatMoney: (n: number) => string) {
  return [
    { label: "Ya pagado", value: formatMoney(f.paidTotal) },
    { label: "Interés pendiente", value: formatMoney(f.interestPending) },
    { label: "Capital por pagar", value: formatMoney(f.capitalPending) },
    { label: "Resta por pagar", value: formatMoney(f.balancePending), highlight: true },
  ];
}

function paidOnDueDate(payments: PaymentRow[], dueIso: string) {
  return payments
    .filter((row) => row.dueDate === dueIso)
    .reduce((sum, row) => sum + row.amount, 0);
}

function resolvePreview(loan: LoanRow): LoanPreview | null {
  return loanPreviewFromRow(loan);
}

function buildScheduleLines(
  loan: LoanRow,
  loanPayments: PaymentRow[],
  preview: LoanPreview | null,
): LoanScheduleSnapshotLine[] {
  const stored = (loan.schedule ?? []) as LoanScheduleEntry[];
  const template = (
    stored.length > 0
      ? stored
      : (preview?.schedule ?? [])
  ).map((line) => ({
    date: line.date,
    amount: line.amount,
    kind: (line.kind ?? "cuota") as "interes" | "capital" | "cuota",
    paid: "paid" in line ? line.paid : undefined,
  }));

  const scheduleSource = mergeSchedulePaid(template, stored);
  const withPayments =
    loan.ref && scheduleSource.length
      ? applyPaymentsToSchedule(scheduleSource, loanPayments, loan.ref)
      : scheduleSource;

  return withPayments.map((line) => {
    const fromLine = line.paid ?? 0;
    const fromPayments = paidOnDueDate(loanPayments, line.date);
    const paid = Math.max(fromLine, fromPayments);
    const status = lineStatus({ ...line, paid });
    return {
      dateIso: line.date,
      date: isoToDisplay(line.date),
      concept: chargeLabel(line.kind),
      amount: line.amount,
      paid,
      statusKind: status.kind,
    };
  });
}

/** Una sola fuente de verdad: plantilla + movimientos. Recaudado + saldo = monto del acuerdo. */
export function computeLoanFinancials(loan: LoanRow, payments: PaymentRow[]): LoanFinancials {
  const loanPayments = payments.filter((row) => row.loanRef === loan.ref);
  const paidTotal = loanPayments.reduce((sum, row) => sum + row.amount, 0);
  const preview = resolvePreview(loan);
  const schedule = buildScheduleLines(loan, loanPayments, preview);
  const flat = isFlatLoanTerms(loan);

  const interestLines = schedule.filter((line) => line.concept !== "Capital");
  const capitalLine = schedule.find((line) => line.concept === "Capital");

  const scheduleTotal = schedule.reduce((sum, line) => sum + line.amount, 0);
  const totalAgreement = flat
    ? loan.total ?? preview?.total ?? scheduleTotal
    : scheduleTotal || loan.total || loan.capital;
  const interestTotal = flat
    ? loan.interest ?? preview?.interest ?? 0
    : interestLines.reduce((sum, line) => sum + line.amount, 0);
  const interestPaid = flat
    ? Math.min(paidTotal, interestTotal)
    : interestLines.reduce((sum, line) => sum + line.paid, 0);
  const interestPending = Math.max(0, interestTotal - interestPaid);

  const capitalTotal = flat ? loan.capital : (capitalLine?.amount ?? loan.capital);
  const capitalPaid = flat
    ? Math.max(0, paidTotal - interestPaid)
    : (capitalLine?.paid ?? 0);
  const capitalPending = Math.max(0, capitalTotal - capitalPaid);

  const balancePending = Math.max(0, totalAgreement - paidTotal);

  const installmentsTotal = flat
    ? interestLines.length || preview?.count || 0
    : interestLines.length;
  const installmentsPaid = interestLines.filter((line) => line.statusKind === "paid").length;
  const installmentsPending = Math.max(0, installmentsTotal - installmentsPaid);

  const capitalDueDate = capitalLine?.date ?? loan.due;
  const interestTerm = loan.interest ?? preview?.interest ?? interestTotal;
  const installment = loan.installment ?? preview?.installment ?? 0;
  const days = loan.days ?? preview?.days;
  const previewTotal = loan.total ?? preview?.total ?? totalAgreement;

  return {
    schedule,
    totalAgreement,
    paidTotal,
    balancePending,
    interestTotal,
    interestPaid,
    interestPending,
    capitalTotal,
    capitalPaid,
    capitalPending,
    capitalDueDate,
    installmentsTotal,
    installmentsPaid,
    installmentsPending,
    interestTerm,
    installment,
    days,
    previewTotal,
  };
}
