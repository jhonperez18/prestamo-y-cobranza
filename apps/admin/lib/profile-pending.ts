import type { ClientRow } from "@/lib/mock-data";

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