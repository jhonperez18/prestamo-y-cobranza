import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";

function assignmentKey(row: Pick<DailyCollectionAssignment, "dispatchDate" | "itemId">) {
  return `${row.dispatchDate}::${row.itemId}`;
}

function isSealedVisit(row: DailyCollectionAssignment) {
  return (
    row.visitStatus === "omitido" ||
    row.visitStatus === "cobrado" ||
    Boolean(String(row.paymentRef || "").trim())
  );
}

function isOpenCollectVisit(row: DailyCollectionAssignment) {
  return (
    (row.visitStatus === "pendiente" ||
      row.visitStatus === "parcial" ||
      !row.visitStatus) &&
    !String(row.paymentRef || "").trim() &&
    !row.dayClosedAt
  );
}

/**
 * El ciclo puede regenerar la hoja abierta y dejar «pendiente» visitas que
 * ya venían selladas (N/P u cobro). Restaura ese sello desde la foto previa.
 */
export function restoreSealedVisitsFromPrior(
  nextRows: DailyCollectionAssignment[],
  priorRows: DailyCollectionAssignment[],
): DailyCollectionAssignment[] {
  if (!nextRows.length || !priorRows.length) return nextRows;
  const priorByKey = new Map(
    priorRows.map((row) => [assignmentKey(row), row] as const),
  );
  let changed = false;
  const restored = nextRows.map((row) => {
    const prior = priorByKey.get(assignmentKey(row));
    if (!prior || !isSealedVisit(prior) || !isOpenCollectVisit(row)) return row;
    changed = true;
    return {
      ...row,
      visitStatus: prior.visitStatus === "omitido" ? ("omitido" as const) : ("cobrado" as const),
      skipReason: prior.skipReason,
      paymentRef: prior.paymentRef,
      amountDue: 0,
      alertCount: 0,
    };
  });
  return changed ? restored : nextRows;
}
