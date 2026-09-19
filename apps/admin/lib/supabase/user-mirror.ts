/**
 * Catálogo de usuarios compartido (localhost = Vercel).
 *
 * Hoy: Supabase Storage `app-catalog/users.json` (service role en /api).
 * Migración SQL `app_users` queda lista para cuando se haga db push;
 * el mirror intenta SQL si la tabla existe y, si no, usa Storage.
 */
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AccessChannel, UserRow } from "@/lib/mock-data";
import {
  DEMO_USERS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";

export const DEMO_USER_MIRROR_QUEUE_KEY = "nexo-demo-user-mirror-queue";
export const DEMO_USER_DELETE_QUEUE_KEY = "nexo-demo-user-delete-queue";

const STORAGE_BUCKET = "app-catalog";
const STORAGE_PATH = "users.json";

export type UserMirrorRow = {
  ref: string;
  login: string;
  email: string | null;
  password: string | null;
  name: string;
  phone: string;
  document: string | null;
  role_ref: string;
  collector_ref: string | null;
  channels: AccessChannel[];
  permissions: string[];
  active: boolean;
  last_access: string | null;
  updated_at: string;
};

type UsersCatalogFile = {
  updatedAt: string;
  users: UserRow[];
};

function asChannels(value: unknown): AccessChannel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is AccessChannel => v === "admin" || v === "mobile");
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeUser(row: Partial<UserRow> & { ref?: string; login?: string }): UserRow | null {
  const ref = (row.ref || "").trim();
  const login = (row.login || "").trim();
  if (!ref || !login) return null;
  return {
    ref,
    login,
    email: row.email?.trim() || undefined,
    password: row.password?.trim() || undefined,
    name: row.name || "",
    phone: row.phone || "",
    document: row.document?.trim() || undefined,
    roleRef: row.roleRef || "",
    collectorRef: row.collectorRef?.trim() || undefined,
    channels: asChannels(row.channels),
    permissions: asStringArray(row.permissions),
    active: row.active !== false,
    lastAccess: row.lastAccess?.trim() || undefined,
    catalogUpdatedAt: row.catalogUpdatedAt?.trim() || undefined,
  };
}

export function userRowToMirror(row: UserRow): UserMirrorRow | null {
  const ref = (row.ref || "").trim();
  const login = (row.login || "").trim();
  if (!ref || !login) return null;
  return {
    ref,
    login,
    email: row.email?.trim() || null,
    password: row.password?.trim() || null,
    name: row.name || "",
    phone: row.phone || "",
    document: row.document?.trim() || null,
    role_ref: row.roleRef,
    collector_ref: row.collectorRef?.trim() || null,
    channels: [...(row.channels ?? [])],
    permissions: [...(row.permissions ?? [])],
    active: row.active !== false,
    last_access: row.lastAccess?.trim() || null,
    // Conserva el sello del Listado; no regenerar "ahora" en cada lectura.
    updated_at: row.catalogUpdatedAt?.trim() || new Date().toISOString(),
  };
}

export function mirrorToUserRow(row: UserMirrorRow): UserRow | null {
  return normalizeUser({
    ref: row.ref,
    login: row.login,
    email: row.email || undefined,
    password: row.password || undefined,
    name: row.name,
    phone: row.phone,
    document: row.document || undefined,
    roleRef: row.role_ref,
    collectorRef: row.collector_ref || undefined,
    channels: asChannels(row.channels),
    permissions: asStringArray(row.permissions),
    active: row.active !== false,
    lastAccess: row.last_access || undefined,
    catalogUpdatedAt: row.updated_at || undefined,
  });
}

function userSignature(row: UserRow) {
  return [
    row.ref,
    row.login,
    row.email ?? "",
    row.password ?? "",
    row.name,
    row.phone,
    row.document ?? "",
    row.roleRef,
    row.collectorRef ?? "",
    (row.channels ?? []).join(","),
    (row.permissions ?? []).slice().sort().join(","),
    row.active ? 1 : 0,
    row.lastAccess ?? "",
  ].join("|");
}

async function readStorageCatalog(): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  users: UserRow[];
}> {
  const supabase = createSupabaseAdminClient() ?? createMirrorServerClient();
  if (!supabase) {
    return { ok: true, skipped: true, reason: "supabase_not_configured", users: [] };
  }
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_PATH);
  if (error) {
    // Bucket vacío / archivo aún no creado.
    if (/not found|No such file|404/i.test(error.message)) {
      return { ok: true, users: [] };
    }
    return { ok: false, error: error.message, users: [] };
  }
  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as UsersCatalogFile | UserRow[];
    const raw = Array.isArray(parsed) ? parsed : parsed.users;
    const users = (raw ?? [])
      .map((row) => normalizeUser(row))
      .filter((row): row is UserRow => Boolean(row));
    return { ok: true, users };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "invalid_users_catalog",
      users: [],
    };
  }
}

async function writeStorageCatalog(users: UserRow[]) {
  const supabase = createSupabaseAdminClient() ?? createMirrorServerClient();
  if (!supabase) {
    return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  }
  const payload: UsersCatalogFile = {
    updatedAt: new Date().toISOString(),
    users: users
      .map((row) => normalizeUser(row))
      .filter((row): row is UserRow => Boolean(row))
      .sort((a, b) => a.ref.localeCompare(b.ref, "es")),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(STORAGE_PATH, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

async function trySqlFetch(): Promise<{
  used: boolean;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  rows: UserMirrorRow[];
}> {
  const supabase = createMirrorServerClient();
  if (!supabase) {
    return { used: false, ok: true, skipped: true, reason: "supabase_not_configured", rows: [] };
  }
  const { data, error } = await supabase.from("app_users").select("*").order("ref").limit(500);
  if (error) {
    if (/PGRST205|schema cache|does not exist/i.test(error.message)) {
      return { used: false, ok: true, rows: [] };
    }
    return { used: true, ok: false, error: error.message, rows: [] };
  }
  return { used: true, ok: true, rows: (data ?? []) as UserMirrorRow[] };
}

export async function mirrorUserToSupabase(user: UserRow) {
  const normalized = normalizeUser(user);
  if (!normalized) return { ok: true as const, skipped: true as const, reason: "invalid_user" };

  const sql = createMirrorServerClient();
  if (sql) {
    const row = userRowToMirror(normalized);
    if (row) {
      const { error } = await sql.from("app_users").upsert(row, { onConflict: "ref" });
      if (error && !/PGRST205|schema cache|does not exist/i.test(error.message)) {
        // SQL falló de verdad: aún intentamos Storage.
      } else if (!error) {
        // También escribe Storage para orígenes que aún no tienen tabla.
      }
    }
  }

  const current = await readStorageCatalog();
  if (!current.ok) return { ok: false as const, error: current.error || "read_failed" };
  if (current.skipped) {
    return { ok: true as const, skipped: true as const, reason: current.reason };
  }
  const byRef = new Map(current.users.map((row) => [row.ref, row]));
  byRef.set(normalized.ref, normalized);
  return writeStorageCatalog(Array.from(byRef.values()));
}

export async function deleteUserFromSupabase(ref: string) {
  const clean = (ref || "").trim();
  if (!clean) return { ok: true as const, skipped: true as const, reason: "invalid_ref" };

  const sql = createMirrorServerClient();
  if (sql) {
    const { error } = await sql.from("app_users").delete().eq("ref", clean);
    if (error && !/PGRST205|schema cache|does not exist/i.test(error.message)) {
      /* Storage sigue siendo la raíz activa */
    }
  }

  const current = await readStorageCatalog();
  if (!current.ok) return { ok: false as const, error: current.error || "read_failed" };
  if (current.skipped) {
    return { ok: true as const, skipped: true as const, reason: current.reason };
  }
  return writeStorageCatalog(current.users.filter((row) => row.ref !== clean));
}

/**
 * Lectura del catálogo: Storage es la raíz (mismo archivo que escribe Guardar).
 * SQL app_users es espejo opcional; si mandara primero, rebobinaba login/clave del Listado.
 */
export async function fetchUsersFromSupabase() {
  const storage = await readStorageCatalog();
  if (storage.skipped) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: storage.reason,
      rows: [] as UserMirrorRow[],
    };
  }
  if (!storage.ok) {
    return { ok: false as const, error: storage.error || "fetch_failed", rows: [] as UserMirrorRow[] };
  }

  const byRef = new Map<string, UserMirrorRow>();
  for (const row of storage.users) {
    const mapped = userRowToMirror(row);
    if (mapped) byRef.set(mapped.ref, mapped);
  }

  // Completa refs que solo existan en SQL (migración), sin pisar Storage.
  const sql = await trySqlFetch();
  if (sql.used && sql.ok) {
    for (const row of sql.rows) {
      const ref = (row.ref || "").trim();
      if (!ref || byRef.has(ref)) continue;
      byRef.set(ref, row);
    }
  }

  const rows = Array.from(byRef.values()).sort((a, b) => a.ref.localeCompare(b.ref, "es"));
  return { ok: true as const, rows };
}

function readQueue<T extends { ref: string }>(key: string) {
  return readDemoJson<T[]>(key, []).filter((row) => row?.ref);
}

function writeQueue<T>(key: string, rows: T[]) {
  writeDemoJson(key, rows);
}

async function postMirror(body: unknown) {
  const res = await fetch("/api/users/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  });
  const json = (await res.json()) as {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
  return { res, json };
}

export function queueUserMirror(user: UserRow) {
  if (typeof window === "undefined") return;
  const normalized = {
    ...user,
    ref: (user.ref || "").trim(),
    login: (user.login || "").trim(),
  };
  if (!normalized.ref || !normalized.login) return;

  // Cola PRIMERO: si un pull llega mientras sube, conserva la edición local.
  const q = readQueue<UserRow>(DEMO_USER_MIRROR_QUEUE_KEY).filter((r) => r.ref !== normalized.ref);
  q.push(normalized);
  writeQueue(DEMO_USER_MIRROR_QUEUE_KEY, q);

  void (async () => {
    try {
      const { res, json } = await postMirror({ kind: "upsert", user: normalized });
      if (res.ok && json.ok && !json.skipped) {
        writeQueue(
          DEMO_USER_MIRROR_QUEUE_KEY,
          readQueue<UserRow>(DEMO_USER_MIRROR_QUEUE_KEY).filter((r) => r.ref !== normalized.ref),
        );
        return;
      }
      if (res.ok && json.ok && json.skipped && json.reason === "invalid_user") {
        writeQueue(
          DEMO_USER_MIRROR_QUEUE_KEY,
          readQueue<UserRow>(DEMO_USER_MIRROR_QUEUE_KEY).filter((r) => r.ref !== normalized.ref),
        );
      }
    } catch {
      /* ya está en cola */
    }
  })();
}

export function queueUsersMirror(rows: UserRow[]) {
  for (const row of rows) queueUserMirror(row);
}

export function queueUserDeleteMirror(ref: string) {
  const clean = (ref || "").trim();
  if (!clean || typeof window === "undefined") return;
  const queued = readQueue<{ ref: string }>(DEMO_USER_DELETE_QUEUE_KEY);
  if (!queued.some((row) => row.ref === clean)) {
    writeQueue(DEMO_USER_DELETE_QUEUE_KEY, [...queued, { ref: clean }]);
  }
  // Quitar upsert pendiente del mismo ref (delete gana).
  writeQueue(
    DEMO_USER_MIRROR_QUEUE_KEY,
    readQueue<UserRow>(DEMO_USER_MIRROR_QUEUE_KEY).filter((r) => r.ref !== clean),
  );
  void (async () => {
    try {
      const { res, json } = await postMirror({ kind: "delete", ref: clean });
      if (res.ok && json.ok) {
        writeQueue(
          DEMO_USER_DELETE_QUEUE_KEY,
          readQueue<{ ref: string }>(DEMO_USER_DELETE_QUEUE_KEY).filter((r) => r.ref !== clean),
        );
      }
    } catch {
      /* ya está en cola */
    }
  })();
}

export async function flushUserMirrorQueues() {
  if (typeof window === "undefined") return;

  const deletes = readQueue<{ ref: string }>(DEMO_USER_DELETE_QUEUE_KEY);
  const deletesLeft: { ref: string }[] = [];
  for (const row of deletes) {
    try {
      const { res, json } = await postMirror({ kind: "delete", ref: row.ref });
      if (!(res.ok && json.ok)) deletesLeft.push(row);
    } catch {
      deletesLeft.push(row);
    }
  }
  writeQueue(DEMO_USER_DELETE_QUEUE_KEY, deletesLeft);

  const users = readQueue<UserRow>(DEMO_USER_MIRROR_QUEUE_KEY);
  const left: UserRow[] = [];
  for (const user of users) {
    try {
      const { res, json } = await postMirror({ kind: "upsert", user });
      if (res.ok && json.ok && !json.skipped) continue;
      if (res.ok && json.ok && json.skipped && json.reason === "invalid_user") continue;
      left.push(user);
    } catch {
      left.push(user);
    }
  }
  writeQueue(DEMO_USER_MIRROR_QUEUE_KEY, left);
}

export type PullUsersResult = {
  ok: boolean;
  changed: boolean;
  reason?: string;
  count?: number;
};

/**
 * Pull usuarios. Remoto manda (incluye borrados).
 * Conserva solo filas locales pendientes de cola de upsert.
 */
export async function pullRemoteUsersIntoDemo(): Promise<PullUsersResult> {
  if (typeof window === "undefined") {
    return { ok: true, changed: false, reason: "ssr" };
  }
  try {
    const res = await fetch("/api/users", { cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      users?: UserMirrorRow[];
      skipped?: boolean;
      error?: string;
    };
    if (!res.ok || !body.ok) {
      return { ok: false, changed: false, reason: body.error || "users_pull_failed" };
    }
    if (body.skipped) {
      return { ok: true, changed: false, reason: "skipped", count: 0 };
    }

    const remote = (body.users ?? [])
      .map(mirrorToUserRow)
      .filter((row): row is UserRow => Boolean(row));

    const local = readDemoJson<UserRow[]>(DEMO_USERS_KEY, []);

    if (remote.length === 0) {
      // Nube vacía: NO borrar el Listado local (un alta recién hecha debe poder entrar).
      return {
        ok: true,
        changed: false,
        reason: "remote_empty_keep_local",
        count: local.length,
      };
    }

    const pendingUpserts = readQueue<UserRow>(DEMO_USER_MIRROR_QUEUE_KEY);
    const pendingByRef = new Map(pendingUpserts.map((row) => [row.ref, row]));
    const pendingDeletes = new Set(
      readQueue<{ ref: string }>(DEMO_USER_DELETE_QUEUE_KEY).map((row) => row.ref),
    );
    const localByRef = new Map(local.filter((row) => row?.ref).map((row) => [row.ref, row]));

    const byRef = new Map<string, UserRow>();
    for (const row of remote) {
      if (!row?.ref || pendingDeletes.has(row.ref)) continue;
      const pending = pendingByRef.get(row.ref);
      const localRow = localByRef.get(row.ref);
      let chosen: UserRow;
      if (pending) {
        chosen = pending;
      } else if (localRow) {
        const localTs = Date.parse(localRow.catalogUpdatedAt || "") || 0;
        const remoteTs = Date.parse(row.catalogUpdatedAt || "") || 0;
        // Listado más nuevo (o igual) en este aparato no se rebobina.
        chosen = localTs >= remoteTs && localTs > 0 ? localRow : row;
        if (!chosen.password?.trim() && localRow.password?.trim()) {
          chosen = { ...chosen, password: localRow.password };
        }
      } else {
        chosen = row;
      }
      byRef.set(row.ref, chosen);
    }
    for (const [ref, row] of pendingByRef) {
      if (pendingDeletes.has(ref)) continue;
      if (!byRef.has(ref)) byRef.set(ref, row);
    }
    // Altas locales (recién creadas) sobreviven aunque el pull aún no las vea en nube.
    for (const [ref, row] of localByRef) {
      if (pendingDeletes.has(ref)) continue;
      if (!byRef.has(ref)) byRef.set(ref, row);
    }

    const merged = Array.from(byRef.values()).sort((a, b) =>
      a.ref.localeCompare(b.ref, "es"),
    );

    const localSig = local.map(userSignature).sort().join("\n");
    const nextSig = merged.map(userSignature).sort().join("\n");
    if (localSig === nextSig) {
      return { ok: true, changed: false, count: merged.length };
    }

    writeDemoJson(DEMO_USERS_KEY, merged);
    return { ok: true, changed: true, count: merged.length };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      reason: err instanceof Error ? err.message : "users_pull_failed",
    };
  }
}
