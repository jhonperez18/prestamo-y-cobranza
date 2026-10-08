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
    : (syncLoan(loan, payments) as LoanRow);
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
  /** Terminó hoy y no tiene otro crédito abierto: se le puede prestar ya. */
  canReloan: boolean;
  /** Crédito nuevo entregado hoy (si ya se le prestó). */
  granted: LoanRow | null;
  /** Renovado hoy: lo que debía + 20 % (no es préstamo nuevo). */
  renewed: LoanRow | null;
};

/** Estado del renglón de un cliente en los registros del día. */
export function reloanStateForVisit(input: {
  clientRef: string;
  loanRef: string | undefined;
  loans: LoanRow[];
  payments: PaymentRow[];
  date: string;
}): ReloanState {
  const { clientRef, loanRef, loans, payments, date } = input;
  if (!clientRef) return { canReloan: false, granted: null, renewed: null };
  const granted = loanGrantedOnDate(clientRef, loans, payments, date);
  if (granted) return { canReloan: false, granted, renewed: null };
  const renewed = loanRenewedOnDate(clientRef, loans, date);
  if (renewed) return { canReloan: false, granted: null, renewed };
  const loan = loanRef ? loans.find((row) => row.ref === loanRef) ?? null : null;
  if (!loanSettledOnDate(loan, payments, date)) return { canReloan: false, granted: null, renewed: null };
  // El crédito que terminó hoy puede seguir «Activo» hasta proyectar el estado: no cuenta.
  const others = loans.filter((row) => row.ref !== loan?.ref);
  return { canReloan: canClientTakeNewLoan(clientRef, others), granted: null, renewed: null };
}
