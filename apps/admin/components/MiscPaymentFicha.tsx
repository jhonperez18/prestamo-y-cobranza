"use client";

import { Icon } from "@/components/icons";
import { QuadDetailTable } from "@/components/QuadDetailTable";
import { Pill } from "@/components/ui";
import type { BankAccount, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  formatBankAmount,
  isPeriodClosed,
  isoToDisplay,
  movementDisplayRef,
} from "@/lib/bank";
import type { MiscPayment } from "@/lib/misc-payments";
import { movementForMiscPayment } from "@/lib/misc-payments";
import { paymentMethodLabel } from "@/lib/payment-method";

type Props = {
  payment: MiscPayment;
  bankAccounts: BankAccount[];
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  onEdit: () => void;
  onOpenBankRecord?: (movementRef: string) => void;
  onBack?: () => void;
};

export function MiscPaymentFicha({
  payment,
  bankAccounts,
  movements,
  reconciliations,
  onEdit,
  onOpenBankRecord,
  onBack,
}: Props) {
  const account = bankAccounts.find((row) => row.ref === payment.bankAccountRef);
  const movement = movementForMiscPayment(movements, payment.ref);
  const closed = movement
    ? isPeriodClosed(reconciliations, movement.accountRef, movement.period) || movement.reconciled
    : false;

  const bankStatus = movement
    ? closed
      ? "Conciliado"
      : "Pendiente de conciliar"
    : "Sin registro bancario";

  return (
    <section className="panel misc-payment-ficha">
      <div className="head">
        {onBack ? (
          <button type="button" className="btn ghost compact misc-payment-back" onClick={onBack}>
            ← Volver
          </button>
        ) : null}
        <h1>Pago varios</h1>
        <span className="file-title-ref ref">{payment.ref}</span>
        <Pill label={bankStatus} kind={closed ? "ok" : "pending"} />
        <div className="grow" />
        <button type="button" className="btn primary compact" onClick={onEdit}>
          Modificar
        </button>
      </div>

      <div className="misc-payment-ficha-body">
        <QuadDetailTable
          fields={[
            { label: "Etiqueta", value: payment.label },
            { label: "Referencia", value: payment.ref },
            { label: "Fecha pago", value: isoToDisplay(payment.paidDate) },
            { label: "Fecha valor", value: isoToDisplay(payment.paidDate) },
            { label: "Dirección", value: "Debe" },
            { label: "Importe", value: formatBankAmount(payment.amount), money: true },
            {
              label: "Cuenta bancaria",
              value: account ? `${account.name} · ${account.bankName}` : payment.bankAccountRef,
            },
            { label: "Forma de pago", value: paymentMethodLabel(payment.method) },
          ]}
        />

        <div className="mini-block misc-payment-bank-link-block">
          <div className="mini-head">
            <h2>Registro bancario</h2>
          </div>
          {movement ? (
            <div className="misc-payment-bank-link-row">
              <span className="misc-payment-bank-ico" aria-hidden>
                <Icon name="bank" />
              </span>
              <div className="misc-payment-bank-link-text">
                <button
                  type="button"
                  className="btn-link bank-extract-ref-link"
                  onClick={() => onOpenBankRecord?.(movement.ref)}
                >
                  {movementDisplayRef(movement)}
                </button>
                <span>
                  {" "}
                  (Cuenta: {account?.name ?? movement.accountRef}
                  {closed ? ", conciliado" : ", pendiente de conciliar"})
                </span>
              </div>
            </div>
          ) : (
            <p className="ficha-empty">Aún no hay movimiento en el banco para este gasto.</p>
          )}
        </div>
      </div>
    </section>
  );
}
