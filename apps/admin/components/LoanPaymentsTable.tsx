"use client";

import { useMemo } from "react";
import { ColumnPicker, useColumnVisibility } from "@/components/ColumnPicker";
import { PaymentEvidenceThumb } from "@/components/PaymentEvidenceThumb";
import { PaymentRefLink } from "@/components/PaymentRefLink";
import { Pill } from "@/components/ui";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { LOAN_PAYMENT_COLUMNS, LOAN_PAYMENT_COLUMNS_STORAGE_KEY, LOAN_PAYMENT_DEFAULT_COLS } from "@/lib/loan-payment-columns";
import { money, type LoanRow, type PaymentRow } from "@/lib/mock-data";
import { normalizePaymentMethod, paymentMethodKind } from "@/lib/payment-method";
import {
  enrichPaymentMovement,
  sortPaymentsNewestFirst,
  type PaymentMovement,
} from "@/lib/payment-detail";

const STORAGE_KEY = LOAN_PAYMENT_COLUMNS_STORAGE_KEY;

type ColumnVisibilityApi = {
  visibleCols: string[];
  toggleColumn: (id: string) => void;
  isVisible: (id: string) => boolean;
  activeColumns: { id: string; label: string }[];
};

type FooterRow = { label: string; value: string; highlight?: boolean };

type Props = {
  movements?: PaymentMovement[];
  payments?: PaymentRow[];
  loan?: LoanRow | null;
  assignments?: DailyCollectionAssignment[];
  title?: string;
  emptyMessage?: string;
  onOpenPayment?: (ref: string) => void;
  footer?: FooterRow[];
  className?: string;
  showColumnPicker?: boolean;
  columnVisibility?: ColumnVisibilityApi;
};

export function LoanPaymentsTable({
  movements: movementsProp,
  payments = [],
  loan = null,
  assignments = [],
  title,
  emptyMessage = "Este préstamo aún no tiene pagos registrados.",
  onOpenPayment,
  footer,
  className,
  showColumnPicker = true,
  columnVisibility,
}: Props) {
  const internalVisibility = useColumnVisibility(LOAN_PAYMENT_COLUMNS, LOAN_PAYMENT_DEFAULT_COLS, {
    storageKey: STORAGE_KEY,
  });
  const { isVisible, visibleCols, toggleColumn, activeColumns } = columnVisibility ?? internalVisibility;

  const movements = useMemo(() => {
    if (movementsProp) return movementsProp;
    return sortPaymentsNewestFirst(payments).map((row) =>
      enrichPaymentMovement(row, loan, assignments),
    );
  }, [movementsProp, payments, loan, assignments]);

  const paymentByRef = useMemo(() => new Map(payments.map((row) => [row.ref, row])), [payments]);

  const showHead = Boolean(title || showColumnPicker);

  return (
    <div className={`mini-block${className ? ` ${className}` : ""}`}>
      {showHead ? (
        <div className="mini-head loan-detail-head">
          {title ? (
            <>
              <h2>{title}</h2>
              <span className="mini-badge">{movements.length}</span>
            </>
          ) : null}
          {showColumnPicker ? (
            <>
              <span className="grow" />
              <ColumnPicker
                columns={LOAN_PAYMENT_COLUMNS}
                visibleCols={visibleCols}
                onToggle={toggleColumn}
              />
            </>
          ) : null}
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="data mini-grid loan-payments-table">
          <thead>
            <tr className="col-titles">
              {isVisible("ref") ? <th>Pago</th> : null}
              {isVisible("dueDate") ? <th>Fecha cuota</th> : null}
              {isVisible("paidDate") ? <th>Fecha recaudo</th> : null}
              {isVisible("paidTime") ? <th>Hora</th> : null}
              {isVisible("concept") ? <th>Concepto</th> : null}
              {isVisible("collector") ? <th>Cobrador</th> : null}
              {isVisible("method") ? <th>Forma de pago</th> : null}
              {isVisible("evidence") ? <th>Comprobante</th> : null}
              {isVisible("source") ? <th>Origen</th> : null}
              {isVisible("amount") ? <th className="right">Importe</th> : null}
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={activeColumns.length}>{emptyMessage}</td>
              </tr>
            ) : (
              movements.map((movement) => {
                const payment = paymentByRef.get(movement.ref);
                return (
                  <tr key={movement.ref}>
                    {isVisible("ref") ? (
                      <td>
                        {onOpenPayment ? (
                          <PaymentRefLink refCode={movement.ref} onOpen={onOpenPayment} />
                        ) : (
                          <span className="ref">{movement.ref}</span>
                        )}
                      </td>
                    ) : null}
                    {isVisible("dueDate") ? <td>{movement.dueDate}</td> : null}
                    {isVisible("paidDate") ? <td>{movement.paidDate}</td> : null}
                    {isVisible("paidTime") ? <td>{movement.paidTime}</td> : null}
                    {isVisible("concept") ? <td>{movement.chargeLabel}</td> : null}
                    {isVisible("collector") ? (
                      <td>{movement.collector}</td>
                    ) : null}
                    {isVisible("method") ? (
                      <td>
                        {payment ? (
                          <Pill
                            label={movement.method}
                            kind={paymentMethodKind(normalizePaymentMethod(payment.method))}
                          />
                        ) : (
                          movement.method
                        )}
                      </td>
                    ) : null}
                    {isVisible("evidence") ? (
                      <td>
                        <PaymentEvidenceThumb evidence={movement.evidence} />
                      </td>
                    ) : null}
                    {isVisible("source") ? <td>{movement.source}</td> : null}
                    {isVisible("amount") ? (
                      <td className="money right">{money(movement.amount)}</td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {footer?.length ? (
        <div className="pay-sum">
          {footer.map((row) => (
            <div key={row.label} className={row.highlight ? "rest" : undefined}>
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
