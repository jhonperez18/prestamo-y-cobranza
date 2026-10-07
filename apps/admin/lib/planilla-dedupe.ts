import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isAssignmentAwaitingLoan } from "@/lib/planilla-display";

/** Una visita por cobro del día (evita triplicar filas en Resumen / app cobrador / supervisor). */
export function dedupePlanillaAssignments(
  assignments: DailyCollectionAssignment[],
): DailyCollectionAssignment[] {
  const byKey = new Map<string, DailyCollectionAssignment>();
  for (const row of assignments) {
    const key =
      row.itemId ||
      `${row.dispatchDate}:${row.loanRef || ""}:${row.clientRef}:acum`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    // Conserva el que ya tiene progreso de cobro / cierre.
    const prevScore =
      (prev.dayClosedAt ? 4 : 0) +
      (prev.paymentRef ? 2 : 0) +
      (prev.visitStatus === "omitido" ? 3 : 0) +
      (prev.visitStatus === "cobrado" || prev.visitStatus === "parcial" ? 1 : 0);
    const nextScore =
      (row.dayClosedAt ? 4 : 0) +
      (row.paymentRef ? 2 : 0) +
      (row.visitStatus === "omitido" ? 3 : 0) +
      (row.visitStatus === "cobrado" || row.visitStatus === "parcial" ? 1 : 0);
    byKey.set(key, nextScore >= prevScore ? row : prev);
  }
  return [...byKey.values()];
}

/**
 * Prestar ya resuelta (préstamo hecho hoy / no quiere) no es segunda persona
 * si ese cliente ya tiene su cuota del día. La fila se queda guardada para el
 * pull; la lista cuenta 1.
 */
export function isResolvedCompanionPrestar(
  row: DailyCollectionAssignment,
  dayRows: DailyCollectionAssignment[],
): boolean {
  if (!isAssignmentAwaitingLoan(row) || row.visitStatus !== "omitido") return false;
  return dayRows.some(
    (other) =>
      other.itemId !== row.itemId &&
      other.collectorRef === row.collectorRef &&
      other.dispatchDate === row.dispatchDate &&
      other.clientRef === row.clientRef &&
      !isAssignmentAwaitingLoan(other),
  );
}

/** Lista / KPI: una persona por cliente. No usar al persistir (el pull revive Prestar). */
export function visiblePlanillaAssignments(
  assignments: DailyCollectionAssignment[],
): DailyCollectionAssignment[] {
  const unique = dedupePlanillaAssignments(assignments);
  return unique.filter((row) => !isResolvedCompanionPrestar(row, unique));
}
