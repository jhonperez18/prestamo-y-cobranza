import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";

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
      (prev.visitStatus === "cobrado" || prev.visitStatus === "parcial" ? 1 : 0);
    const nextScore =
      (row.dayClosedAt ? 4 : 0) +
      (row.paymentRef ? 2 : 0) +
      (row.visitStatus === "cobrado" || row.visitStatus === "parcial" ? 1 : 0);
    byKey.set(key, nextScore >= prevScore ? row : prev);
  }
  return [...byKey.values()];
}
