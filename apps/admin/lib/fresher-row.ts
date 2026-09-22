/**
 * Si el registro local tiene updatedAt igual o más nuevo, no lo pisa la nube ni la caché.
 */
import { omitDeleted, readDeletedIdSet } from "@/lib/deleted-ids";

export function rowUpdatedAtMs(row: { updatedAt?: string }) {
  const ms = Date.parse(String(row.updatedAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function mergeFresherByRef<T extends { ref: string; updatedAt?: string }>(
  local: T[],
  incoming: T[],
): T[] {
  const gone = readDeletedIdSet();
  const localByRef = new Map<string, T>();
  for (const row of local) {
    if (row?.ref && !gone.has(row.ref)) localByRef.set(row.ref, row);
  }
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of omitDeleted(incoming, gone)) {
    if (!row?.ref) continue;
    seen.add(row.ref);
    const current = localByRef.get(row.ref);
    if (!current) {
      merged.push(row);
      continue;
    }
    const localMs = rowUpdatedAtMs(current);
    const incomingMs = rowUpdatedAtMs(row);
    merged.push(localMs > 0 && localMs >= incomingMs ? current : row);
  }
  for (const [ref, row] of localByRef) {
    if (!seen.has(ref)) merged.push(row);
  }
  return merged;
}
