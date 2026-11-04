/**
 * Catálogo de usuarios para login. Disco + memoria primero:
 * si Supabase/Storage tarda o el proceso se reinicia, el cobrador igual entra.
 */
import { promises as fs } from "fs";
import path from "path";
import {
  fetchUsersFromSupabase,
  type UserMirrorRow,
} from "@/lib/supabase/user-mirror";

const FILE = path.join(process.cwd(), "data", "users-catalog-cache.json");
const MEM_TTL_MS = 120_000;

type CachePayload = {
  at: string;
  users: UserMirrorRow[];
};

let memory: { at: number; users: UserMirrorRow[] } | null = null;
let fileLoaded = false;
let refreshing = false;

async function ensureFile() {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as CachePayload;
    if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
      memory = {
        at: Date.parse(parsed.at) || Date.now(),
        users: parsed.users,
      };
    }
  } catch {
    /* sin archivo */
  }
}

async function persist(users: UserMirrorRow[]) {
  memory = { at: Date.now(), users };
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    const payload: CachePayload = {
      at: new Date().toISOString(),
      users,
    };
    await fs.writeFile(FILE, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.error("users-catalog-cache-write", error);
  }
}

function refreshInBackground() {
  if (refreshing) return;
  refreshing = true;
  void (async () => {
    try {
      const result = await fetchUsersFromSupabase();
      if (result.ok && !("skipped" in result && result.skipped) && result.rows.length > 0) {
        await persist(result.rows);
      }
    } catch (error) {
      console.error("users-catalog-refresh", error);
    } finally {
      refreshing = false;
    }
  })();
}

export type UsersCatalogResult =
  | { ok: true; users: UserMirrorRow[]; fromCache?: boolean }
  | { ok: true; skipped: true; reason: string; users: [] }
  | { ok: false; error: string; users: [] };

/** Tras Guardar usuario en el Listado: deja el login vivo en disco del VPS. */
export async function seedUsersCatalogCache(users: UserMirrorRow[]): Promise<void> {
  if (!Array.isArray(users) || users.length === 0) return;
  await persist(users);
}

/**
 * Login: responde al instante con caché si hay; actualiza atrás.
 * Sin caché: una lectura a la nube (con tope).
 */
export async function readUsersCatalogCached(): Promise<UsersCatalogResult> {
  await ensureFile();

  if (memory && memory.users.length > 0) {
    refreshInBackground();
    return { ok: true, users: memory.users, fromCache: true };
  }

  const FETCH_MS = 8_000;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      fetchUsersFromSupabase(),
      new Promise<Awaited<ReturnType<typeof fetchUsersFromSupabase>>>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false as const, error: "users_storage_timeout", rows: [] }),
          FETCH_MS,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);

    if ("skipped" in result && result.skipped) {
      return { ok: true, skipped: true, reason: result.reason, users: [] };
    }
    if (!result.ok) {
      if (memory && memory.users.length > 0) {
        return { ok: true, users: memory.users, fromCache: true };
      }
      return { ok: false, error: result.error || "fetch_failed", users: [] };
    }
    if (result.rows.length > 0) await persist(result.rows);
    return { ok: true, users: result.rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : "users_failed";
    if (memory && memory.users.length > 0) {
      return { ok: true, users: memory.users, fromCache: true };
    }
    return { ok: false, error: message, users: [] };
  }
}
