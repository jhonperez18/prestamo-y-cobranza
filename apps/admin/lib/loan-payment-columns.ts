import type { ColumnOption } from "@/components/ColumnPicker";
import type { PaymentMovement } from "@/lib/payment-detail";
import { money } from "@/lib/mock-data";

export const LOAN_PAYMENT_COLUMNS_STORAGE_KEY = "nexo.prestamos.ficha-pagos.columns.v4";

export const LOAN_PAYMENT_COLUMNS: ColumnOption[] = [
  { id: "ref", label: "Pago" },
  { id: "paidDate", label: "Fecha recaudo" },
  { id: "paidTime", label: "Hora" },
  { id: "concept", label: "Concepto" },
  { id: "collector", label: "Cobrador" },
  { id: "method", label: "Método" },
  { id: "evidence", label: "Comprobante" },
  { id: "source", label: "Origen" },
  { id: "cuota", label: "Cuota" },
  { id: "amount", label: "Cobrado" },
  { id: "estado", label: "Estado" },
];

export const LOAN_PAYMENT_DEFAULT_COLS = LOAN_PAYMENT_COLUMNS.map((col) => col.id);

/** Columnas del PDF al compartir ficha desde el celular (como la pantalla). */
export const LOAN_FICHA_SHARE_COLS = ["cuota", "amount", "paidDate", "paidTime", "method", "estado"];

export function orderedVisibleLoanPaymentColumns(visibleCols: string[]) {
  return LOAN_PAYMENT_COLUMNS.filter((col) => visibleCols.includes(col.id));
}

export function loanPaymentMovementCell(columnId: string, movement: PaymentMovement) {
  switch (columnId) {
    case "ref":
      return movement.ref;
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
    case "cuota":
      return movement.cuotaPactada > 0 ? money(movement.cuotaPactada) : "—";
    case "amount":
      return money(movement.amount);
    case "estado":
      return movement.settlementLabel || "—";
    default:
      return "—";
  }
}
