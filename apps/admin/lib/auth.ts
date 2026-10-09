import { freeDemoStorageQuota } from "@/lib/demo-persist";
import { roleByRef, ROLES, type UserRow } from "@/lib/mock-data";

export const AUTH_SESSION_KEY = "nexo-admin-session";
export const DEFAULT_DEMO_PASSWORD = "123";

export type AccessChannel = "admin" | "mobile";

export type AppSession = {
  userRef: string;
  username: string;
  name: string;
  roleRef: string;
  roleName: string;
  permissions: string[];
  channels: AccessChannel[];
  collectorRef?: string;
  /** Día (Bogotá) en que se entró: la sesión guardada vence a medianoche. */
  issuedOn?: string;
  /** Huella de la clave al entrar (no la clave): si el Listado la cambia, se vuelve a pedir. */
  credentialStamp?: string;
};

/** @deprecated use AppSession */
export type AdminSession = AppSession;

function resolveUserPermissions(user: UserRow) {
  if (user.permissions?.length) return [...user.permissions];
  const role = roleByRef(user.roleRef, ROLES);
  return role ? [...role.permissions] : [];
}

export function sessionFromUser(user: UserRow): AppSession {
  const role = roleByRef(user.roleRef, ROLES);
  const permissions = role
    ? [...new Set([...role.permissions, ...(user.permissions ?? [])])]
    : resolveUserPermissions(user);
  return {
    userRef: user.ref,
    username: user.login,
    name: user.name,
    roleRef: user.roleRef,
    roleName: role?.name ?? "Usuario",
    permissions,
    channels: [...user.channels],
    collectorRef: user.collectorRef,
  };
}

/** Sincroniza permisos del rol cuando la sesión guardada quedó desactualizada. */
export function refreshSession(session: AppSession): AppSession {
  const role = roleByRef(session.roleRef, ROLES);
  if (!role) return session;
  const permissions = [...new Set([...role.permissions, ...(session.permissions ?? [])])];
  const changed =
    permissions.length !== session.permissions.length ||
    permissions.some((perm) => !session.permissions.includes(perm));
  const next = {
    ...session,
    roleName: role.name,
    permissions,
  };
  if (changed && typeof window !== "undefined") {
    writeSession(next);
  }
  return next;
}

export function validateLogin(
  username: string,
  password: string,
  users: UserRow[],
): AppSession | null {
  const login = username.trim().toLowerCase();
  const pwd = password.trim();
  const user = users.find((row) => {
    const rowLogin = row.login.toLowerCase();
    const rowEmail = (row.email || "").trim().toLowerCase();
    return rowLogin === login || (rowEmail !== "" && rowEmail === login);
  });

  if (!user || !user.active) return null;

  const expected = user.password?.trim() || DEFAULT_DEMO_PASSWORD;
  if (pwd !== expected) return null;

  return sessionFromUser(user);
}

function migrateLegacySession(parsed: Record<string, unknown>): AppSession | null {
  if (parsed.role === "admin" && parsed.username === "truqui") {
    return {
      userRef: "USR-3",
      username: "truqui",
      name: "Truqui",
      roleRef: "ROL-0",
      roleName: "Administrador",
      permissions: ROLES.find((row) => row.ref === "ROL-0")?.permissions ?? [],
      channels: ["admin"],
    };
  }
  if (typeof parsed.userRef === "string" && typeof parsed.username === "string") {
    return parsed as AppSession;
  }
  return null;
}

export function readSession(): AppSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const migrated = migrateLegacySession(parsed);
    return migrated ? refreshSession(migrated) : null;
  } catch {
    return null;
  }
}

export function writeSession(session: AppSession) {
  const raw = JSON.stringify(session);
  try {
    window.localStorage.setItem(AUTH_SESSION_KEY, raw);
  } catch (error) {
    const quota =
      error instanceof DOMException && error.name === "QuotaExceededError";
    if (!quota) throw error;
    freeDemoStorageQuota();
    window.localStorage.setItem(AUTH_SESSION_KEY, raw);
  }
}

export function clearSession() {
  window.localStorage.removeItem(AUTH_SESSION_KEY);
}

function credentialStampOf(user: UserRow): string {
  const text = `${user.ref}|${user.password?.trim() || DEFAULT_DEMO_PASSWORD}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Sesión recién aceptada en el login: queda marcada con el día y la huella de la clave. */
export function stampSession(session: AppSession, users: UserRow[], today: string): AppSession {
  const user = users.find((row) => row.ref === session.userRef);
  return { ...session, issuedOn: today, credentialStamp: user ? credentialStampOf(user) : "" };
}

/**
 * ¿La sesión sigue valiendo? El Listado (`USR-`) manda: mismo día, usuario activo, mismo rol
 * y la misma clave con que entró. Cualquier cambio → se vuelve a pedir la clave.
 */
export function sessionStillValid(session: AppSession, users: UserRow[], today: string): boolean {
  if (session.issuedOn !== today) return false;
  const user = users.find((row) => row.ref === session.userRef);
  if (!user || !user.active || user.roleRef !== session.roleRef) return false;
  return !session.credentialStamp || credentialStampOf(user) === session.credentialStamp;
}

/**
 * Al arrancar (la app volvió de segundo plano o se recargó): retoma la sesión guardada si
 * sigue valiendo. Sin huella de clave no se retoma.
 */
export function resumeSession(users: UserRow[], today: string): AppSession | null {
  const stored = readSession();
  if (!stored?.credentialStamp || !sessionStillValid(stored, users, today)) return null;
  const user = users.find((row) => row.ref === stored.userRef);
  if (!user) return null;
  return {
    ...sessionFromUser(user),
    issuedOn: stored.issuedOn,
    credentialStamp: stored.credentialStamp,
  };
}
