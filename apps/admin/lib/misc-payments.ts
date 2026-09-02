import type { PaymentMethod } from "@/lib/payment-method";
import type { BankMovement } from "@/lib/bank";
import { displayToday } from "@/lib/bank";

export type MiscPayment = {
  ref: string;
  paidDate: string;
  label: string;
  amount: number;
  bankAccountRef: string;
  method: PaymentMethod;
  createdAt: string;
};

let miscCounter = 0;

export function nextMiscPaymentRef(existing: MiscPayment[]) {
  const nums = existing
    .map((row) => Number(row.ref.replace(/^PV-/i, "")))
    .filter((value) => Number.isFinite(value));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `PV-${next}`;
}

export function createMiscPayment(input: {
  paidDate: string;
  label: string;
  amount: number;
  bankAccountRef: string;
  method: PaymentMethod;
  existing: MiscPayment[];
}): MiscPayment {
  miscCounter += 1;
  return {
    ref: nextMiscPaymentRef(input.existing),
    paidDate: input.paidDate || displayToday(),
    label: input.label.trim() || "Pago varios",
    amount: input.amount,
    bankAccountRef: input.bankAccountRef,
    method: input.method,
    createdAt: new Date().toISOString(),
  };
}

export function updateMiscPayment(
  payment: MiscPayment,
  patch: {
    paidDate: string;
    label: string;
    amount: number;
    bankAccountRef: string;
    method: PaymentMethod;
  },
): MiscPayment {
  return {
    ...payment,
    paidDate: patch.paidDate || displayToday(),
    label: patch.label.trim() || "Pago varios",
    amount: patch.amount,
    bankAccountRef: patch.bankAccountRef,
    method: patch.method,
  };
}

export function findMiscPaymentForMovement(row: BankMovement, miscPayments: MiscPayment[]) {
  if (row.miscPaymentRef) {
    return miscPayments.find((payment) => payment.ref === row.miscPaymentRef) ?? null;
  }
  if (row.debit <= 0) return null;
  return (
    miscPayments.find(
      (payment) =>
        payment.bankAccountRef === row.accountRef &&
        payment.paidDate === row.valueDate &&
        payment.amount === row.debit &&
        (payment.label === row.thirdParty ||
          row.description.includes(payment.label) ||
          row.description.includes("Pago varios")),
    ) ?? null
  );
}

export function movementForMiscPayment(movements: BankMovement[], miscPaymentRef: string) {
  return movements.find((row) => row.miscPaymentRef === miscPaymentRef) ?? null;
}

export function miscPaymentRefForMovement(row: BankMovement, miscPayments: MiscPayment[]) {
  return findMiscPaymentForMovement(row, miscPayments)?.ref ?? null;
}
