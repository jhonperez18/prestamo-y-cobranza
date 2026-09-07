import { isOperationalClient } from "@/lib/client-review";
import type { ClientRow, LoanRow } from "@/lib/mock-data";
import { activeLoans } from "@/lib/mock-data";

/** Documento placeholder de alta en calle (no es cédula real). */
export function isStreetPlaceholderDocument(document: string | undefined) {
  return Boolean(document?.trim().toUpperCase().startsWith("S/"));
}

/**
 * Cliente operativo con ficha incompleta (calle u omitidos).
 * No bloquea ruta, cobro ni préstamo.
 */
export function clientNeedsProfileCompletion(client: ClientRow) {
  if (!isOperationalClient(client)) return false;
  if (client.profilePending) return true;
  const missingDoc = !client.document?.trim() || isStreetPlaceholderDocument(client.document);
  const missingContact = !client.phone?.trim() && !client.address?.trim();
  const missingPlace = !client.city?.trim() && !client.barrio?.trim();
  return missingDoc && (missingContact || missingPlace);
}

export function clientsNeedingProfileCompletion(clients: ClientRow[]) {
  return clients.filter(clientNeedsProfileCompletion);
}

/** Préstamo activo creado en calle / rápido, pendiente de revisión en oficina. */
export function loanNeedsOfficeReview(loan: LoanRow) {
  if (loan.balance <= 0) return false;
  if (loan.status === "Anulado" || loan.status === "Cancelado") return false;
  return Boolean(loan.termsPending);
}

export function loansNeedingOfficeReview(loans: LoanRow[]) {
  return activeLoans(loans).filter(loanNeedsOfficeReview);
}
