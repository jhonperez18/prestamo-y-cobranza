import type { ColumnOption } from "@/components/ColumnPicker";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { PaymentMovement } from "@/lib/payment-detail";
import { paymentSettlementStatus } from "@/lib/payment-detail";
import type { ClientRow, LoanRow, PaymentRow, RouteRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";
import { COBRANZA_PAYMENT_COLUMNS } from "@/lib/table-columns";

export const COBRANZA_PAYMENT_REPORT_COLUMNS = COBRANZA_PAYMENT_COLUMNS;

export const COBRANZA_PAYMENT_REPORT_DEFAULT_COLS = COBRANZA_PAYMENT_COLUMNS.map((col) => col.id);

export function orderedVisibleCobranzaPaymentColumns(visibleCols: string[]): ColumnOption[] {
  return COBRANZA_PAYMENT_COLUMNS.filter((col) => visibleCols.includes(col.id));
}

export function paymentRouteLabel(
  payment: PaymentRow,
  input: {
    loans: LoanRow[] | Map<string, LoanRow>;
    clients: ClientRow[];
    routes: RouteRow[];
    assignments?: DailyCollectionAssignment[];
  },
) {
  const loanMap =
    input.loans instanceof Map
      ? input.loans
      : new Map(input.loans.map((loan) => [loan.ref, loan]));
  const loan = payment.loanRef ? loanMap.get(payment.loanRef) : undefined;

  // Preferir ruta de catálogo del cliente (1, 2, 3…) — no el nombre de planilla diaria.
  if (loan) {
    const client = input.clients.find((row) => row.ref === loan.clientRef);
    if (client?.route) return client.route;
  }

  const assignment = (input.assignments ?? []).find(
    (row) =>
      (payment.loanRef && row.loanRef === payment.loanRef) ||
      (payment.client && row.clientName === payment.client),
  );
  if (assignment?.clientRoute && assignment.clientRoute !== "—") {
    return assignment.clientRoute;
  }

  if (payment.routeRef) {
    const route = input.routes.find((row) => row.ref === payment.routeRef);
    if (route) {
      // RUT-D-* es planilla del día; zone guarda el # de ruta cuando es una sola.
      if (route.ref.startsWith("RUT-D-")) {
        if (route.zone && route.zone !== "—" && !route.zone.toLowerCase().includes("varias")) {
          return route.zone;
        }
      } else if (route.name) {
        return route.name;
      }
    }
  }

  return "—";
}

export function cobranzaPaymentReportCell(
  columnId: string,
  payment: PaymentRow,
  movement: PaymentMovement,
  routeLabel = "—",
) {
  const status = paymentSettlementStatus(payment);
  switch (columnId) {
    case "ref":
      return payment.ref;
    case "fecha":
      return movement.paidDate;
    case "hora":
      return movement.paidTime || "—";
    case "cliente":
      return payment.client;
    case "cobrador":
      return movement.collector;
    case "valor":
      return money(payment.amount);
    case "method":
      return movement.method;
    case "evidence":
      return movement.hasReceipt ? "Sí" : "—";
    case "ruta":
      return routeLabel;
    case "tipo":
      return routeLabel;
    case "estado":
      return status.label;
    default:
      return "—";
  }
}
