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
