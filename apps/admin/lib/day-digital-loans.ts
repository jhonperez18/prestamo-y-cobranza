/**
 * Préstamos del día desembolsados por Banco / Nequi (los monta el supervisor, que maneja
 * esos saldos). Para el cobrador son solo reporte: no restan de su caja. Salen del
 * acumulado digital de la ruta del cliente (`digitalPoolBalances`): A → Nequi; M / T / N → Banco.
 */
import { sameRoute } from "@/lib/client-route-order";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";
import { isLoanVoided, type ClientRow, type LoanRow } from "@/lib/mock-data";
import {
  isCashlessRenewal,
  loanBankOutflowCapital,
  loanDisbursementIsoDate,
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
  /** Renovación (sin plata): se muestra «Renovado», no «Préstamo». */
  renewal: boolean;
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
    const renewal = isCashlessRenewal(loan);
    if (isLoanVoided(loan) || (loanIsExistingPortfolio(loan) && !renewal)) continue;
    if (loanDisbursementIsoDate(loan) !== dateIso) continue;
    if (!loan.clientRef || paidClientRefs.has(loan.clientRef)) continue;
    if (!((Number(loan.capital) || 0) > 0)) continue;
    const client = clientByRef.get(loan.clientRef);
    if (!client || !sameRoute(client.route, route)) continue;
    rows.push({
      loan,
      clientName: `${client.name} ${client.lastName}`.trim() || (loan.client || "").trim() || loan.ref,
      source: loanDisbursementSource(loan),
      renewal,
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
    if (loanDisbursementIsoDate(loan) !== dateIso) continue;
    const capital = loanBankOutflowCapital(loan);
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
  const keep = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.clientRef}|${row.capital}`;
    const current = keep.get(key);
    const rowN = /^P-(\d+)/i.exec(row.loanRef);
    const curN = current ? /^P-(\d+)/i.exec(current.loanRef) : null;
    const rowNum = rowN ? Number(rowN[1]) : Number.POSITIVE_INFINITY;
    const curNum = curN ? Number(curN[1]) : Number.POSITIVE_INFINITY;
    if (!current || rowNum < curNum) keep.set(key, row);
  }
  return [...keep.values()].sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}
