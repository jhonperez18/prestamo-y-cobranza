"use client";

import { useMemo } from "react";
import { voidedPayments, livePayments } from "@/lib/live-payments";
import type { PaymentRow, UserRow } from "@/lib/mock-data";
import { money } from "@/lib/mock-data";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";

export type AuditEvent = {
  id: string;
  when: string;
  sortKey: string;
  user: string;
  action: string;
  entity: string;
  detail: string;
};

type Props = {
  payments: PaymentRow[];
  users: UserRow[];
};

function stampFromPayment(row: PaymentRow): { label: string; sortKey: string } {
  if (row.paidDate && /^\d{4}-\d{2}-\d{2}$/.test(row.paidDate)) {
    const t = row.paidTime || "00:00";
    return {
      label: `${isoToDispatchLabel(row.paidDate)} · ${t}`,
      sortKey: `${row.paidDate}T${t}`,
    };
  }
  return { label: row.when || "—", sortKey: row.when || "" };
}

/** Auditoría compacta desde PG- reales (altas + anulaciones). */
export function buildPaymentAuditEvents(payments: PaymentRow[]): AuditEvent[] {
  const events: AuditEvent[] = [];

  for (const row of livePayments(payments)) {
    const stamp = stampFromPayment(row);
    events.push({
      id: `pay-${row.ref}`,
      when: stamp.label,
      sortKey: stamp.sortKey,
      user: row.collector || "—",
      action: "Cobro",
      entity: row.ref,
      detail: `${row.client || "—"} · ${money(row.amount)} · ${row.method || "—"}`,
    });
  }

  for (const row of voidedPayments(payments)) {
    const voidDay = (row.voidedAt || "").slice(0, 10);
    const when =
      voidDay && /^\d{4}-\d{2}-\d{2}$/.test(voidDay)
        ? isoToDispatchLabel(voidDay)
        : row.voidedAt || "—";
    events.push({
      id: `void-${row.ref}`,
      when,
      sortKey: row.voidedAt || voidDay || "",
      user: row.voidedBy || "—",
      action: "Anulación",
      entity: row.ref,
      detail: `${row.voidReason || "—"} · ${money(row.amount)}`,
    });
  }

  return events.sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 200);
}

export function AuditoriaView({ payments }: Props) {
  const events = useMemo(() => buildPaymentAuditEvents(payments), [payments]);

  return (
    <section className="panel auditoria-panel">
      <div className="head">
        <h1>Auditoría</h1>
        <span className="count">{events.length}</span>
      </div>
      <p className="ficha-empty" style={{ margin: "0 0 10px", opacity: 0.75 }}>
        Cobros y anulaciones desde la raíz PG- (últimos 200).
      </p>
      <div className="table-wrap">
        <table className="data list-grid">
          <thead>
            <tr className="col-titles">
              <th>Fecha</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Entidad</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={5}>Sin eventos aún.</td>
              </tr>
            ) : (
              events.map((row) => (
                <tr key={row.id}>
                  <td>{row.when}</td>
                  <td>{row.user}</td>
                  <td>{row.action}</td>
                  <td>
                    <span className="ref">{row.entity}</span>
                  </td>
                  <td>{row.detail}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
