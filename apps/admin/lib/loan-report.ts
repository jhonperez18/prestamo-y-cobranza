import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { computeLoanFinancials, loanPaySummaryRows, type LoanFinancials } from "@/lib/loan-balance";
import { PAY_FREQUENCIES, rateFieldLabel } from "@/lib/loan-preview";
import { enrichPaymentMovement, sortPaymentsNewestFirst } from "@/lib/payment-detail";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";

export type LoanReportScheduleRow = {
  date: string;
  concept: string;
  amount: number;
  paid: number;
  pending: number;
};

export type LoanReportOverdueRow = LoanReportScheduleRow;

export type LoanReportPendingSummary = {
  count: number;
  total: number;
};

export type LoanReportDocument = {
  loanRef: string;
  generatedAt: string;
  generatedLabel: string;
  clientName: string;
  clientRef: string;
  client: ClientRow | null;
  loan: LoanRow;
  clientFicha: { label: string; value: string }[];
  overdueInstallments: LoanReportOverdueRow[];
  pendingSummary: LoanReportPendingSummary;
  movements: ReturnType<typeof enrichPaymentMovement>[];
  footer: { label: string; value: string; highlight?: boolean }[];
  financials: ReturnType<typeof computeLoanFinancials>;
};

function buildPendingSummary(financials: LoanFinancials): LoanReportPendingSummary {
  const lines = financials.schedule.filter((line) => Math.max(0, line.amount - line.paid) > 0);

  return {
    count: lines.length,
    total: lines.reduce((sum, line) => sum + Math.max(0, line.amount - line.paid), 0),
  };
}

export function formatLoanReportPendingSummary(
  summary: LoanReportPendingSummary,
  formatMoney: (value: number) => string = money,
) {
  if (summary.count === 0) return "Sin cuotas pendientes.";
  const label = summary.count === 1 ? "cuota" : "cuotas";
  return `${summary.count} ${label} · ${formatMoney(summary.total)}`;
}

function reportTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  return { iso: now.toISOString().slice(0, 10), label: `${date} · ${time}` };
}

export function buildLoanReport(
  loan: LoanRow,
  client: ClientRow | null,
  payments: PaymentRow[],
  assignments: DailyCollectionAssignment[] = [],
): LoanReportDocument {
  const stamp = reportTimestamp();
  const financials = computeLoanFinancials(loan, payments);
  const freqLabel = PAY_FREQUENCIES.find((item) => item.id === loan.frequency)?.label ?? "Diario";
  const clientName = client ? `${client.name} ${client.lastName}` : loan.client;

  const movements = sortPaymentsNewestFirst(
    payments.filter((row) => row.loanRef === loan.ref),
  ).map((row) => enrichPaymentMovement(row, loan, assignments));

  const clientFicha: LoanReportDocument["clientFicha"] = [
    { label: "Titular", value: clientName },
    { label: "Cédula", value: client?.document ?? "—" },
    { label: "Ruta", value: client?.route ?? "—" },
    { label: "Préstamo", value: loan.ref },
    { label: "Capital prestado", value: money(loan.capital) },
    { label: "Desembolso", value: loan.date },
    { label: "Frecuencia", value: freqLabel },
    {
      label: loan.pact === "valor" ? "Valor de cada cobro" : rateFieldLabel(loan.frequency ?? "diario"),
      value: financials.installment > 0 ? money(financials.installment) : "—",
    },
    {
      label: "Cuotas pagadas",
      value:
        financials.installmentsTotal > 0
          ? `${financials.installmentsPaid} / ${financials.installmentsTotal}`
          : String(financials.installmentsPaid),
    },
    { label: "Interés del plazo", value: money(financials.interestTerm) },
    { label: "Total", value: money(loan.total ?? loan.capital + financials.interestTerm) },
  ];

  const footer = loanPaySummaryRows(financials, money);
  const overdueInstallments: LoanReportOverdueRow[] = [];
  const pendingSummary = buildPendingSummary(financials);

  return {
    loanRef: loan.ref,
    generatedAt: stamp.iso,
    generatedLabel: stamp.label,
    clientName,
    clientRef: client?.ref ?? loan.clientRef,
    client,
    loan,
    clientFicha,
    overdueInstallments,
    pendingSummary,
    movements,
    footer,
    financials,
  };
}

export function formatLoanReportText(report: LoanReportDocument) {
  const f = report.financials;
  const lines: string[] = [
    "INFORME DE PRÉSTAMO — CA préstamo",
    `Generado: ${report.generatedLabel}`,
    "",
    "—— FICHA ——",
    ...report.clientFicha.map((row) => `${row.label}: ${row.value}`),
    `Plazo: ${f.days != null ? `${f.days} días` : `${report.loan.date} → ${report.loan.due}`}`,
    "",
    "—— CUOTAS EN MORA ——",
    ...(report.overdueInstallments.length
      ? report.overdueInstallments.map(
          (row) =>
            `${row.concept} · ${money(row.amount)} · pagado ${money(row.paid)} · pendiente ${money(row.pending)}`,
        )
      : ["Sin cuotas en mora."]),
    "",
    "—— CUOTAS PENDIENTES ——",
    formatLoanReportPendingSummary(report.pendingSummary),
    "",
    "—— MOVIMIENTOS ——",
    ...(report.movements.length
      ? report.movements.map(
          (row) =>
            `${row.ref} · recaudo ${row.paidDate} ${row.paidTime} · ${row.chargeLabel} · ${row.collector} · ${row.method}${row.hasReceipt ? " · comprobante" : ""} · ${row.source} · ${money(row.amount)}`,
        )
      : ["Sin movimientos registrados."]),
    "",
    "—— RESUMEN ——",
    ...report.footer.map((row) => `${row.label}: ${row.value}`),
    `Cuotas pagadas: ${f.installmentsPaid} · Cuotas pendientes: ${f.installmentsPending}`,
    `Verificación: recaudado (${money(f.paidTotal)}) + saldo (${money(f.balancePending)}) = acuerdo (${money(f.totalAgreement)})`,
  ];
  return lines.filter(Boolean).join("\n");
}

export function downloadLoanReport(report: LoanReportDocument) {
  if (typeof window === "undefined") return;
  const text = formatLoanReportText(report);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `informe-${report.loanRef}-${report.generatedAt}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
