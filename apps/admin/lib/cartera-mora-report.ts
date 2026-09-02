import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { loanStatusPill } from "@/lib/loan-status";
import { syncLoan } from "@/lib/loan-preview";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";

export type CarteraMoraRow = {
  loanRef: string;
  clientRef: string;
  clientName: string;
  route: string;
  days: number;
  overdueInstallments: number;
  balance: number;
  statusLabel: string;
};

function overdueDays(loan: LoanRow, today: string) {
  const overdueDates = (loan.schedule ?? [])
    .filter((line) => line.date < today && (line.paid ?? 0) < line.amount)
    .map((line) => line.date);
  const oldest = overdueDates[0];
  if (!oldest) return 0;
  return Math.max(
    1,
    Math.round(
      (Date.parse(`${today}T12:00:00`) - Date.parse(`${oldest}T12:00:00`)) / (1000 * 60 * 60 * 24),
    ),
  );
}

export function buildCarteraMoraRows(
  loans: LoanRow[],
  payments: PaymentRow[],
  clients: ClientRow[],
  today = todayIso(),
  routeFilter?: string,
) {
  const clientByRef = new Map(clients.map((client) => [client.ref, client]));

  const rows = loans
    .map((loan) => syncLoan(loan, payments) as LoanRow)
    .filter((loan) => loanStatusPill(loan).kind === "overdue")
    .map((loan) => {
      const client = clientByRef.get(loan.clientRef);
      const overdueInstallments = (loan.schedule ?? []).filter(
        (line) => line.date < today && (line.paid ?? 0) < line.amount,
      ).length;
      const financials = computeLoanFinancials(loan, payments);
      const status = loanStatusPill(loan);
      return {
        loanRef: loan.ref,
        clientRef: loan.clientRef,
        clientName: loan.client,
        route: client?.route ?? "—",
        days: overdueDays(loan, today),
        overdueInstallments,
        balance: financials.balancePending,
        statusLabel: status.label,
      };
    })
    .sort((a, b) => b.days - a.days || a.clientName.localeCompare(b.clientName, "es"));

  if (!routeFilter) return rows;
  return rows.filter((row) => row.route === routeFilter);
}

export type CarteraMoraReportDocument = {
  generatedAt: string;
  generatedLabel: string;
  asOfIso: string;
  asOfLabel: string;
  ficha: { label: string; value: string }[];
  rows: CarteraMoraRow[];
  footer: { label: string; value: string; highlight?: boolean; tone?: "capital" | "neutral" | "highlight" }[];
  summary: {
    count: number;
    total: number;
    routeFilter?: string;
  };
};

function reportTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  return { iso: now.toISOString().slice(0, 10), label: `${date} · ${time}` };
}

function breakdownByRoute(rows: CarteraMoraRow[]) {
  const map = new Map<string, { count: number; total: number }>();
  for (const row of rows) {
    const current = map.get(row.route) ?? { count: 0, total: 0 };
    map.set(row.route, { count: current.count + 1, total: current.total + row.balance });
  }
  return [...map.entries()]
    .map(([label, stats]) => ({ label, ...stats }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"));
}

export function buildCarteraMoraReport(input: {
  loans: LoanRow[];
  payments: PaymentRow[];
  clients: ClientRow[];
  routeFilter?: string;
  today?: string;
}): CarteraMoraReportDocument {
  const stamp = reportTimestamp();
  const asOfIso = input.today ?? todayIso();
  const cutLabel = isoToDispatchLabel(asOfIso);
  const rows = buildCarteraMoraRows(
    input.loans,
    input.payments,
    input.clients,
    asOfIso,
    input.routeFilter,
  );
  const total = rows.reduce((sum, row) => sum + row.balance, 0);
  const byRoute = breakdownByRoute(rows);

  const ficha = [
    { label: "Fecha de corte", value: cutLabel },
    { label: "Créditos en mora", value: String(rows.length) },
    { label: "Saldo en mora", value: money(total) },
    {
      label: "Alcance",
      value: input.routeFilter ? `Ruta: ${input.routeFilter}` : "Todas las rutas",
    },
  ];

  const footer = [
    ...byRoute.slice(0, 3).map((row) => ({
      label: row.label,
      value: money(row.total),
      tone: "neutral" as const,
    })),
    { label: "Total en mora", value: money(total), highlight: true, tone: "highlight" as const },
  ];

  return {
    generatedAt: stamp.iso,
    generatedLabel: stamp.label,
    asOfIso,
    asOfLabel: cutLabel,
    ficha,
    rows,
    footer,
    summary: {
      count: rows.length,
      total,
      routeFilter: input.routeFilter,
    },
  };
}

export function carteraMoraReportFileName(report: CarteraMoraReportDocument) {
  const scope = report.summary.routeFilter
    ? report.summary.routeFilter.toLowerCase().replace(/\s+/g, "-")
    : "cartera";
  return `informe-mora-${scope}-${report.asOfIso}.pdf`;
}
