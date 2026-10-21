import { todayIso } from "@/lib/daily-dispatch";
import { loanStatusPill } from "@/lib/loan-status";
import { livePayments } from "@/lib/live-payments";
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

function paymentMonthKey(payment: PaymentRow, fallbackYear: number) {
  if (payment.paidDate) return payment.paidDate.slice(0, 7);
  const match = payment.when.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!match) return null;
  const month = match[2]!.padStart(2, "0");
  const year = match[3] ?? String(fallbackYear);
  return `${year}-${month}`;
}

/** Saldo por cobrar de los préstamos activos cuyos clientes están en `clientRefs`. */
export function portfolioBalanceForClients(
  loans: LoanRow[],
  _payments: PaymentRow[],
  clientRefs: ReadonlySet<string>,
): number {
  let total = 0;
  for (const loan of activeLoans(loans)) {
    if (!loan.clientRef || !clientRefs.has(loan.clientRef)) continue;
    const balance = Number(loan.balance) || 0;
    if (balance > 0) total += balance;
  }
  return total;
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
  const today = todayIso(now);
  const live = livePayments(payments);
  const currentMonth = today.slice(0, 7);
  const monthRaw = now.toLocaleDateString("es-CO", { month: "long" });
  const monthLabel = monthRaw.charAt(0).toLowerCase() + monthRaw.slice(1);

  let totalBalance = 0;
  let activeCount = 0;
  let onTimeBalance = 0;
  let onTimeCount = 0;
  let moraBalance = 0;
  let moraCount = 0;

  for (const loan of activeLoans(loans)) {
    const balance = Number(loan.balance) || 0;
    if (balance <= 0) continue;

    activeCount += 1;
    totalBalance += balance;

    if (loanStatusPill(loan, today).kind === "overdue") {
      moraBalance += balance;
      moraCount += 1;
    } else {
      onTimeBalance += balance;
      onTimeCount += 1;
    }
  }

  const collectedMonth = live
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
