/**
 * El nombre visible sale del catálogo (cliente, usuario, cobrador).
 * Préstamo, cobro, ruta y planilla solo guardan la proyección.
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  collectorDisplayName,
  syncRouteCollectorNames,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
  type UserRow,
} from "@/lib/mock-data";

export function clientDisplayLabel(client: Pick<ClientRow, "name" | "lastName">) {
  return `${client.name} ${client.lastName ?? ""}`.trim();
}

export type IdentityCatalog = {
  clients: ClientRow[];
  users: UserRow[];
  collectors: CollectorRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  routes: RouteRow[];
  assignments: DailyCollectionAssignment[];
};

/** Reescribe nombres copiados. No toca montos, refs ni la posición de ruta. */
export function refreshLabelsFromCatalog<T extends IdentityCatalog>(state: T): T {
  const clientByRef = new Map(state.clients.map((row) => [row.ref, clientDisplayLabel(row)]));
  const loanClientRef = new Map(state.loans.map((row) => [row.ref, row.clientRef]));

  let loansChanged = false;
  const loans = state.loans.map((row) => {
    const label = clientByRef.get(row.clientRef);
    if (!label || label === row.client) return row;
    loansChanged = true;
    return { ...row, client: label };
  });

  let paymentsChanged = false;
  const payments = state.payments.map((row) => {
    let next = row;
    const clientRef = row.loanRef ? loanClientRef.get(row.loanRef) : undefined;
    const label = clientRef ? clientByRef.get(clientRef) : undefined;
    if (label && label !== next.client) next = { ...next, client: label };
    if (row.collectorRef) {
      const name = collectorDisplayName(row.collectorRef, state.users, state.collectors, next.collector);
      if (name && name !== "—" && name !== next.collector) next = { ...next, collector: name };
    }
    if (next !== row) paymentsChanged = true;
    return next;
  });

  const routes = syncRouteCollectorNames(state.routes, state.users, state.collectors);
  const routesChanged = routes.some((row, index) => row !== state.routes[index]);

  let assignmentsChanged = false;
  const assignments = state.assignments.map((row) => {
    const label = row.clientRef ? clientByRef.get(row.clientRef) : undefined;
    let next = row;
    if (label && label !== next.clientName) next = { ...next, clientName: label };
    if (row.collectorRef) {
      const name = collectorDisplayName(row.collectorRef, state.users, state.collectors, next.collector);
      if (name && name !== "—" && name !== next.collector) next = { ...next, collector: name };
    }
    if (next !== row) assignmentsChanged = true;
    return next;
  });

  if (!loansChanged && !paymentsChanged && !routesChanged && !assignmentsChanged) return state;
  return { ...state, loans, payments, routes, assignments };
}
