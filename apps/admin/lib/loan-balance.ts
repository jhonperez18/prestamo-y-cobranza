import { lineStatus } from "@/lib/loan-pay";
import {
  applyPaymentsToSchedule,
  chargeLabel,
  displayToIso,
  effectiveMode,
  effectivePact,
  isoToDisplay,
  mergeSchedulePaid,
  previewLoan,
  standardizeLoanTerms,
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

function resolvePreview(loan: LoanRow) {
  const terms = standardizeLoanTerms(loan);
  const startIso = displayToIso(terms.date);
  const dueIso = displayToIso(terms.due);
  const mode = effectiveMode(terms.mode);
  const pact = effectivePact(mode, terms.pact);
  const frequency = terms.frequency ?? "diario";
  const rate = terms.rate ?? 0;
  const cuota = terms.installment ?? 0;
  if (!startIso || !dueIso) return null;
  return previewLoan({ capital: terms.capital, startIso, dueIso, frequency, mode, pact, rate, cuota });
}

function buildScheduleLines(
  loan: LoanRow,
  loanPayments: PaymentRow[],
  preview: ReturnType<typeof previewLoan>,
): LoanScheduleSnapshotLine[] {
  const scheduleSource: LoanScheduleEntry[] = preview?.schedule?.length
    ? mergeSchedulePaid(preview.schedule, loan.schedule as LoanScheduleEntry[] | undefined)
    : ((loan.schedule ?? []) as LoanScheduleEntry[]);
  const withPayments =
    loan.ref && preview?.schedule?.length
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

  const interestLines = schedule.filter((line) => line.concept !== "Capital");
  const capitalLine = schedule.find((line) => line.concept === "Capital");

  const totalAgreement = schedule.reduce((sum, line) => sum + line.amount, 0);
  const interestTotal = interestLines.reduce((sum, line) => sum + line.amount, 0);
  const interestPaid = interestLines.reduce((sum, line) => sum + line.paid, 0);
  const interestPending = interestLines.reduce(
    (sum, line) => sum + Math.max(0, line.amount - line.paid),
    0,
  );

  const capitalTotal = capitalLine?.amount ?? loan.capital;
  const capitalPaid = capitalLine?.paid ?? 0;
  const capitalPending = Math.max(0, capitalTotal - capitalPaid);

  const balancePending = Math.max(0, totalAgreement - paidTotal);

  const installmentsTotal = interestLines.length;
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
