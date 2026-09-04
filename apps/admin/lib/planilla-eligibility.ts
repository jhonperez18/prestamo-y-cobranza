import { isOperationalClient, isPendingReview } from "@/lib/client-review";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, LoanRow } from "@/lib/mock-data";

/** Solo clientes activos con cobro real pueden estar en planilla / app cobrador. */
export function isValidPlanillaAssignment(
  row: DailyCollectionAssignment,
  clients: ClientRow[],
  loans: LoanRow[],
) {
  if (!row.loanRef || row.itemId.includes(":ruta")) return false;
  const client = clients.find((entry) => entry.ref === row.clientRef);
  if (!client || isPendingReview(client) || !isOperationalClient(client)) return false;
  const loan = loans.find((entry) => entry.ref === row.loanRef);
  if (!loan || loan.clientRef !== client.ref) return false;
  return true;
}

/** Quita de la planilla a no-clientes, revisión y visitas inventadas. */
export function purgeInvalidPlanillaAssignments(
  assignments: DailyCollectionAssignment[],
  clients: ClientRow[],
  loans: LoanRow[],
) {
  return assignments.filter((row) => isValidPlanillaAssignment(row, clients, loans));
}
