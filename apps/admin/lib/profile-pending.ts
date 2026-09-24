import type { ClientRow, LoanRow } from "@/lib/mock-data";
import { activeLoans } from "@/lib/mock-data";

/** Documento placeholder de alta en calle (no es cédula real). */
export function isStreetPlaceholderDocument(document: string | undefined) {
  return Boolean(document?.trim().toUpperCase().startsWith("S/"));
}

/**
 * Alerta «Completar» del listado / Inicio / Alertas: retirada.
 * Faltar teléfono o barrio es normal en calle; no pinta el renglón ni cuenta
 * pendientes. No bloquea ruta, cobro ni préstamo. La ficha se sigue editando
 * en oficina cuando haga falta.
 */
export function clientNeedsProfileCompletion(_client: ClientRow) {
  return false;
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
