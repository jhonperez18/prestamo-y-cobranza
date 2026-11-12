/**
 * Préstamo al terminar.
 *
 * El cliente pagó hoy todo el saldo de su crédito y queda libre para uno nuevo
 * en ese mismo instante. Quién presta decide el origen del dinero:
 * - cobrador: efectivo de su caja (gasto «Préstamo» del día, resta En caja);
 * - supervisor: Nequi / Banco del dueño (resta el acumulado Nequi).
 *
 * El renglón del cliente en los registros del día se pinta azul cuando ya se
 * le desembolsó el crédito nuevo.
 *
 * Fin (dueño): el cobro que liquidó ese crédito sigue con etiqueta Fin aunque
 * debajo haya Prestado. Cobrador y supervisor leen la misma bandera
 * `finishedToday`.
 */
import { isCollectorLiveDevice, syncCollectorLiveLoan } from "@/lib/collector-live-window";
import { syncLoan } from "@/lib/loan-preview";
import {
  canClientTakeNewLoan,
  isLoanActive,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import { isCashlessRenewal, loanDisbursementIsoDate } from "@/lib/nequi-pool";

function liveBalance(loan: LoanRow, payments: PaymentRow[], date: string) {
  const synced = isCollectorLiveDevice()
    ? syncCollectorLiveLoan(loan, payments, date)
    : (syncLoan(loan) as LoanRow);
  return Number(synced.balance ?? 0);
}

/** El crédito quedó en cero con un cobro vivo de esa fecha (terminó hoy). */
export function loanSettledOnDate(
  loan: LoanRow | null | undefined,
  payments: PaymentRow[],
  date: string,
): boolean {
  if (!loan) return false;
  if (liveBalance(loan, payments, date) > 0) return false;
  return payments.some(
    (row) =>
      row.loanRef === loan.ref &&
      !row.voidedAt?.trim() &&
      (row.paidDate || "").trim() === date,
  );
}

/** Crédito nuevo desembolsado a ese cliente en esa fecha (renglón azul). */
export function loanGrantedOnDate(
  clientRef: string,
  loans: LoanRow[],
  payments: PaymentRow[],
  date: string,
): LoanRow | null {
  return (
    loans.find(
      (loan) =>
        loan.clientRef === clientRef &&
        loanDisbursementIsoDate(loan) === date &&
        isLoanActive(loan) &&
        !isCashlessRenewal(loan),
    ) ?? null
  );
}

/** Renovación hecha a ese cliente en esa fecha (renglón «Renovado»: sin plata). */
export function loanRenewedOnDate(clientRef: string, loans: LoanRow[], date: string): LoanRow | null {
  return (
    loans.find(
      (loan) =>
        loan.clientRef === clientRef &&
        loanDisbursementIsoDate(loan) === date &&
        isLoanActive(loan) &&
        isCashlessRenewal(loan),
    ) ?? null
  );
}

export type ReloanState = {
  /**
   * Este crédito liquidó hoy → etiqueta Fin (cobrador Recaudo y supervisor Ruta).
   * Sigue en true aunque ya haya Prestado debajo.
   */
  finishedToday: boolean;
  /** Terminó hoy y no tiene otro crédito abierto: se le puede prestar ya. */
  canReloan: boolean;
  /** Crédito nuevo entregado hoy (si ya se le prestó). */
  granted: LoanRow | null;
  /** Renovado hoy: lo que debía + 20 % (no es préstamo nuevo). */
  renewed: LoanRow | null;
};

function emptyReloan(): ReloanState {
  return { finishedToday: false, canReloan: false, granted: null, renewed: null };
}

/** Estado del renglón de un cliente en los registros del día. */
export function reloanStateForVisit(input: {
  clientRef: string;
  loanRef: string | undefined;
  loans: LoanRow[];
  payments: PaymentRow[];
  date: string;
}): ReloanState {
  const { clientRef, loanRef, loans, payments, date } = input;
  if (!clientRef) return emptyReloan();
  const loan = loanRef ? loans.find((row) => row.ref === loanRef) ?? null : null;
  const granted = loanGrantedOnDate(clientRef, loans, payments, date);
  const settled =
    Boolean(loan) &&
    (!granted || granted.ref !== loan!.ref) &&
    loanSettledOnDate(loan, payments, date);
  const finishedToday = settled;

  if (granted) {
    return { finishedToday, canReloan: false, granted, renewed: null };
  }
  const renewed = loanRenewedOnDate(clientRef, loans, date);
  // «Renovado» es el renglón del vencido; la cuota del renovado es un cobro normal.
  if (renewed && renewed.ref !== loanRef) {
    return { finishedToday: false, canReloan: false, granted: null, renewed };
  }
  if (renewed) {
    return { finishedToday: false, canReloan: false, granted: null, renewed: null };
  }
  if (!settled) return emptyReloan();
  // El crédito que terminó hoy puede seguir «Activo» hasta proyectar el estado: no cuenta.
  const others = loans.filter((row) => row.ref !== loan?.ref);
  return {
    finishedToday: true,
    canReloan: canClientTakeNewLoan(clientRef, others),
    granted: null,
    renewed: null,
  };
}
