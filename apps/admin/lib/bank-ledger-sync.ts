/**
 * Única sincronización banco ← cobros + gastos + pagos varios.
 * Evita efectos duplicados que triplicaban filas en Registros.
 * Regla de raíz: todo pago PG- que entra al banco = Ingreso (Debe).
 */
import {
  bankMovementsSignature,
  ensureBankAccounts,
  loanRouteIndex,
  lockPaymentCobrosAsIncome,
  normalizeBankMovements,
  repairMiscPaymentLinks,
  syncAllPaymentsToMovements,
  syncMiscPaymentsToMovements,
  syncCashLoanDisbursementsToMovements,
  syncNequiLoanDisbursementsToMovements,
  type BankAccount,
  type BankMovement,
} from "@/lib/bank";
import {
  syncRouteExpensesToMovements,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { MiscPayment } from "@/lib/misc-payments";
import type { ClientRow, LoanRow, PaymentRow } from "@/lib/mock-data";

export function syncBankLedger(input: {
  payments: PaymentRow[];
  movements: BankMovement[];
  accounts: BankAccount[];
  miscPayments: MiscPayment[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  dayCloses: CollectorDayCloseRecord[];
  /** Préstamos: Banco/Nequi → Haber DSB-; efectivo → Haber CSH- en la cuenta principal. */
  loans: LoanRow[];
  /** Ruta del cliente: decide la cuenta del cobro no efectivo (A → Nequi; M/T/N → Banco). */
  clients: ClientRow[];
}): BankMovement[] {
  const accounts = ensureBankAccounts(input.accounts);
  const account = accounts.find((row) => row.active) ?? accounts[0] ?? null;
  const routeByLoan = loanRouteIndex(input.loans, input.clients);
  const withPayments = syncAllPaymentsToMovements(
    input.payments,
    input.movements,
    accounts,
    routeByLoan,
  );
  const withMisc = syncMiscPaymentsToMovements(
    input.miscPayments,
    repairMiscPaymentLinks(input.miscPayments, withPayments),
  );
  const withExpenses = syncRouteExpensesToMovements(
    input.dayExpenseDrafts,
    input.dayCloses,
    normalizeBankMovements(withMisc),
    account?.ref,
  );
  const withLoans = syncNequiLoanDisbursementsToMovements(
    input.loans,
    withExpenses,
    accounts,
    input.clients,
  );
  const withCashLoans = syncCashLoanDisbursementsToMovements(
    input.loans,
    withLoans,
    accounts,
  );
  // Último paso: los cobros nunca se desalinean de Ingresos.
  return normalizeBankMovements(
    lockPaymentCobrosAsIncome(withCashLoans, input.payments, routeByLoan),
  );
}

/** Aplica sync solo si el contenido cambió (corta bucles de setState). */
export function applyBankLedgerSync(
  current: BankMovement[],
  input: Omit<Parameters<typeof syncBankLedger>[0], "movements"> & {
    movements?: BankMovement[];
  },
): BankMovement[] {
  const next = syncBankLedger({ ...input, movements: input.movements ?? current });
  if (bankMovementsSignature(next) === bankMovementsSignature(current)) return current;
  return next;
}
