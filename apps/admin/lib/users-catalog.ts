/**
 * Catálogo de usuarios — una sola verdad.
 *
 * Orden principal: Listado del sistema (Usuario → Listado).
 * Login, ficha, cobrador/supervisor y la nube leen/escriben por aquí.
 * Nunca una lista fija en el login aparte del listado.
 */
import {
  DEMO_USERS_KEY,
  loadDemoUsers,
  writeDemoJson,
} from "@/lib/demo-persist";
import { normalizeUserPermissions, type UserRow } from "@/lib/mock-data";
import {
  queueUserDeleteMirror,
  queueUserMirror,
} from "@/lib/supabase/user-mirror";

export const USERS_CATALOG_EVENT = "nexo-users-catalog-changed";

function notifyUsersCatalogChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(USERS_CATALOG_EVENT));
}

/** Lectura: misma lista que el Listado (orden por USR-). */
export function readUsersCatalog(): UserRow[] {
  return loadDemoUsers()
    .map((row) => normalizeUserPermissions(row))
    .sort((a, b) => a.ref.localeCompare(b.ref, "es"));
}

/**
 * Persistencia síncrona + aviso a login/UI.
 * Llamar en cada alta/edición/baja — no esperar un useEffect.
 */
export function commitUsersCatalog(users: UserRow[]): UserRow[] {
  const next = users
    .map((row) => normalizeUserPermissions(row))
    .sort((a, b) => a.ref.localeCompare(b.ref, "es"));
  writeDemoJson(DEMO_USERS_KEY, next);
  notifyUsersCatalogChanged();
  return next;
}

/**
 * Persistencia síncrona + cola nube (edición local manda hasta subir).
 */
export function upsertUserInCatalog(user: UserRow): UserRow[] {
  const current = readUsersCatalog();
  const idx = current.findIndex((row) => row.ref === user.ref);
  const next =
    idx === -1
      ? [...current, normalizeUserPermissions(user)]
      : current.map((row, i) => (i === idx ? normalizeUserPermissions(user) : row));
  const committed = commitUsersCatalog(next);
  queueUserMirror(normalizeUserPermissions(user));
  return committed;
}

/** Espera a que la cola de usuarios suba (tras Guardar en ficha). */
export async function flushUsersCatalogToCloud() {
  const { flushUserMirrorQueues } = await import("@/lib/supabase/user-mirror");
  await flushUserMirrorQueues();
}

export function removeUserFromCatalog(ref: string): UserRow[] {
  const clean = (ref || "").trim();
  const committed = commitUsersCatalog(
    readUsersCatalog().filter((row) => row.ref !== clean),
  );
  if (clean) queueUserDeleteMirror(clean);
  return committed;
}

export function replaceUsersCatalog(users: UserRow[], options?: { mirror?: boolean }): UserRow[] {
  const committed = commitUsersCatalog(users);
  if (options?.mirror) {
    for (const row of committed) queueUserMirror(row);
  }
  return committed;
}
