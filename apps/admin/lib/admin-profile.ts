import type { AppSession } from "@/lib/auth";
import { writeSession } from "@/lib/auth";
import { loadDemoUsers } from "@/lib/demo-persist";
import { upsertUserInCatalog } from "@/lib/users-catalog";
import { normalizeUserPermissions, type UserRow } from "@/lib/mock-data";

export const ADMIN_PROFILES_KEY = "nexo-admin-profiles";

export type AdminProfile = {
  displayName: string;
  login: string;
  phone: string;
  document: string;
  photo?: string;
};

const EMPTY_PROFILE: AdminProfile = {
  displayName: "",
  login: "",
  phone: "",
  document: "",
};

type ProfileStore = Record<string, AdminProfile>;

function readStore(): ProfileStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ADMIN_PROFILES_KEY);
    return raw ? (JSON.parse(raw) as ProfileStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: ProfileStore) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_PROFILES_KEY, JSON.stringify(store));
}

export function readAdminProfile(userRef: string, fallbackName = "", fallbackLogin = ""): AdminProfile {
  const stored = readStore()[userRef];
  const users = loadDemoUsers();
  const user = users.find((row) => row.ref === userRef);
  const login = stored?.login?.trim() || user?.login || fallbackLogin;

  if (!stored) {
    return { ...EMPTY_PROFILE, displayName: fallbackName, login };
  }
  return {
    ...EMPTY_PROFILE,
    ...stored,
    displayName: stored.displayName || fallbackName,
    login,
  };
}

export function saveAdminProfile(userRef: string, profile: AdminProfile) {
  const store = readStore();
  store[userRef] = profile;
  writeStore(store);
}

export function saveAdminPassword(userRef: string, login: string, password: string) {
  const users = loadDemoUsers();
  const idx = users.findIndex((row) => row.ref === userRef || row.login.toLowerCase() === login.toLowerCase());
  if (idx === -1) return users;

  const updated = normalizeUserPermissions({
    ...users[idx]!,
    password: password.trim(),
  });
  return upsertUserInCatalog(updated);
}

export function syncUserRowFromProfile(userRef: string, profile: AdminProfile) {
  const users = loadDemoUsers();
  const idx = users.findIndex((row) => row.ref === userRef);
  if (idx === -1) return users;

  const updated = normalizeUserPermissions({
    ...users[idx]!,
    name: profile.displayName.trim() || users[idx]!.name,
    login: profile.login.trim() || users[idx]!.login,
    phone: profile.phone.trim() || users[idx]!.phone,
    document: profile.document.trim() || users[idx]!.document,
  });
  return upsertUserInCatalog(updated);
}

export function applyProfileToSession(session: AppSession, profile: AdminProfile): AppSession {
  const login = profile.login.trim() || session.username;
  const next: AppSession = {
    ...session,
    name: profile.displayName.trim() || session.name,
    username: login,
  };
  writeSession(next);
  return next;
}
