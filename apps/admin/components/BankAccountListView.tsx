"use client";

import { PlusIcon } from "@/components/icons";
import { ColumnPicker, ColumnPickerBodyCell, ColumnPickerHeadCell, useColumnVisibility } from "@/components/ColumnPicker";
import { Pill } from "@/components/ui";
import type { BankAccount, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  bankAccountTypeLabel,
  countPendingForAccount,
  formatBankAmount,
  latestOpenPendingPeriod,
  normalizeBankAccount,
} from "@/lib/bank";
import { BANK_ACCOUNT_COLUMNS, BANK_ACCOUNT_DEFAULT_COLS } from "@/lib/table-columns";

type Props = {
  accounts: BankAccount[];
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  onNewAccount: () => void;
  onOpenPending: (accountRef?: string, period?: string) => void;
};

export function BankAccountListView({
  accounts,
  movements,
  reconciliations,
  onNewAccount,
  onOpenPending,
}: Props) {
  const { isVisible, visibleCols, toggleColumn } = useColumnVisibility(
    BANK_ACCOUNT_COLUMNS,
    BANK_ACCOUNT_DEFAULT_COLS,
    { storageKey: "nexo.banco.listado.columns" },
  );

  const rows = accounts.map(normalizeBankAccount);
  const totalBalance = rows.reduce((sum, row) => sum + row.openingBalance, 0);
  const showTotal = rows.length > 1;
  const colsBeforeBalance = ["ref", "name", "type", "bank", "number", "pending"].filter((id) =>
    isVisible(id),
  ).length;
  const colsAfterBalance = ["status"].filter((id) => isVisible(id)).length;

  return (
    <section className="panel">
      <div className="head">
        <h1>Cuentas bancarias</h1>
        <span className="count">{rows.length}</span>
        <div className="grow" />
        <label className="page-size">
          Ver{" "}
          <select defaultValue="25">
            <option>25</option>
            <option>50</option>
          </select>
        </label>
        <button className="plus" title="Nueva cuenta" type="button" onClick={onNewAccount}>
          <PlusIcon />
        </button>
      </div>

      <div className="table-wrap">
        <table className="data list-grid bank-accounts-table">
          <thead>
            <tr className="col-titles">
              {isVisible("ref") ? <th>Ref.</th> : null}
              {isVisible("name") ? <th>Etiqueta</th> : null}
              {isVisible("type") ? <th>Tipo</th> : null}
              {isVisible("bank") ? <th>Banco</th> : null}
              {isVisible("number") ? <th>Número</th> : null}
              {isVisible("pending") ? <th className="center">Registro a conciliar</th> : null}
              {isVisible("balance") ? <th className="right">Saldo</th> : null}
              {isVisible("status") ? <th>Estado</th> : null}
              <ColumnPickerHeadCell>
                <ColumnPicker
                  columns={BANK_ACCOUNT_COLUMNS}
                  visibleCols={visibleCols}
                  onToggle={toggleColumn}
                />
              </ColumnPickerHeadCell>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={visibleCols.length + 1}>
                  No hay cuentas registradas.{" "}
                  <button type="button" className="btn-link" onClick={onNewAccount}>
                    Crear nueva cuenta
                  </button>
                </td>
              </tr>
            ) : (
              rows.map((account) => {
                const pending = countPendingForAccount(movements, reconciliations, account.ref);
                const openPeriod = latestOpenPendingPeriod(
                  movements,
                  reconciliations,
                  account.ref,
                );

                return (
                  <tr key={account.ref}>
                    {isVisible("ref") ? <td className="ref">{account.ref}</td> : null}
                    {isVisible("name") ? <td>{account.name}</td> : null}
                    {isVisible("type") ? <td>{bankAccountTypeLabel(account.accountType)}</td> : null}
                    {isVisible("bank") ? <td>{account.bankName}</td> : null}
                    {isVisible("number") ? <td>{account.accountNumber}</td> : null}
                    {isVisible("pending") ? (
                      <td className="center">
                        {pending > 0 ? (
                          <button
                            type="button"
                            className="bank-list-pending-count"
                            title="Ver registros pendientes de conciliar"
                            onClick={() => onOpenPending(account.ref, openPeriod)}
                          >
                            {pending}
                          </button>
                        ) : (
                          <span className="bank-list-pending-count bank-list-pending-count-static">
                            0
                          </span>
                        )}
                      </td>
                    ) : null}
                    {isVisible("balance") ? (
                      <td className="money right">{formatBankAmount(account.openingBalance)}</td>
                    ) : null}
                    {isVisible("status") ? (
                      <td>
                        <Pill
                          label={account.active ? "Abierto" : "Cerrado"}
                          kind={account.active ? "ok" : "draft"}
                        />
                      </td>
                    ) : null}
                    <ColumnPickerBodyCell />
                  </tr>
                );
              })
            )}
          </tbody>
          {showTotal && isVisible("balance") ? (
            <tfoot>
              <tr className="bank-accounts-total-row">
                <td colSpan={Math.max(colsBeforeBalance, 1)}>Total</td>
                <td className="money right">{formatBankAmount(totalBalance)}</td>
                {colsAfterBalance > 0 ? <td colSpan={colsAfterBalance + 1} /> : <ColumnPickerBodyCell />}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
