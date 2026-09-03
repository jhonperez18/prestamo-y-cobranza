"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { QuadDetailTable } from "@/components/QuadDetailTable";
import { Pill } from "@/components/ui";
import type {
  BankAccount,
  BankExpenseCategory,
  BankMovement,
  BankReconciliation,
} from "@/lib/bank";
import {
  expenseCategoryLabel,
  formatBankAmount,
  bankMovementAmount,
  isPeriodClosed,
  isoToDisplay,
  movementDisplayRef,
  periodLabel,
} from "@/lib/bank";
import type { MiscPayment } from "@/lib/misc-payments";
import { paymentMethodLabel } from "@/lib/payment-method";

type Props = {
  movement: BankMovement;
  accounts: BankAccount[];
  reconciliations: BankReconciliation[];
  miscPayment?: MiscPayment | null;
  onSave: (movement: BankMovement) => void;
  onOpenMiscPayment?: (miscPaymentRef: string) => void;
  onToast: (message?: string) => void;
  onBack?: () => void;
};

type EditDraft = {
  description: string;
  thirdParty: string;
  amount: string;
  valueDate: string;
  category: BankExpenseCategory;
};

export function BankExpenseFicha({
  movement,
  accounts,
  reconciliations,
  miscPayment = null,
  onSave,
  onOpenMiscPayment,
  onToast,
  onBack,
}: Props) {
  const account = accounts.find((row) => row.ref === movement.accountRef);
  const closed =
    isPeriodClosed(reconciliations, movement.accountRef, movement.period) || movement.reconciled;
  const linkedMisc = Boolean(miscPayment);
  const canEditManual = movement.manual && !closed && !linkedMisc;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => ({
    description: movement.description,
    thirdParty: movement.thirdParty,
    amount: String(bankMovementAmount(movement)),
    valueDate: movement.valueDate,
    category: movement.category ?? "otro",
  }));

  function startEdit() {
    if (linkedMisc && miscPayment && onOpenMiscPayment) {
      onOpenMiscPayment(miscPayment.ref);
      return;
    }
    if (!canEditManual) {
      onToast(closed ? "Periodo conciliado · solo lectura." : "Este gasto se edita desde Pagos varios.");
      return;
    }
    setDraft({
      description: movement.description,
      thirdParty: movement.thirdParty,
      amount: String(bankMovementAmount(movement)),
      valueDate: movement.valueDate,
      category: movement.category ?? "otro",
    });
    setEditing(true);
  }

  function saveEdit() {
    const amount = Number(draft.amount.replace(/\D/g, ""));
    if (amount <= 0 || !draft.description.trim() || !draft.thirdParty.trim()) {
      onToast("Complete descripción, tercero e importe.");
      return;
    }
    onSave({
      ...movement,
      description: draft.description.trim(),
      thirdParty: draft.thirdParty.trim(),
      debit: 0,
      credit: amount,
      valueDate: draft.valueDate,
      opDate: draft.valueDate,
      category: draft.category,
    });
    setEditing(false);
    onToast("Registro bancario actualizado.");
  }

  const displayRef = movementDisplayRef(movement);

  return (
    <section className="panel bank-expense-ficha">
      <div className="head">
        {onBack ? (
          <button type="button" className="btn ghost compact misc-payment-back" onClick={onBack}>
            ← Volver
          </button>
        ) : null}
        <h1>Registro bancario</h1>
        <span className="file-title-ref ref">{displayRef}</span>
        {closed ? <Pill label="Conciliado · solo lectura" kind="ok" /> : null}
        <div className="grow" />
        <button type="button" className="btn primary compact" onClick={startEdit}>
          Modificar
        </button>
      </div>

      <div className="bank-expense-ficha-body">
        {editing ? (
          <form
            className="sheet misc-payment-sheet bank-expense-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveEdit();
            }}
          >
            <div className="sheet-body">
              <div className="sheet-fields">
                <div className="sheet-row">
                  <label className="sheet-label">Etiqueta</label>
                  <input
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, description: event.target.value }))
                    }
                  />
                </div>
                <div className="sheet-row">
                  <label className="sheet-label">Tercero</label>
                  <input
                    value={draft.thirdParty}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, thirdParty: event.target.value }))
                    }
                  />
                </div>
                <div className="sheet-row">
                  <label className="sheet-label">Importe</label>
                  <input
                    inputMode="numeric"
                    value={draft.amount}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, amount: event.target.value }))
                    }
                  />
                </div>
                <div className="sheet-row">
                  <label className="sheet-label">Fecha valor</label>
                  <input
                    type="date"
                    value={draft.valueDate}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, valueDate: event.target.value }))
                    }
                  />
                </div>
                <div className="sheet-row">
                  <label className="sheet-label">Categoría</label>
                  <select
                    value={draft.category}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        category: event.target.value as BankExpenseCategory,
                      }))
                    }
                  >
                    <option value="nomina">Nómina</option>
                    <option value="administracion">Administración</option>
                    <option value="domicilio">Domicilio</option>
                    <option value="servicios">Servicios</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="form-actions misc-payment-actions">
              <button type="button" className="btn secondary" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn primary">
                Guardar cambios
              </button>
            </div>
          </form>
        ) : (
          <QuadDetailTable
            fields={[
              {
                label: "Cuenta",
                value: account ? `${account.name} · ${account.bankName}` : movement.accountRef,
              },
              {
                label: "Enlaces",
                value: linkedMisc && miscPayment ? `Pago varios ${miscPayment.ref}` : "Gasto bancario",
              },
              { label: "Tipo", value: "Transferencia bancaria" },
              { label: "Periodo", value: periodLabel(movement.period) },
              { label: "Fecha operación", value: isoToDisplay(movement.opDate) },
              { label: "Fecha valor", value: isoToDisplay(movement.valueDate) },
              { label: "Etiqueta", value: movement.description },
              { label: "Tercero", value: movement.thirdParty },
              {
                label: "Importe",
                value: `-${formatBankAmount(bankMovementAmount(movement)).replace("$", "$ ")}`,
                money: true,
              },
              {
                label: "Categoría",
                value: movement.category ? expenseCategoryLabel(movement.category) : "—",
              },
            ]}
          />
        )}

        {linkedMisc && miscPayment ? (
          <div className="mini-block misc-payment-bank-link-block">
            <div className="mini-head">
              <h2>Pago varios</h2>
            </div>
            <div className="misc-payment-bank-link-row">
              <span className="misc-payment-bank-ico" aria-hidden>
                <Icon name="cash" />
              </span>
              <button
                type="button"
                className="btn-link bank-extract-ref-link"
                onClick={() => onOpenMiscPayment?.(miscPayment.ref)}
              >
                {miscPayment.ref} · {miscPayment.label}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
