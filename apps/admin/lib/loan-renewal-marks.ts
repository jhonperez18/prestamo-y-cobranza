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

/**
 * Historial, no ruta. Renovado (el viejo) o pagado por completo.
 * El de continuación, con saldo, sigue siendo el préstamo de ahora.
 */
export function loanIsClosedHistory(loan: {
  status?: string | null;
  balance?: number | null;
  paid?: number | null;
  total?: number | null;
  notes?: string | null;
}): boolean {
  if (loanRenewedInto(loan)) return true;
  const status = String(loan.status ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (status === "finalizado") return true;
  const balance = Number(loan.balance);
  const paid = Number(loan.paid);
  const total = Number(loan.total);
  const safeBalance = Number.isFinite(balance) ? balance : 0;
  const safePaid = Number.isFinite(paid) ? paid : 0;
  const safeTotal = Number.isFinite(total) ? total : 0;
  if ((status === "eliminado" || status === "cancelado") && safeBalance <= 0) return true;
  return safeBalance <= 0 && safeTotal > 0 && safePaid >= safeTotal;
}
