import { isAssignmentAwaitingLoan } from "@/lib/planilla-display";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, LoanRow } from "@/lib/mock-data";
import { isOperationalClient, isPendingReview } from "@/lib/client-review";

/** Solo clientes operativos de la ruta en planilla / app cobrador. */
export function isValidPlanillaAssignment(
  row: DailyCollectionAssignment,
  clients: ClientRow[],
  loans: LoanRow[],
) {
  const client = clients.find((entry) => entry.ref === row.clientRef);
  if (!client || isPendingReview(client) || !isOperationalClient(client)) return false;

  // Visitas inventadas de ruta (no cliente).
  if (row.itemId.includes(":ruta")) return false;

  // Sin préstamo cobrable: visita Prestar (alta / liquidado) — válida en planilla diaria.
  if (isAssignmentAwaitingLoan(row)) {
    return true;
  }

  const loan = loans.find((entry) => entry.ref === row.loanRef);
  if (!loan || loan.clientRef !== client.ref) return false;
  // Nunca purgar planilla operativa por regla de 1.ª cuota.
  // Esa regla solo aplica al armar cobros nuevos (accumulatedDueForLoan).
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
