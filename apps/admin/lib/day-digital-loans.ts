/**
 * Préstamos del día desembolsados por Banco / Nequi (los monta el supervisor, que maneja
 * esos saldos). Para el cobrador son solo reporte: no restan de su caja. Salen del
 * acumulado digital de la ruta del cliente (`digitalPoolBalances`): A → Nequi; M / T / N → Banco.
 */
import { sameRoute } from "@/lib/client-route-order";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";
import { displayToIso } from "@/lib/loan-preview";
import { isLoanVoided, type ClientRow, type LoanRow } from "@/lib/mock-data";
import {
  loanDisbursementSource,
  loanFundedByBanco,
  loanFundedByNequi,
  loanIsExistingPortfolio,
  type LoanDisbursementSource,
} from "@/lib/nequi-pool";
import { paymentMethodForRoute } from "@/lib/payment-method";

export type DigitalLoanPool = "banco" | "nequi";

/** Bolsillo digital de la planilla: A → Nequi; el resto → Banco. */
export function digitalLoanPoolForRoute(route: string): DigitalLoanPool {
  return paymentMethodForRoute("nequi", route) === "banco" ? "banco" : "nequi";
}

export function digitalLoanPoolLabel(pool: DigitalLoanPool): string {
  return pool === "banco" ? "Banco" : "Nequi";
}

export type DayPlanillaLoan = {
  loan: LoanRow;
  clientName: string;
  source: LoanDisbursementSource | null;
};

/**
 * Préstamos de ese día (cualquier origen) a clientes de la planilla `route` que no
 * pagaron ese día: así quedan en la lista de recaudo / historial aunque no haya PG-.
 */
export function dayPlanillaLoansWithoutPayment(
  dateIso: string,
  route: string,
  loans: LoanRow[],
  clients: ClientRow[],
  paidClientRefs: ReadonlySet<string>,
): DayPlanillaLoan[] {
  if (!route.trim()) return [];
  const clientByRef = new Map(clients.map((row) => [row.ref, row]));
  const rows: DayPlanillaLoan[] = [];
  for (const loan of loans) {
    if (isLoanVoided(loan) || loanIsExistingPortfolio(loan)) continue;
    if (displayToIso(String(loan.date || "").trim()) !== dateIso) continue;
    if (!loan.clientRef || paidClientRefs.has(loan.clientRef)) continue;
    if (!((Number(loan.capital) || 0) > 0)) continue;
    const client = clientByRef.get(loan.clientRef);
    if (!client || !sameRoute(client.route, route)) continue;
    rows.push({
      loan,
      clientName: `${client.name} ${client.lastName}`.trim() || (loan.client || "").trim() || loan.ref,
      source: loanDisbursementSource(loan),
    });
  }
  return rows.sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}

/** Préstamos Banco / Nequi de ese día a clientes de la planilla `route`. */
export function dayDigitalLoanRows(
  dateIso: string,
  route: string,
  loans: LoanRow[],
  clients: ClientRow[],
): DayLoanDisbursementRow[] {
  if (!route.trim()) return [];
  const clientByRef = new Map(clients.map((row) => [row.ref, row]));
  const rows: DayLoanDisbursementRow[] = [];
  for (const loan of loans) {
    if (!loanFundedByBanco(loan) && !loanFundedByNequi(loan)) continue;
    if (isLoanVoided(loan)) continue;
    if (displayToIso(String(loan.date || "").trim()) !== dateIso) continue;
    const capital = Math.trunc(Number(loan.capital) || 0);
    if (capital <= 0) continue;
    const client = clientByRef.get(loan.clientRef);
    if (!client || !sameRoute(client.route, route)) continue;
    rows.push({
      loanRef: loan.ref,
      clientRef: loan.clientRef,
      clientName: `${client.name} ${client.lastName}`.trim() || (loan.client || "").trim() || loan.ref,
      capital,
      installment: Math.trunc(Number(loan.installment) || 0),
    });
  }
  return rows.sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}
