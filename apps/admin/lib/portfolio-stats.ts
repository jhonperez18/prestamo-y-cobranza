import { todayIso } from "@/lib/daily-dispatch";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { loanStatusPill } from "@/lib/loan-status";
import { syncLoan } from "@/lib/loan-preview";
import { activeLoans, type LoanRow, type PaymentRow } from "@/lib/mock-data";

export type PortfolioStats = {
  totalBalance: number;
  activeCount: number;
  onTimeBalance: number;
  onTimeCount: number;
  moraBalance: number;
  moraCount: number;
  collectedMonth: number;
  monthLabel: string;
};

function syncedActiveLoans(loans: LoanRow[], payments: PaymentRow[]) {
  return activeLoans(loans.map((loan) => syncLoan(loan, payments) as LoanRow));
}

function paymentMonthKey(payment: PaymentRow, fallbackYear: number) {
  if (payment.paidDate) return payment.paidDate.slice(0, 7);
  const match = payment.when.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!match) return null;
  const month = match[2]!.padStart(2, "0");
  const year = match[3] ?? String(fallbackYear);
  return `${year}-${month}`;
}

export function moraStats(loans: LoanRow[], payments: PaymentRow[]) {
  const stats = buildPortfolioStats(loans, payments);
  return { count: stats.moraCount, total: stats.moraBalance };
}

export function buildPortfolioStats(
  loans: LoanRow[],
  payments: PaymentRow[],
  now = new Date(),
): PortfolioStats {
  const currentMonth = todayIso(now).slice(0, 7);
  const monthRaw = now.toLocaleDateString("es-CO", { month: "long" });
  const monthLabel = monthRaw.charAt(0).toLowerCase() + monthRaw.slice(1);

  let totalBalance = 0;
  let activeCount = 0;
  let onTimeBalance = 0;
  let onTimeCount = 0;
  let moraBalance = 0;
  let moraCount = 0;

  for (const loan of syncedActiveLoans(loans, payments)) {
    const balance = computeLoanFinancials(loan, payments).balancePending;
    if (balance <= 0) continue;

    activeCount += 1;
    totalBalance += balance;

    if (loanStatusPill(loan).kind === "overdue") {
      moraBalance += balance;
      moraCount += 1;
    } else {
      onTimeBalance += balance;
      onTimeCount += 1;
    }
  }

  const collectedMonth = payments
    .filter((row) => paymentMonthKey(row, now.getFullYear()) === currentMonth)
    .reduce((sum, row) => sum + row.amount, 0);

  return {
    totalBalance,
    activeCount,
    onTimeBalance,
    onTimeCount,
    moraBalance,
    moraCount,
    collectedMonth,
    monthLabel,
  };
}
