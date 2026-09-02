import type { ColumnOption } from "@/components/ColumnPicker";
import type { PaymentMovement } from "@/lib/payment-detail";
import { money } from "@/lib/mock-data";

export const LOAN_PAYMENT_COLUMNS_STORAGE_KEY = "nexo.prestamos.ficha-pagos.columns";

export const LOAN_PAYMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Pago" },
  { id: "dueDate", label: "Fecha cuota" },
  { id: "paidDate", label: "Fecha recaudo" },
  { id: "paidTime", label: "Hora" },
  { id: "concept", label: "Concepto" },
  { id: "collector", label: "Cobrador" },
  { id: "method", label: "Forma de pago" },
  { id: "evidence", label: "Comprobante" },
  { id: "source", label: "Origen" },
  { id: "amount", label: "Importe" },
];

export const LOAN_PAYMENT_DEFAULT_COLS = LOAN_PAYMENT_COLUMNS.map((col) => col.id);

export function orderedVisibleLoanPaymentColumns(visibleCols: string[]) {
  return LOAN_PAYMENT_COLUMNS.filter((col) => visibleCols.includes(col.id));
}

export function loanPaymentMovementCell(columnId: string, movement: PaymentMovement) {
  switch (columnId) {
    case "ref":
      return movement.ref;
    case "dueDate":
      return movement.dueDate;
    case "paidDate":
      return movement.paidDate;
    case "paidTime":
      return movement.paidTime;
    case "concept":
      return movement.chargeLabel;
    case "collector":
      return movement.collector;
    case "method":
      return movement.method;
    case "evidence":
      return movement.hasReceipt ? "Sí" : "—";
    case "source":
      return movement.source;
    case "amount":
      return money(movement.amount);
    default:
      return "—";
  }
}
