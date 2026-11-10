/**
 * Cabecera de planilla (Inicial · Recaudo · Total día · Caja · Gastos · Préstamos).
 *
 * Fórmula fija — una sola, sin atajos (dueño 10/11):
 *   Caja     = Inicial + efectivo − préstamos − gastos
 *   Total día = Caja − Inicial  (= efectivo − préstamos − gastos)
 *
 * Banco / Nequi no entran a la Caja (van al KPI digital aparte).
 * `cajaSellada` = mismo Saldo de la fórmula (o AJUSTE@ autorizado).
 * Prohibido pasar un CIE distinto a la operación del día.
 */
import { pesos } from "@/lib/finance";

export type PlanillaHeaderCash = {
  inicial: number;
  /** Cobros en efectivo de la planilla (botón Recaudo en N; parte del Recaudo en M/T/A). */
  efectivo: number;
  gastos: number;
  /** Solo desembolsos en efectivo: restan de la Caja. */
  prestamos: number;
  /** Movimiento del día en caja (= efectivo − préstamos − gastos). */
  totalDia: number;
  /** Saldo en mano: pasa como Inicial al otro día. */
  caja: number;
};

export type PlanillaHeaderCashInput = {
  inicial: number;
  efectivo: number;
  gastos: number;
  prestamos: number;
  /**
   * CIE / libro ya sellado. Si viene, manda sobre la suma viva
   * (Historia sagrada: día cerrado no se rehace).
   */
  cajaSellada?: number | null;
};

/** Única cuenta de la cabecera. Prohibido inventar otra en la UI. */
export function planillaHeaderCash(input: PlanillaHeaderCashInput): PlanillaHeaderCash {
  const inicial = pesos(input.inicial);
  const efectivo = pesos(input.efectivo);
  const gastos = pesos(input.gastos);
  const prestamos = pesos(input.prestamos);
  const viva = pesos(inicial + efectivo - prestamos - gastos);
  const sellada =
    input.cajaSellada == null || !Number.isFinite(Number(input.cajaSellada))
      ? null
      : pesos(Number(input.cajaSellada));
  const caja = sellada ?? viva;
  return {
    inicial,
    efectivo,
    gastos,
    prestamos,
    caja,
    totalDia: pesos(caja - inicial),
  };
}
