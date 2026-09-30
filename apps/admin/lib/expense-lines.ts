import { sameRoute } from "@/lib/client-route-order";
import type { RouteExpenseLine } from "@/lib/collector-day-close";

/** Desembolso de crédito: nunca es «gasto operativo». */
export function isPrestamoRutaExpense(line: Pick<RouteExpenseLine, "category" | "id">) {
  return line.category === "prestamo_ruta" || line.id === "prestamo";
}

/** Solo almuerzo/gasolina/otros… Sin préstamos (van al botón Préstamo / KPI). */
export function operativeExpenseLines<T extends Pick<RouteExpenseLine, "category" | "id">>(
  lines: T[],
): T[] {
  return lines.filter((line) => !isPrestamoRutaExpense(line));
}

/**
 * Cadena M↔T: cada planilla tiene sus propios préstamos y gastos; solo el saldo pasa de M a T.
 * - Gasto operativo: es de la planilla secundaria si lleva `route` = esa planilla; sin marca = principal.
 * - Préstamo: es de la planilla de su cliente.
 */
export type ChainRouteSplit = {
  side: "primary" | "secondary";
  secondaryRoute: string;
  /** Clientes de la planilla secundaria: sus préstamos son de esa planilla. */
  secondaryClientRefs: ReadonlySet<string>;
  /** Clientes de A / N: desde `ownCashFrom` sus préstamos salen de su propia caja (ni M ni T). */
  ownCashClientRefs?: ReadonlySet<string>;
  ownCashFrom?: string;
};

export function isSecondaryOperativeLine(
  line: Pick<RouteExpenseLine, "category" | "id" | "route">,
  secondaryRoute: string,
) {
  if (isPrestamoRutaExpense(line)) return false;
  const route = String(line.route || "").trim();
  return Boolean(route) && sameRoute(route, secondaryRoute);
}

export function operativeLineOnSide(
  line: Pick<RouteExpenseLine, "category" | "id" | "route">,
  split: ChainRouteSplit,
) {
  return isSecondaryOperativeLine(line, split.secondaryRoute) === (split.side === "secondary");
}

export function loanClientOnSide(
  clientRef: string | undefined,
  split: ChainRouteSplit,
  dateIso: string,
) {
  if (
    clientRef &&
    split.ownCashFrom &&
    dateIso >= split.ownCashFrom &&
    split.ownCashClientRefs?.has(clientRef)
  ) {
    return false;
  }
  const onSecondary = Boolean(clientRef) && split.secondaryClientRefs.has(clientRef as string);
  return onSecondary === (split.side === "secondary");
}
