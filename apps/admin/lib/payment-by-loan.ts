/**
 * Un cobro se busca por su préstamo.
 * Recorrer la lista entera por cada ficha (al abrir Inicio, Préstamos o Cartera)
 * dejaba la pantalla en blanco y el clic de una pestaña en segundos.
 */
type LoanTouch = { loanRef?: string };

let indexedSource: readonly LoanTouch[] | null = null;
let byLoan: Map<string, LoanTouch[]> | null = null;

/** La lista devuelta es interna: no mutarla. Otra lista de cobros rearma el índice. */
export function paymentsForLoan<T extends LoanTouch>(
  payments: readonly T[],
  loanRef: string,
): T[] {
  const ref = loanRef.trim();
  if (!ref || payments.length === 0) return [];
  if (indexedSource !== payments) {
    const next = new Map<string, LoanTouch[]>();
    for (const row of payments) {
      const key = row.loanRef?.trim();
      if (!key) continue;
      const list = next.get(key);
      if (list) list.push(row);
      else next.set(key, [row]);
    }
    indexedSource = payments;
    byLoan = next;
  }
  return (byLoan!.get(ref) as T[] | undefined) ?? [];
}
