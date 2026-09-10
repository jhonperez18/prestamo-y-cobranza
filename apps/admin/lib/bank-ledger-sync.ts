/**
 * Única sincronización banco ← cobros + gastos + pagos varios.
 * Evita efectos duplicados que triplicaban filas en Registros.
 * Regla de raíz: todo pago PG- que entra al banco = Ingreso (Debe).
 */
import {
  bankMovementsSignature,
  ensureBankAccounts,
  lockPaymentCobrosAsIncome,
  normalizeBankMovements,
  repairMiscPaymentLinks,
  syncAllPaymentsToMovements,
  syncMiscPaymentsToMovements,
  type BankAccount,
  type BankMovement,
} from "@/lib/bank";
import {
  syncRouteExpensesToMovements,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import type { MiscPayment } from "@/lib/misc-payments";
import type { PaymentRow } from "@/lib/mock-data";

export function syncBankLedger(input: {
  payments: PaymentRow[];
  movements: BankMovement[];
  accounts: BankAccount[];
  miscPayments: MiscPayment[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  dayCloses: CollectorDayCloseRecord[];
}): BankMovement[] {
  const accounts = ensureBankAccounts(input.accounts);
  const account = accounts.find((row) => row.active) ?? accounts[0] ?? null;
  const withPayments = syncAllPaymentsToMovements(input.payments, input.movements, accounts);
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
  // Último paso: los cobros nunca se desalinean de Ingresos.
  return normalizeBankMovements(lockPaymentCobrosAsIncome(withExpenses, input.payments));
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
