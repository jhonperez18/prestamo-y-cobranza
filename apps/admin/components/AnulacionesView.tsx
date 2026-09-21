"use client";

import { useMemo } from "react";
import { PaymentRefLink } from "@/components/PaymentRefLink";
import { Pill } from "@/components/ui";
import { voidedPayments } from "@/lib/live-payments";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";

type Props = {
  payments: PaymentRow[];
  loans: LoanRow[];
  onOpenPayment: (ref: string) => void;
};

function voidDateLabel(iso: string) {
  const day = iso.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return isoToDispatchLabel(day);
  return day || "—";
}

export function AnulacionesView({ payments, loans, onOpenPayment }: Props) {
  const rows = useMemo(() => {
    return [...voidedPayments(payments)].sort((a, b) =>
      String(b.voidedAt || "").localeCompare(String(a.voidedAt || "")),
    );
  }, [payments]);

  return (
    <section className="panel anulaciones-panel">
      <div className="head">
        <h1>Anulaciones</h1>
        <span className="count">{rows.length}</span>
      </div>

      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              <th>Ref.</th>
              <th>Anulado</th>
              <th>Cliente</th>
              <th>Cobrador</th>
              <th className="right">Valor</th>
              <th>Motivo</th>
              <th>Por</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={7}>No hay pagos anulados. Desde la ficha de un pago vivo puedes anularlo.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const loan = loans.find((l) => l.ref === row.loanRef);
                return (
                  <tr key={row.ref} className="clickable" onClick={() => onOpenPayment(row.ref)}>
                    <td>
                      <PaymentRefLink refCode={row.ref} onOpen={onOpenPayment} />
                    </td>
                    <td>{voidDateLabel(row.voidedAt || "")}</td>
                    <td>{row.client || loan?.client || "—"}</td>
                    <td>{row.collector || "—"}</td>
                    <td className="money right">{money(row.amount)}</td>
                    <td>{row.voidReason || "—"}</td>
                    <td>
                      <Pill label={row.voidedBy || "—"} kind="warn" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
