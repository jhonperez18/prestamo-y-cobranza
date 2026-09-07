import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import { todayIso } from "@/lib/daily-dispatch";
import {
  enrichPaymentMovement,
  filterPaymentsByRecaudoRange,
  sortPaymentsNewestFirst,
  type PaymentMovement,
} from "@/lib/payment-detail";
import type { ClientRow, LoanRow, PaymentRow, RouteRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";
import { paymentRouteLabel } from "@/lib/cobranza-payment-columns";

export type CobranzaPaymentsReportKind = "pagos" | "abonos";

export type CobranzaPaymentsReportBreakdownRow = {
  label: string;
  count: number;
  total: number;
};

export type CobranzaPaymentsReportDocument = {
  kind: CobranzaPaymentsReportKind;
  title: string;
  subtitle: string;
  fromIso: string;
  toIso: string;
  periodLabel: string;
  generatedAt: string;
  generatedLabel: string;
  ficha: { label: string; value: string }[];
  movements: PaymentMovement[];
  payments: PaymentRow[];
  summary: {
    count: number;
    total: number;
    byMethod: CobranzaPaymentsReportBreakdownRow[];
    byCollector: CobranzaPaymentsReportBreakdownRow[];
  };
  footer: { label: string; value: string; highlight?: boolean; tone?: "capital" | "neutral" | "highlight" }[];
  /** Ref de pago → etiqueta de ruta (para PDF / export). */
  routeByPaymentRef: Record<string, string>;
};

function reportTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = now.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  return { iso: now.toISOString().slice(0, 10), label: `${date} · ${time}` };
}

function periodLabel(fromIso: string, toIso: string) {
  if (fromIso === toIso) return isoToDispatchLabel(fromIso);
  return `${isoToDispatchLabel(fromIso)} → ${isoToDispatchLabel(toIso)}`;
}

function breakdownByLabel(rows: PaymentRow[], pickLabel: (row: PaymentRow) => string) {
  const map = new Map<string, { count: number; total: number }>();
  for (const row of rows) {
    const label = pickLabel(row) || "—";
    const current = map.get(label) ?? { count: 0, total: 0 };
    map.set(label, { count: current.count + 1, total: current.total + row.amount });
  }
  return [...map.entries()]
    .map(([label, stats]) => ({ label, ...stats }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, "es"));
}

export function buildCobranzaPaymentsReport(input: {
  kind: CobranzaPaymentsReportKind;
  payments: PaymentRow[];
  loans: LoanRow[];
  clients?: ClientRow[];
  routes?: RouteRow[];
  assignments?: DailyCollectionAssignment[];
  fromIso: string;
  toIso: string;
  collectorFilter?: string;
}): CobranzaPaymentsReportDocument {
  const stamp = reportTimestamp();
  const loansByRef = new Map(input.loans.map((loan) => [loan.ref, loan]));
  const kindFiltered =
    input.kind === "abonos"
      ? input.payments.filter((row) => row.type === "Abono")
      : input.payments;

  const ranged = filterPaymentsByRecaudoRange(kindFiltered, input.fromIso, input.toIso);
  const filtered = input.collectorFilter
    ? ranged.filter((row) => row.collector === input.collectorFilter)
    : ranged;

  const sorted = sortPaymentsNewestFirst(filtered);
  const movements = sorted.map((payment) =>
    enrichPaymentMovement(payment, payment.loanRef ? loansByRef.get(payment.loanRef) : null, input.assignments),
  );

  const routeCtx = {
    loans: loansByRef,
    clients: input.clients ?? [],
    routes: input.routes ?? [],
    assignments: input.assignments,
  };
  const routeByPaymentRef = Object.fromEntries(
    sorted.map((payment) => [payment.ref, paymentRouteLabel(payment, routeCtx)]),
  );

  const total = sorted.reduce((sum, row) => sum + row.amount, 0);
  const byMethod = breakdownByLabel(sorted, (row) =>
    enrichPaymentMovement(row, row.loanRef ? loansByRef.get(row.loanRef) : null, input.assignments).method,
  );
  const byCollector = breakdownByLabel(sorted, (row) => row.collector);

  const title = input.kind === "abonos" ? "Informe de abonos" : "Informe de recaudo";
  const subtitle = input.kind === "abonos" ? "Abonos registrados" : "Pagos recaudados";
  const period = periodLabel(input.fromIso, input.toIso);

  const ficha = [
    { label: "Periodo", value: period },
    { label: "Movimientos", value: String(sorted.length) },
    { label: "Total recaudado", value: money(total) },
    {
      label: "Alcance",
      value: input.collectorFilter ? `Cobrador: ${input.collectorFilter}` : "Todos los cobradores",
    },
  ];

  const footer = [
    ...byMethod.slice(0, 3).map((row) => ({
      label: row.label,
      value: money(row.total),
      tone: "neutral" as const,
    })),
    { label: "Total del periodo", value: money(total), highlight: true, tone: "highlight" as const },
  ];

  return {
    kind: input.kind,
    title,
    subtitle,
    fromIso: input.fromIso,
    toIso: input.toIso,
    periodLabel: period,
    generatedAt: stamp.iso,
    generatedLabel: stamp.label,
    ficha,
    movements,
    payments: sorted,
    summary: {
      count: sorted.length,
      total,
      byMethod,
      byCollector,
    },
    footer,
    routeByPaymentRef,
  };
}

export function cobranzaPaymentsReportFileName(report: CobranzaPaymentsReportDocument) {
  const scope = report.kind === "abonos" ? "abonos" : "recaudo";
  return `informe-${scope}-${report.fromIso}_${report.toIso}.pdf`;
}

export function defaultCobranzaReportRange(today = todayIso()) {
  const [year, month] = today.split("-");
  return { fromIso: `${year}-${month}-01`, toIso: today };
}
