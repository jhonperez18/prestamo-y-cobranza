/**
 * Cabecera de planilla — Saldo de Caja (dueño 10/11).
 *
 * Ley estricta (una sola, sin copias):
 *   Caja = Inicial + efectivo − préstamos − gastos
 *
 * - Solo efectivo de caja. Banco / Nequi no entran (van a BANCO / NEQUI).
 * - Nadie pisa el resultado (ni CIE distinto). El CIE al sellar = esta Caja.
 * - Única excepción: `ajusteContado` (AJUSTE autorizado / caja contada).
 */
import { pesos } from "@/lib/finance";

export type PlanillaHeaderCash = {
  inicial: number;
  /** Cobros en efectivo de la planilla. */
  efectivo: number;
  gastos: number;
  /** Solo desembolsos en efectivo: restan de la Caja. */
  prestamos: number;
  /** Movimiento del día en caja (= efectivo − préstamos − gastos). */
  totalDia: number;
  /** Saldo en mano: pasa como Inicial al eslabón siguiente. */
  caja: number;
};

export type PlanillaHeaderCashInput = {
  inicial: number;
  efectivo: number;
  gastos: number;
  prestamos: number;
  /**
   * @deprecated No pisa la fórmula. Se ignora si discrepa.
   * Usar `ajusteContado` solo para AJUSTE autorizado.
   */
  cajaSellada?: number | null;
  /** Única excepción: caja contada (AJUSTE T / A / N autorizado). */
  ajusteContado?: number | null;
};

/** Única cuenta de Caja. Prohibido inventar otra en la UI. */
export function cajaFormulaSaldo(
  inicial: number,
  efectivo: number,
  prestamos: number,
  gastos: number,
): number {
  return pesos(pesos(inicial) + pesos(efectivo) - pesos(prestamos) - pesos(gastos));
}

/** Única cuenta de la cabecera. */
export function planillaHeaderCash(input: PlanillaHeaderCashInput): PlanillaHeaderCash {
  const inicial = pesos(input.inicial);
  const efectivo = pesos(input.efectivo);
  const gastos = pesos(input.gastos);
  const prestamos = pesos(input.prestamos);
  const viva = cajaFormulaSaldo(inicial, efectivo, prestamos, gastos);
  const ajuste =
    input.ajusteContado == null || !Number.isFinite(Number(input.ajusteContado))
      ? null
      : pesos(Number(input.ajusteContado));
  const caja = ajuste ?? viva;
  return {
    inicial,
    efectivo,
    gastos,
    prestamos,
    caja,
    totalDia: pesos(caja - inicial),
  };
}
