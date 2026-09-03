import { todayIso } from "@/lib/daily-dispatch";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { loanStatusPill } from "@/lib/loan-status";
import { syncLoan } from "@/lib/loan-preview";
import {
  activeLoans,
  type ClientRow,
  type LoanRow,
  type PaymentRow,
  type StatusKind,
} from "@/lib/mock-data";

export type CarteraPortfolioLoanRow = {
  loanRef: string;
  clientRef: string;
  clientName: string;
  route: string;
  balance: number;
  statusLabel: string;
  statusKind: StatusKind;
};

export type CarteraCollectedRow = {
  ref: string;
  when: string;
  client: string;
  collector: string;
  amount: number;
  type: string;
};

export type CarteraResumenDrill = "total" | "al-dia" | "cobrado";

function clientName(client: ClientRow | undefined, fallback: string) {
  if (!client) return fallback;
  return `${client.name} ${client.lastName}`.trim();
}

function paymentMonthKey(payment: PaymentRow, fallbackYear: number) {
  if (payment.paidDate) return payment.paidDate.slice(0, 7);
  const match = payment.when.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (!match) return null;
  const month = match[2]!.padStart(2, "0");
  const year = match[3] ?? String(fallbackYear);
  return `${year}-${month}`;
}

export function buildCarteraPortfolioLoanRows(
  loans: LoanRow[],
  payments: PaymentRow[],
  clients: ClientRow[],
  filter: "all" | "on-time",
): CarteraPortfolioLoanRow[] {
  const clientByRef = new Map(clients.map((client) => [client.ref, client]));

  return activeLoans(loans.map((loan) => syncLoan(loan, payments) as LoanRow))
    .map((loan) => {
      const balance = computeLoanFinancials(loan, payments).balancePending;
      if (balance <= 0) return null;

      const status = loanStatusPill(loan);
      if (filter === "on-time" && status.kind === "overdue") return null;

      const client = clientByRef.get(loan.clientRef);
      return {
        loanRef: loan.ref,
        clientRef: loan.clientRef,
        clientName: clientName(client, loan.client),
        route: client?.route ?? "—",
        balance,
        statusLabel: status.label,
        statusKind: status.kind,
      };
    })
    .filter((row): row is CarteraPortfolioLoanRow => row !== null)
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "es") || a.loanRef.localeCompare(b.loanRef));
}

export function buildCarteraCollectedMonthRows(
  payments: PaymentRow[],
  now = new Date(),
): CarteraCollectedRow[] {
  const currentMonth = todayIso(now).slice(0, 7);

  return payments
    .filter((row) => paymentMonthKey(row, now.getFullYear()) === currentMonth)
    .map((row) => ({
      ref: row.ref,
      when: row.when,
      client: row.client,
      collector: row.collector,
      amount: row.amount,
      type: row.type,
    }))
    .sort((a, b) => b.when.localeCompare(a.when, "es"));
}

export function carteraResumenDrillTitle(drill: CarteraResumenDrill, monthLabel: string) {
  switch (drill) {
    case "total":
      return "Cartera total · créditos vigentes";
    case "al-dia":
      return "Al día · créditos sin mora";
    case "cobrado":
      return `Cobrado del mes · ${monthLabel}`;
    default:
      return "";
  }
}
