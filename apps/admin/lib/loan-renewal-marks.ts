/**
 * Renovación = la deuda que quedó sin pagar sigue en un P- de continuación.
 * Las notas lo dicen (la nube no tiene columna aparte):
 * - el vencido: «Cerrado por renovación → P-455»
 * - el de continuación: «Renovación de P-10 · …»
 */
const RENEWED_INTO = /Cerrado por renovaci[oó]n\s*→\s*(\S+)/i;
const RENEWAL_OF = /^Renovaci[oó]n de (\S+)/im;

/** P- de continuación si este préstamo se cerró por renovación (su deuda siguió allá). */
export function loanRenewedInto(loan: { notes?: string | null }): string | null {
  const match = RENEWED_INTO.exec(String(loan.notes || ""));
  return match ? match[1] : null;
}

/** P- renovado si este préstamo es la continuación de una renovación. */
export function loanRenewalOf(loan: { notes?: string | null }): string | null {
  const match = RENEWAL_OF.exec(String(loan.notes || ""));
  return match ? match[1] : null;
}
