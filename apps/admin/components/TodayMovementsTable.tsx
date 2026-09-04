"use client";

import { useMemo } from "react";
import { ColumnPicker, ColumnPickerBodyCell, useColumnVisibility } from "@/components/ColumnPicker";
import { PaymentStatusPill } from "@/components/PaymentStatusPill";
import { DataTable } from "@/components/ui";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { loansByRef, paymentTimeLabel } from "@/lib/payment-detail";
import {
  HOME_TODAY_MOVEMENT_COLUMNS,
  HOME_TODAY_MOVEMENT_DEFAULT_COLS,
} from "@/lib/table-columns";

type Props = {
  payments: PaymentRow[];
  loans?: LoanRow[];
  onCreate?: () => void;
  onOpenPayment?: (ref: string) => void;
};

const HEADER_DEFS: Record<string, { t: string; right?: boolean }> = {
  ref: { t: "Ref" },
  when: { t: "Hora" },
  client: { t: "Cliente" },
  collector: { t: "Cobrador" },
  amount: { t: "Valor", right: true },
  type: { t: "Tipo" },
  status: { t: "Estado" },
};

export function TodayMovementsTable({ payments, loans = [], onCreate, onOpenPayment }: Props) {
  const loanMap = useMemo(() => loansByRef(loans), [loans]);
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    HOME_TODAY_MOVEMENT_COLUMNS,
    HOME_TODAY_MOVEMENT_DEFAULT_COLS,
    { storageKey: "nexo.inicio.movimientos-hoy.columns" },
  );

  const headers = useMemo(
    () =>
      HOME_TODAY_MOVEMENT_COLUMNS.filter((col) => isVisible(col.id)).map(
        (col) => HEADER_DEFS[col.id],
      ),
    [isVisible],
  );

  return (
    <DataTable
      showFilters={false}
      title="Movimientos de hoy"
      count={payments.length}
      headers={headers}
      onCreate={onCreate}
      toolbarEnd={
        <ColumnPicker
          columns={HOME_TODAY_MOVEMENT_COLUMNS}
          visibleCols={visibleCols}
          onToggle={toggleColumn}
        />
      }
    >
      {payments.map((row) => (
        <tr key={row.ref}>
          {isVisible("ref") ? (
            <td className="ref">
              {onOpenPayment ? (
                <button type="button" className="linkish" onClick={() => onOpenPayment(row.ref)}>
                  {row.ref}
                </button>
              ) : (
                row.ref
              )}
            </td>
          ) : null}
          {isVisible("when") ? <td>{paymentTimeLabel(row)}</td> : null}
          {isVisible("client") ? <td>{row.client}</td> : null}
          {isVisible("collector") ? <td>{row.collector}</td> : null}
          {isVisible("amount") ? <td className="money right">{money(row.amount)}</td> : null}
          {isVisible("type") ? <td>{row.type}</td> : null}
          {isVisible("status") ? (
            <td>
              <PaymentStatusPill
                payment={row}
                loan={row.loanRef ? loanMap.get(row.loanRef) : undefined}
              />
            </td>
          ) : null}
          <ColumnPickerBodyCell />
        </tr>
      ))}
    </DataTable>
  );
}
