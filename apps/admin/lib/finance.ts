/**
 * Pesos enteros. Saldos, intereses y caja se suman y restan en enteros.
 * Un recaudo válido no se parte en fracción.
 */

export function pesos(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

export function add(a: number, b: number): number {
  return pesos(a) + pesos(b);
}

export function sub(a: number, b: number): number {
  return pesos(a) - pesos(b);
}

export function sumPesos(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += pesos(value);
  return total;
}

/** saldo_pendiente = monto_total − suma de recaudos válidos. Nunca negativo. */
export function pendingBalance(total: number, collected: number): number {
  return Math.max(0, sub(total, collected));
}

/** Interés en pesos: trunc((capital × %) / 100). */
export function interestFromPct(capital: number, pct: number): number {
  const base = pesos(capital);
  if (base <= 0 || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.trunc((base * pct) / 100);
}

export type CashCloseCheck = {
  opening: number;
  /** Recaudo en efectivo del día. Nequi no entra a la caja del cobrador. */
  collections: number;
  expenses: number;
  /** saldo inicial + efectivo del día − gastos. */
  expected: number;
  declared: number;
  /** declarado − esperado. Positivo = sobra; negativo = falta. */
  variance: number;
  balanced: boolean;
};

/**
 * Efectivo en caja = saldo inicial + recaudos en efectivo del día − gastos del día.
 * Devuelve la diferencia. No modifica pagos, gastos ni el cierre que ya estaba guardado.
 */
export function verifyCashClose(input: {
  opening: number;
  collections: number;
  expenses: number;
  declared: number;
}): CashCloseCheck {
  const opening = pesos(input.opening);
  const collections = pesos(input.collections);
  const expenses = pesos(input.expenses);
  const declared = pesos(input.declared);
  const expected = sub(add(opening, collections), expenses);
  const variance = sub(declared, expected);
  return {
    opening,
    collections,
    expenses,
    expected,
    declared,
    variance,
    balanced: variance === 0,
  };
}

/** Clave única del envío. Un reintento de la misma cola no crea otro cobro. */
export function newIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
