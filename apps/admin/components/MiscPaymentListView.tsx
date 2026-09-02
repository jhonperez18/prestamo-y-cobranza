"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditMiniIcon, PlusIcon } from "@/components/icons";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { Pill } from "@/components/ui";
import type { BankAccount, BankMovement, BankReconciliation } from "@/lib/bank";
import { formatBankAmount, isPeriodClosed, isoToDisplay } from "@/lib/bank";
import type { MiscPayment } from "@/lib/misc-payments";
import { paymentMethodLabel } from "@/lib/payment-method";
import { MISC_PAYMENT_COLUMNS, MISC_PAYMENT_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  payments: MiscPayment[];
  bankAccounts: BankAccount[];
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  highlightRef?: string;
  onBack?: () => void;
  onOpenFicha?: (ref: string) => void;
  onEdit?: (ref: string) => void;
  onCreate: () => void;
};

function paymentStatus(
  payment: MiscPayment,
  movements: BankMovement[],
  reconciliations: BankReconciliation[],
) {
  const movement = movements.find((row) => row.miscPaymentRef === payment.ref);
  if (!movement) {
    return { label: "Pendiente", kind: "pending" as const };
  }
  const closed = isPeriodClosed(reconciliations, movement.accountRef, movement.period);
  if (closed || movement.reconciled) {
    return { label: "Conciliado", kind: "ok" as const };
  }
  return { label: "Pendiente", kind: "pending" as const };
}

export function MiscPaymentListView({
  payments,
  bankAccounts,
  movements,
  reconciliations,
  highlightRef,
  onBack,
  onOpenFicha,
  onEdit,
  onCreate,
}: Props) {
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    MISC_PAYMENT_COLUMNS,
    MISC_PAYMENT_DEFAULT_COLS,
    { storageKey: "nexo.pagos-varios.listado.columns" },
  );
  const showActions = Boolean(onEdit) && isVisible("actions");

  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const accountMap = useMemo(
    () => new Map(bankAccounts.map((row) => [row.ref, row.name])),
    [bankAccounts],
  );

  const sorted = useMemo(
    () =>
      [...payments].sort((a, b) => {
        const dateCmp = b.paidDate.localeCompare(a.paidDate);
        if (dateCmp !== 0) return dateCmp;
        return b.ref.localeCompare(a.ref);
      }),
    [payments],
  );

  const total = useMemo(
    () => sorted.reduce((sum, row) => sum + row.amount, 0),
    [sorted],
  );

  useEffect(() => {
    if (!highlightRef || !highlightRowRef.current) return;
    highlightRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightRef, sorted.length]);

  return (
    <section className="panel misc-payment-list-panel">
      <div className="head">
        {onBack ? (
          <button type="button" className="btn ghost compact misc-payment-back" onClick={onBack}>
            ← Extracto
          </button>
        ) : null}
        <h1>Pagos varios</h1>
        <span className="count">{sorted.length}</span>
        <div className="grow" />
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        <button className="plus" title="Nuevo pago varios" type="button" onClick={onCreate}>
          <PlusIcon />
        </button>
        <ColumnPicker
          columns={MISC_PAYMENT_COLUMNS}
          visibleCols={visibleCols}
          onToggle={toggleColumn}
        />
      </div>

      <div className="table-wrap">
        <table className="data list-grid misc-payment-list-table">
          <thead>
            <tr className="col-titles">
              {isVisible("ref") ? <th>Ref.</th> : null}
              {isVisible("label") ? <th>Etiqueta</th> : null}
              {isVisible("paidDate") ? <th>Fecha pago</th> : null}
              {isVisible("account") ? <th>Cuenta bancaria</th> : null}
              {isVisible("method") ? <th>Forma de pago</th> : null}
              {isVisible("amount") ? <th className="right">Importe</th> : null}
              {isVisible("status") ? <th>Estado</th> : null}
              {showActions ? <th className="center">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length}>
                  No hay pagos varios registrados.{" "}
                  <button type="button" className="btn-link" onClick={onCreate}>
                    Registrar nuevo
                  </button>
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const status = paymentStatus(row, movements, reconciliations);
                const highlighted = highlightRef === row.ref;
                return (
                  <tr
                    key={row.ref}
                    ref={highlighted ? highlightRowRef : undefined}
                    className={
                      highlighted ? "bank-row-expense misc-payment-row-highlight" : "bank-row-expense"
                    }
                    onClick={onOpenFicha ? () => onOpenFicha(row.ref) : undefined}
                    style={onOpenFicha ? { cursor: "pointer" } : undefined}
                  >
                    {isVisible("ref") ? (
                      <td className="ref">
                        {onOpenFicha ? (
                          <button
                            type="button"
                            className="btn-link bank-extract-ref-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenFicha(row.ref);
                            }}
                          >
                            {row.ref}
                          </button>
                        ) : (
                          row.ref
                        )}
                      </td>
                    ) : null}
                    {isVisible("label") ? <td>{row.label}</td> : null}
                    {isVisible("paidDate") ? <td>{isoToDisplay(row.paidDate)}</td> : null}
                    {isVisible("account") ? (
                      <td>{accountMap.get(row.bankAccountRef) ?? row.bankAccountRef}</td>
                    ) : null}
                    {isVisible("method") ? <td>{paymentMethodLabel(row.method)}</td> : null}
                    {isVisible("amount") ? (
                      <td className="right money bank-debit">{formatBankAmount(row.amount)}</td>
                    ) : null}
                    {isVisible("status") ? (
                      <td>
                        <Pill label={status.label} kind={status.kind} />
                      </td>
                    ) : null}
                    {showActions ? (
                      <td className="center bank-row-actions">
                        <button
                          type="button"
                          className="bank-action-btn"
                          title="Modificar"
                          aria-label="Modificar"
                          onClick={() => onEdit!(row.ref)}
                        >
                          <EditMiniIcon />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
          {sorted.length > 0 && isVisible("amount") ? (
            <tfoot>
              <tr className="bank-total-row">
                <td
                  colSpan={
                    ["ref", "label", "paidDate", "account", "method"].filter((id) => isVisible(id))
                      .length
                  }
                >
                  Total gastado
                </td>
                <td className="right money">{formatBankAmount(total)}</td>
                {["status", "actions"].filter((id) => isVisible(id) || (id === "actions" && showActions))
                  .length > 0 ? (
                  <td
                    colSpan={
                      ["status", "actions"].filter((id) => isVisible(id) || (id === "actions" && showActions))
                        .length
                    }
                  />
                ) : null}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
