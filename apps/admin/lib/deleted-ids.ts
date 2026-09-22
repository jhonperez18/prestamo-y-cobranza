/**
 * Tombstones. Un ref borrado en este aparato no vuelve a pintarse ni a guardarse
 * aunque la nube o una caché vieja lo traigan de nuevo.
 */
import { readDemoJson, writeDemoJson, listDeletedRouteRefs, rememberDeletedRouteRef } from "@/lib/demo-persist";

export const DEMO_DELETED_IDS_KEY = "nexo-demo-deleted-ids";

function cleanRef(ref: string) {
  return String(ref || "").trim();
}

export function readDeletedIds(): string[] {
  const stored = readDemoJson<string[]>(DEMO_DELETED_IDS_KEY, []);
  const rows = Array.isArray(stored) ? stored : [];
  return [...new Set([...rows, ...listDeletedRouteRefs()].map(cleanRef).filter(Boolean))];
}

export function readDeletedIdSet() {
  return new Set(readDeletedIds());
}

export function isDeletedRef(ref: string, ids: ReadonlySet<string> = readDeletedIdSet()) {
  const clean = cleanRef(ref);
  return Boolean(clean) && ids.has(clean);
}

/** Escribe el ref en localStorage antes de quitarlo de la pantalla. */
export function rememberDeletedId(ref: string): string[] {
  const clean = cleanRef(ref);
  const prev = readDeletedIds();
  if (!clean) return prev;
  if (!prev.includes(clean)) {
    writeDemoJson(DEMO_DELETED_IDS_KEY, [...prev, clean]);
  }
  if (clean.startsWith("RUT-")) rememberDeletedRouteRef(clean);
  return readDeletedIds();
}

export function forgetDeletedId(ref: string): string[] {
  const clean = cleanRef(ref);
  if (!clean) return readDeletedIds();
  writeDemoJson(
    DEMO_DELETED_IDS_KEY,
    readDeletedIds().filter((row) => row !== clean),
  );
  return readDeletedIds();
}

export function omitDeleted<T extends { ref?: string; id?: string }>(
  rows: T[],
  ids: ReadonlySet<string> = readDeletedIdSet(),
): T[] {
  if (!ids.size) return rows;
  return rows.filter((row) => {
    const ref = cleanRef(String(row.ref || ""));
    const id = cleanRef(String(row.id || ""));
    if (ref && ids.has(ref)) return false;
    if (id && ids.has(id)) return false;
    return true;
  });
}
