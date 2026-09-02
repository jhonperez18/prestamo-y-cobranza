import { roleByRef, ROLES, USERS, type UserRow } from "@/lib/mock-data";

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
  let user = users.find((row) => row.login.toLowerCase() === login);

  if (!user) {
    user = USERS.find((row) => row.login.toLowerCase() === login);
  }

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
  window.localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  window.localStorage.removeItem(AUTH_SESSION_KEY);
}
