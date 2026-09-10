"use client";

import { useMemo } from "react";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import {
  buildLoanDetailFields,
  interestChargeCount,
  syncLoan,
} from "@/lib/loan-preview";
import { QuadDetailTable } from "@/components/QuadDetailTable";

type Props = {
  loan: LoanRow;
  payments?: PaymentRow[];
};

export function LoanDetailView({ loan, payments }: Props) {
  const synced = useMemo(() => syncLoan(loan, payments), [loan, payments]);
  const schedule = synced.schedule ?? [];
  const interestCount = interestChargeCount(schedule);

  const fields = buildLoanDetailFields({
    capital: synced.capital,
    date: synced.date,
    due: synced.due,
    frequency: synced.frequency ?? "diario",
    mode: synced.mode,
    pact: synced.pact,
    rate: synced.rate,
    installment: synced.installment,
    interest: synced.interest,
    total: synced.total,
    days: synced.days,
    interestCount,
    notes: synced.notes,
    formatMoney: money,
  });

  return (
    <QuadDetailTable
      title="Ficha del préstamo"
      plainTitle
      code={loan.ref}
      fields={fields}
    />
  );
}
