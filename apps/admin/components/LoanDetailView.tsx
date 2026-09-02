"use client";

import { useMemo } from "react";
import { money, type LoanRow } from "@/lib/mock-data";
import {
  buildLoanDetailFields,
  interestChargeCount,
  syncLoan,
} from "@/lib/loan-preview";
import { QuadDetailTable } from "@/components/QuadDetailTable";

type Props = {
  loan: LoanRow;
};

export function LoanDetailView({ loan }: Props) {
  const synced = useMemo(() => syncLoan(loan), [loan]);
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
      code={loan.ref}
      fields={fields}
    />
  );
}
