import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { PAY_FREQUENCIES, rateFieldLabel } from "@/lib/loan-preview";
import { enrichPaymentMovement, sortPaymentsNewestFirst } from "@/lib/payment-detail";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";

export type LoanReportDocument = {
  loanRef: string;
  generatedAt: string;
  generatedLabel: string;
  clientName: string;
  clientRef: string;
  client: ClientRow | null;
  loan: LoanRow;
  clientFicha: { label: string; value: string }[];
  movements: ReturnType<typeof enrichPaymentMovement>[];
  footer: { label: string; value: string; highlight?: boolean }[];
  financials: ReturnType<typeof computeLoanFinancials>;
};

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

  const capitalUnificado =
    financials.totalAgreement || loan.total || loan.capital + financials.interestTerm;

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
    { label: "Total", value: money(capitalUnificado) },
  ];

  const footer = [
    { label: "Total préstamo", value: money(capitalUnificado) },
    { label: "Ya pagado", value: money(financials.paidTotal) },
    { label: "Resta por pagar", value: money(financials.balancePending), highlight: true },
  ];

  return {
    loanRef: loan.ref,
    generatedAt: stamp.iso,
    generatedLabel: stamp.label,
    clientName,
    clientRef: client?.ref ?? loan.clientRef,
    client,
    loan,
    clientFicha,
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
  ];
  return lines.filter(Boolean).join("\n");
}

/** Texto de ficha para WhatsApp (misma info de pantalla, sin botón volver). */
export function formatLoanFichaWhatsAppText(report: LoanReportDocument) {
  const f = report.financials;
  const m = (value: number) => money(value, { symbol: false });
  const cobro = f.installment > 0 ? m(f.installment) : "—";
  const cuotas =
    f.installmentsTotal > 0
      ? `${f.installmentsPaid} / ${f.installmentsTotal}`
      : String(f.installmentsPaid);
  const total = m(f.totalAgreement || report.loan.total || report.loan.capital + f.interestTerm);

  const lines: string[] = [
    `*${report.clientName.trim().toUpperCase()}*`,
    `Préstamo ${report.loanRef}`,
    "",
    `Cédula: ${report.client?.document?.trim() || "—"}`,
    `Teléfono: ${report.client?.phone?.trim() || "—"}`,
    `Desembolso: ${report.loan.date || "—"}`,
    `Vencimiento: ${report.loan.due || "—"}`,
    `Valor cobro: ${cobro}`,
    `Cuotas: ${cuotas}`,
    `Capital: ${m(report.loan.capital)}`,
    `Interés: ${m(f.interestTerm)}`,
    `*Total a cobrar: ${total}*`,
    "",
    "*MOVIMIENTOS*",
  ];

  if (!report.movements.length) {
    lines.push("Sin movimientos registrados.");
  } else {
    for (const row of report.movements) {
      lines.push(
        `${m(row.amount)} · ${row.paidDate || "—"} · ${row.paidTime || "—"} · ${row.method || "—"}`,
      );
    }
  }

  lines.push(
    "",
    `Total préstamo: ${total}`,
    `Ya pagado: ${m(f.paidTotal)}`,
    `*Resta por pagar: ${m(f.balancePending)}*`,
    "",
    report.generatedLabel,
  );

  return lines.join("\n");
}

/** Celular Colombia → dígitos internacionales (57…). */
export function phoneDigitsForWhatsApp(raw?: string | null) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("57") && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  return digits;
}

export function whatsappFichaUrl(report: LoanReportDocument) {
  const text = encodeURIComponent(formatLoanFichaWhatsAppText(report));
  const phone = phoneDigitsForWhatsApp(report.client?.phone);
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}

/** Abre el compartidor nativo con PDF de ficha (tabla no editable). */
export async function shareLoanFichaWhatsApp(report: LoanReportDocument) {
  if (typeof window === "undefined") return;

  const { loanReportPdfBlobAsync, loanReportPdfFileName } = await import("@/lib/loan-report-pdf");
  const { LOAN_FICHA_SHARE_COLS } = await import("@/lib/loan-payment-columns");

  const blob = await loanReportPdfBlobAsync(report, {
    visibleCols: LOAN_FICHA_SHARE_COLS,
  });
  const fileName = loanReportPdfFileName(report);
  const file = new File([blob], fileName, { type: "application/pdf" });
  const caption = `Ficha ${report.clientName.trim()} · ${report.loanRef}`;

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };

  if (typeof nav.share === "function") {
    const withFile: ShareData = { title: caption, text: caption, files: [file] };
    try {
      if (typeof nav.canShare !== "function" || nav.canShare(withFile)) {
        await nav.share(withFile);
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }

  // Sin Web Share de archivos: descarga el PDF (no texto plano a WhatsApp).
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
