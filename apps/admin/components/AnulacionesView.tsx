"use client";

import { useMemo } from "react";
import { PaymentRefLink } from "@/components/PaymentRefLink";
import { usePhoneLayout } from "@/components/route-board-phone";
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

function voidReasonLabel(row: PaymentRow) {
  const direct = String(row.voidReason || "").trim();
  if (direct) return direct;
  return "—";
}

export function AnulacionesView({ payments, loans, onOpenPayment }: Props) {
  const isPhone = usePhoneLayout();
  const rows = useMemo(() => {
    return [...voidedPayments(payments)].sort((a, b) =>
      String(b.voidedAt || "").localeCompare(String(a.voidedAt || "")),
    );
  }, [payments]);

  const table = (
    <table className={isPhone ? "data list-grid phone-route-table" : "data list-grid"}>
      <thead>
        <tr className="col-titles">
          <th>Ref.</th>
          <th>Anulado</th>
          <th className="is-nombre">Cliente</th>
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
                <td className="is-nombre">{row.client || loan?.client || "—"}</td>
                <td>{row.collector || "—"}</td>
                <td className="money right">{money(row.amount)}</td>
                <td>{voidReasonLabel(row)}</td>
                <td>
                  <Pill label={row.voidedBy || "—"} kind="warn" />
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  return (
    <section className={isPhone ? "panel anulaciones-panel is-phone-route-panel" : "panel anulaciones-panel"}>
      <div className="head">
        <h1>Anulaciones</h1>
        <span className="count">{rows.length}</span>
      </div>

      {isPhone ? <div className="phone-route-sheet anulaciones-sheet">{table}</div> : <div className="table-wrap">{table}</div>}
    </section>
  );
}
