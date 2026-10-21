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

function sameClientVisit(
  row: DailyCollectionAssignment,
  other: DailyCollectionAssignment,
) {
  return (
    other.itemId !== row.itemId &&
    other.collectorRef === row.collectorRef &&
    other.dispatchDate === row.dispatchDate &&
    other.clientRef === row.clientRef &&
    !isAssignmentAwaitingLoan(other)
  );
}

/**
 * La fila Prestar no es otra persona si ese cliente ya tiene la cuota del día.
 * - Cuota por cobrar + Prestar pendiente: es el mismo cliente (el fantasma que
 *   volvía a la ruta).
 * - Prestar ya resuelta (préstamo hecho hoy / no quiere) al lado de su cuota.
 * La fila sigue guardada para el cierre. La lista cuenta 1.
 * Quien terminó hoy y puede recibir otro préstamo conserva la oferta: su cuota
 * ya está cobrada y esta fila es la única pendiente.
 */
export function isResolvedCompanionPrestar(
  row: DailyCollectionAssignment,
  dayRows: DailyCollectionAssignment[],
): boolean {
  if (!isAssignmentAwaitingLoan(row)) return false;
  const companions = dayRows.filter((other) => sameClientVisit(row, other));
  if (!companions.length) return false;
  const cuotaAbierta = companions.some(
    (other) =>
      other.visitStatus === "pendiente" ||
      other.visitStatus === "parcial" ||
      !other.visitStatus,
  );
  if (cuotaAbierta) return true;
  return row.visitStatus === "omitido" || row.visitStatus === "cobrado";
}

/** Lista / KPI: una persona por cliente. No usar al persistir (el pull revive Prestar). */
export function visiblePlanillaAssignments(
  assignments: DailyCollectionAssignment[],
): DailyCollectionAssignment[] {
  const unique = dedupePlanillaAssignments(assignments);
  return unique.filter((row) => !isResolvedCompanionPrestar(row, unique));
}

function visitRank(row: DailyCollectionAssignment) {
  if (isAssignmentAwaitingLoan(row)) {
    return row.visitStatus === "pendiente" || row.visitStatus === "parcial" || !row.visitStatus ? 1 : 0;
  }
  if (row.visitStatus === "pendiente" || row.visitStatus === "parcial" || !row.visitStatus) return 4;
  if (row.visitStatus === "cobrado") return 3;
  return 2;
}

/**
 * La ruta que se abre (panel y supervisor) muestra una fila por cliente.
 * Si quedaron la cuota y el Prestar, se ve la cuota. El Prestar de quien ya
 * pagó sigue en la lista del cobrador, que arma su pendiente aparte.
 */
export function collapseCompanionVisits(
  assignments: DailyCollectionAssignment[],
): DailyCollectionAssignment[] {
  const byClient = new Map<string, DailyCollectionAssignment>();
  for (const row of visiblePlanillaAssignments(assignments)) {
    const key = `${row.collectorRef}|${row.dispatchDate}|${row.clientRef || row.itemId}`;
    const prev = byClient.get(key);
    if (!prev || visitRank(row) > visitRank(prev)) byClient.set(key, row);
  }
  return [...byClient.values()];
}
