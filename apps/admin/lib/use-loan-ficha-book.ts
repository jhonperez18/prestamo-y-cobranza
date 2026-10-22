"use client";

import { useEffect, useState } from "react";
import type { LoanRow, PaymentRow } from "@/lib/mock-data";
import { mirrorToLoanRow, type LoanMirrorRow } from "@/lib/supabase/catalog-mirror";
import {
  mirrorRowToPaymentRow,
  rememberMissingLoanPayments,
  type PaymentMirrorRow,
} from "@/lib/supabase/payment-mirror";

export type LoanFichaBook = { loan: LoanRow; payments: PaymentRow[] };

/**
 * Ficha y cobros de un préstamo, leídos de la base.
 * La lista del aparato se corta en los primeros días y deja el saldo corto.
 * Esto no recalcula ni escribe el saldo.
 */
export function useLoanFichaBook(loanRef: string): { book: LoanFichaBook | null; failed: boolean } {
  const [book, setBook] = useState<LoanFichaBook | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loanRef) {
      setBook(null);
      setFailed(false);
      return;
    }
    let cancel = false;
    setBook(null);
    setFailed(false);
    void (async () => {
      try {
        const [payRes, loanRes] = await Promise.all([
          fetch(`/api/payments?loanRef=${encodeURIComponent(loanRef)}`, { cache: "no-store" }),
          fetch(`/api/loans?ref=${encodeURIComponent(loanRef)}`, { cache: "no-store" }),
        ]);
        const payBody = (await payRes.json()) as { ok?: boolean; payments?: PaymentMirrorRow[] };
        const loanBody = (await loanRes.json()) as { ok?: boolean; loans?: LoanMirrorRow[] };
        const loanRow = loanBody.loans?.[0] ? mirrorToLoanRow(loanBody.loans[0]) : null;
        const rows = (payBody.payments ?? [])
          .map(mirrorRowToPaymentRow)
          .filter((row): row is PaymentRow => Boolean(row));
        if (cancel) return;
        if (!payRes.ok || !payBody.ok || !loanRes.ok || !loanBody.ok || !loanRow) {
          setFailed(true);
          return;
        }
        rememberMissingLoanPayments(rows);
        setBook({ loan: loanRow, payments: rows });
      } catch {
        if (!cancel) setFailed(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [loanRef]);

  return { book, failed };
}
