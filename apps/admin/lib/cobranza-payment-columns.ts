import type { ColumnOption } from "@/components/ColumnPicker";
import type { PaymentMovement } from "@/lib/payment-detail";
import { paymentSettlementStatus } from "@/lib/payment-detail";
import type { PaymentRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";
import { COBRANZA_PAYMENT_COLUMNS } from "@/lib/table-columns";

export const COBRANZA_PAYMENT_REPORT_COLUMNS = COBRANZA_PAYMENT_COLUMNS;

export const COBRANZA_PAYMENT_REPORT_DEFAULT_COLS = COBRANZA_PAYMENT_COLUMNS.map((col) => col.id);

export function orderedVisibleCobranzaPaymentColumns(visibleCols: string[]): ColumnOption[] {
  return COBRANZA_PAYMENT_COLUMNS.filter((col) => visibleCols.includes(col.id));
}

export function cobranzaPaymentReportCell(
  columnId: string,
  payment: PaymentRow,
  movement: PaymentMovement,
) {
  const status = paymentSettlementStatus(payment);
  switch (columnId) {
    case "ref":
      return payment.ref;
    case "fecha":
      return movement.paidTime
        ? `${movement.paidDate} · ${movement.paidTime}`
        : movement.paidDate;
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
    case "tipo":
      return payment.type;
    case "estado":
      return status.label;
    default:
      return "—";
  }
}
