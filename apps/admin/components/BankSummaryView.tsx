"use client";

import type { BankAccount, BankMovement, BankReconciliation } from "@/lib/bank";
import {
  countPendingReconciliation,
  currentPeriod,
  isPeriodClosed,
  movementsForAccountPeriod,
  periodLabel,
} from "@/lib/bank";

type Props = {
  accounts: BankAccount[];
  movements: BankMovement[];
  reconciliations: BankReconciliation[];
  period: string;
  onPeriodChange: (period: string) => void;
  onOpenExtract: (accountRef: string) => void;
};

export function BankSummaryView({
  accounts,
  movements,
  reconciliations,
  period,
  onPeriodChange,
  onOpenExtract,
}: Props) {
  const activeAccounts = accounts.filter((row) => row.active);
  const pendingCount = countPendingReconciliation(movements, reconciliations, accounts, period);
  const periodOpen = activeAccounts.some(
    (account) => !isPeriodClosed(reconciliations, account.ref, period),
  );

  const openPendingExtract = () => {
    const target = activeAccounts.find(
      (account) =>
        !isPeriodClosed(reconciliations, account.ref, period) &&
        movementsForAccountPeriod(movements, account.ref, period).length > 0,
    );
    if (target) {
      onOpenExtract(target.ref);
      return;
    }
    const fallback = activeAccounts.find(
      (account) => !isPeriodClosed(reconciliations, account.ref, period),
    );
    if (fallback) {
      onOpenExtract(fallback.ref);
    }
  };

  return (
    <div className="bank-panel bank-summary-panel">
      <header className="bank-header">
        <h2 className="bank-section-title">Registros bancarios</h2>
        <p className="bank-header-hint">
          Periodo {periodLabel(period)}. Pulse el número de registros para ver el detalle y conciliar.
        </p>
        <div className="bank-header-controls">
          <input
            className="bank-period-input"
            type="month"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value || currentPeriod())}
          />
        </div>
      </header>

      <div className="bank-summary-list">
        <section className="bank-summary-card">
          <div className="bank-summary-head bank-summary-head-pending">Registros a conciliar</div>
          <div className="bank-summary-body bank-summary-body-pending">
            {periodOpen && pendingCount > 0 ? (
              <button
                type="button"
                className="bank-summary-count"
                onClick={openPendingExtract}
                title="Ver registros pendientes de conciliar"
              >
                {pendingCount}
              </button>
            ) : (
              <span className="bank-summary-count bank-summary-count-static">{pendingCount}</span>
            )}
          </div>
        </section>

        {activeAccounts.map((account) => {
          const count = movementsForAccountPeriod(movements, account.ref, period).length;
          const closed = isPeriodClosed(reconciliations, account.ref, period);
          return (
            <section key={account.ref} className="bank-summary-card">
              <div className="bank-summary-head bank-summary-head-account">
                {account.name}
                <span className="bank-summary-sub">{account.bankName}</span>
              </div>
              <div className={`bank-summary-body ${closed ? "bank-summary-body-closed" : ""}`}>
                {count > 0 ? (
                  <button
                    type="button"
                    className="bank-summary-count"
                    onClick={() => onOpenExtract(account.ref)}
                    title={`Ver ${count} movimiento(s)`}
                  >
                    {count}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="bank-summary-count bank-summary-count-empty"
                    onClick={() => onOpenExtract(account.ref)}
                    title="Abrir extracto de la cuenta"
                  >
                    0
                  </button>
                )}
                {closed ? <span className="bank-summary-closed">Conciliado</span> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
