"use client";

import { useMemo } from "react";
import { Pill } from "@/components/ui";
import { clientsOnRouteSorted } from "@/lib/client-route-order";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { todayIso } from "@/lib/daily-dispatch";
import { canRenewLoan } from "@/lib/loan-renew";
import { syncLoan } from "@/lib/loan-preview";
import { computeLoanCuotasProgress, type CuotasProgress } from "@/lib/loan-cuotas-progress";
import { CuotasProgressCell } from "@/components/CuotasProgressCell";
import { planillaCuotaPactada } from "@/lib/planilla-display";
import {
  paymentMethodInitial,
  paymentMethodKind,
  paymentMethodLabel,
} from "@/lib/payment-method";
import { planillaDayBlockedReason } from "@/lib/route-planilla";
import { planillaAssignmentsForRoute } from "@/lib/planilla-day-sync";
import { primaryLoanForClient } from "@/lib/route-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  activeLoans,
  loansForClient,
  money,
  type ClientRow,
  type LoanRow,
  type PaymentRow,
  type StatusKind,
} from "@/lib/mock-data";

type Props = {
  routeName: string;
  clients: ClientRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  /** Planilla enviada a la app (misma fuente que el cobrador). */
  assignments?: DailyCollectionAssignment[];
  collectorRef?: string;
  collectorName?: string;
  planillaDate?: string;
  embedded?: boolean;
  onBack?: () => void;
  onOpenClient?: (ref: string) => void;
  onOpenLoan?: (loanRef: string) => void;
  onRenewLoan?: (loanRef: string) => void;
};

type RouteClientRow = {
  client: ClientRow;
  balance: number;
  cuotaHoy: number;
  loan: LoanRow | null;
  renewLoan: LoanRow | null;
  paidToday: boolean;
  cobradoHoy: number;
  paidTime: string;
  paidMethod: string;
  paidMethodKind: StatusKind;
  paidMethodTitle: string;
  cuotas: CuotasProgress;
  visitStatus: string;
  order: number | string;
  rowKey: string;
};

function paymentSortKey(row: PaymentRow) {
  const date = row.paidDate || "";
  const time = row.paidTime || "00:00";
  return `${date}T${time}|${row.when || ""}|${row.ref}`;
}

function paymentsTodayForClient(
  clientRef: string,
  loans: LoanRow[],
  payments: PaymentRow[],
  today: string,
) {
  const loanRefs = new Set(loansForClient(clientRef, loans).map((row) => row.ref));
  return payments.filter(
    (row) => row.loanRef && loanRefs.has(row.loanRef) && row.paidDate === today,
  );
}

function rowFromAssignment(
  assignment: DailyCollectionAssignment,
  clients: ClientRow[],
  loans: LoanRow[],
  payments: PaymentRow[],
  today: string,
  order: number,
): RouteClientRow {
  const client =
    clients.find((row) => row.ref === assignment.clientRef) ??
    ({
      ref: assignment.clientRef,
      name: assignment.clientName,
      lastName: "",
      nickname: "",
      routeOrder: order,
    } as ClientRow);

  const active = activeLoans(loansForClient(client.ref, loans));
  let balance = 0;
  let renewLoan: LoanRow | null = null;
  for (const loan of active) {
    const synced = syncLoan(loan, payments) as LoanRow;
    const financials = computeLoanFinancials(synced, payments);
    balance += financials.balancePending;
    if (!renewLoan && canRenewLoan(synced)) renewLoan = synced;
  }

  const primary =
    (assignment.loanRef
      ? (loans.find((row) => row.ref === assignment.loanRef) ?? null)
      : primaryLoanForClient(client.ref, loans)) ?? null;
  const loan = primary ? (syncLoan(primary, payments) as LoanRow) : null;
  const todayPays = paymentsTodayForClient(client.ref, loans, payments, today);
  const cobradoHoy = todayPays.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const lastToday =
    todayPays.length > 0
      ? [...todayPays].sort((a, b) => paymentSortKey(b).localeCompare(paymentSortKey(a)))[0]
      : null;
  const cuotas = computeLoanCuotasProgress(loan, payments, today);
  const paidToday =
    cobradoHoy > 0 ||
    assignment.visitStatus === "cobrado" ||
    assignment.visitStatus === "parcial";

  return {
    client: {
      ...client,
      routeOrder: client.routeOrder || order,
    },
    balance,
    cuotaHoy: loan ? planillaCuotaPactada(loan) : 0,
    loan,
    renewLoan,
    paidToday,
    cobradoHoy: cobradoHoy || (paidToday ? assignment.amountDue : 0),
    paidTime: lastToday?.paidTime?.trim() || "",
    paidMethod: lastToday ? paymentMethodInitial(lastToday.method) : "",
    paidMethodKind: paymentMethodKind(lastToday?.method),
    paidMethodTitle: lastToday ? paymentMethodLabel(lastToday.method) : "",
    cuotas,
    visitStatus: assignment.visitStatus || "pendiente",
    order: client.routeOrder || order,
    rowKey: assignment.itemId || `${assignment.clientRef}:${assignment.loanRef}:${order}`,
  };
}

/** Plantilla = espejo de lo enviado a la app del cobrador. */
export function RouteClientsView({
  routeName,
  clients,
  loans,
  payments,
  assignments = [],
  collectorRef,
  collectorName,
  planillaDate,
  embedded = false,
  onBack,
  onOpenClient,
  onOpenLoan,
  onRenewLoan,
}: Props) {
  const today = planillaDate || todayIso();
  const blocked = planillaDayBlockedReason(today);

  const planilla = useMemo(
    () => planillaAssignmentsForRoute(assignments, routeName, collectorRef, today),
    [assignments, routeName, collectorRef, today],
  );

  const rows = useMemo(() => {
    if (!collectorRef || blocked) return [];
    if (planilla.length) {
      const orderedClients = clientsOnRouteSorted(clients, routeName);
      const orderOf = (clientRef: string) => {
        const idx = orderedClients.findIndex((row) => row.ref === clientRef);
        return idx >= 0 ? orderedClients[idx]!.routeOrder || idx + 1 : 999;
      };
      return [...planilla]
        .sort((a, b) => orderOf(a.clientRef) - orderOf(b.clientRef))
        .map((assignment, index) =>
          rowFromAssignment(
            assignment,
            clients,
            loans,
            payments,
            today,
            orderOf(assignment.clientRef) || index + 1,
          ),
        );
    }
    return [];
  }, [planilla, blocked, collectorRef, clients, loans, payments, routeName, today]);

  const lead = blocked
    ? blocked
    : !collectorRef
      ? "Esta ruta no tiene cobrador asignado: no se envía planilla a la app."
      : rows.length === 0
        ? "Aún no hay planilla de hoy para esta ruta. Se genera sola Lun–sáb a medianoche (o al abrir el sistema)."
        : null;

  return (
    <section className={embedded ? "panel home-route-plantilla-panel" : "panel"}>
      <div className={embedded ? "head home-route-plantilla-head" : "head"}>
        <h1>{embedded ? "Planilla" : `Ruta ${routeName}`}</h1>
        {embedded ? <span className="home-route-plantilla-route">Ruta {routeName}</span> : null}
        <span className="count">{rows.length}</span>
        <div className="grow" />
        {!embedded && onBack ? (
          <button type="button" className="btn ghost compact" onClick={onBack}>
            Volver
          </button>
        ) : null}
      </div>

      {lead && !embedded ? <p className="panel-lead route-clients-lead">{lead}</p> : null}

      <div className="table-wrap route-clients-table-wrap">
        <table className="data list-grid route-clients-table">
          <colgroup>
            <col className="rc-col-order" />
            <col className="rc-col-name" />
            <col className="rc-col-nick" />
            <col className="rc-col-saldo" />
            <col className="rc-col-cuota" />
            <col className="rc-col-cobrado" />
            <col className="rc-col-method" />
            <col className="rc-col-hora" />
            <col className="rc-col-cuotas" />
            <col className="rc-col-accion" />
          </colgroup>
          <thead>
            <tr className="col-titles">
              <th>#</th>
              <th>Nombre</th>
              <th>Apodo</th>
              <th>Saldo</th>
              <th title="Cuota pactada del préstamo (fija)">Cuota</th>
              <th title="Se actualiza cuando el cobrador registra el pago">Cobrado</th>
              <th title="Efectivo / Nequi / Banco">Método</th>
              <th title="Hora del cobro en la app">Hora</th>
              <th title="Cuotas pagadas / esperadas a hoy (calendario lun–sáb sin festivos)">
                Mora
              </th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody key={routeName}>
            {rows.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={10}>
                  {blocked
                    ? blocked
                    : !collectorRef
                      ? "Asigne un cobrador a la ruta para generar la planilla."
                      : "Sin visitas en la planilla de hoy."}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const canRenew = Boolean(onRenewLoan && row.renewLoan);
                const openLoan = onOpenLoan && row.loan ? () => onOpenLoan(row.loan!.ref) : undefined;
                const openClient = onOpenClient
                  ? () => onOpenClient(row.client.ref)
                  : undefined;
                return (
                  <tr key={row.rowKey}>
                    <td
                      className={`ref${openClient ? " clickable" : ""}`}
                      onClick={openClient}
                      style={openClient ? { cursor: "pointer" } : undefined}
                    >
                      {row.order || "—"}
                    </td>
                    <td
                      className={openClient || openLoan ? "clickable" : undefined}
                      onClick={openLoan ?? openClient}
                      style={openLoan || openClient ? { cursor: "pointer" } : undefined}
                      title={row.loan ? `Préstamo ${row.loan.ref}` : undefined}
                    >
                      {[row.client.name, row.client.lastName].filter(Boolean).join(" ").trim() ||
                        "—"}
                    </td>
                    <td>{row.client.nickname?.trim() || "—"}</td>
                    <td className="money">{row.balance > 0 ? money(row.balance) : "—"}</td>
                    <td className="money">{row.cuotaHoy > 0 ? money(row.cuotaHoy) : "—"}</td>
                    <td>
                      {row.paidToday ? (
                        <span className="money">{money(row.cobradoHoy)}</span>
                      ) : (
                        <span className="route-clients-muted">Pend.</span>
                      )}
                    </td>
                    <td className="route-clients-method-cell">
                      {row.paidToday && row.paidMethod ? (
                        <Pill
                          label={row.paidMethod}
                          kind={row.paidMethodKind}
                          title={row.paidMethodTitle || undefined}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="route-clients-hora">
                      {row.paidToday && row.paidTime ? row.paidTime : "—"}
                    </td>
                    <td className="route-clients-cuotas">
                      <CuotasProgressCell progress={row.cuotas} />
                    </td>
                    <td className="route-clients-actions">
                      {onRenewLoan ? (
                        <button
                          type="button"
                          className="collector-mobile-pay-link"
                          disabled={!canRenew}
                          title={
                            canRenew
                              ? "Genera préstamo nuevo: saldo + 20% a 1 mes"
                              : "Disponible cuando se cumpla el plazo"
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            if (row.renewLoan) onRenewLoan(row.renewLoan.ref);
                          }}
                        >
                          renovar
                        </button>
                      ) : (
                        "—"
                      )}
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
