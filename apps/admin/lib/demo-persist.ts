/**
 * Persistencia demo en localStorage.
 *
 * Flujo de datos:
 *   App móvil (cobrador) → claves nexo-demo-* → Panel administración
 *   Entre celulares de cobradores NO hay intercambio (cada uno ve solo lo suyo).
 */
import {
  LOANS,
  PAYMENTS,
  USERS,
  normalizeUserPermissions,
  type LoanRow,
  type PaymentRow,
  type UserRow,
} from "@/lib/mock-data";
import { syncAllLoans } from "@/lib/loan-preview";
import {
  mergeStoredPaymentsWithSeed,
  normalizeAllPayments,
} from "@/lib/payment-detail";

export const DEMO_USERS_KEY = "nexo-demo-users";
export const DEMO_CLIENTS_KEY = "nexo-demo-clients";
export const DEMO_COLLECTORS_KEY = "nexo-demo-collectors";
export const DEMO_ROUTES_KEY = "nexo-demo-routes";
export const DEMO_DAILY_LOGS_KEY = "nexo-demo-daily-logs";
export const DEMO_DAILY_ASSIGNMENTS_KEY = "nexo-demo-daily-assignments";
export const DEMO_PAYMENTS_KEY = "nexo-demo-payments";
export const DEMO_LOANS_KEY = "nexo-demo-loans";
export const DEMO_BANK_ACCOUNTS_KEY = "nexo-demo-banco-accounts";
export const DEMO_BANK_MOVEMENTS_KEY = "nexo-demo-banco-movements";
export const DEMO_BANK_RECONCILIATIONS_KEY = "nexo-demo-banco-reconciliations";
export const DEMO_MISC_PAYMENTS_KEY = "nexo-demo-pagos-varios";

const SYSTEM_LOGINS = new Set(["truqui", "supervisor"]);

export function readDemoJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore corrupt storage */
  }
  return fallback;
}

export function writeDemoJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

/** Pagos registrados (incluye cobros móviles con evidencia). */
export function loadDemoPayments(loans?: LoanRow[]): PaymentRow[] {
  const stored = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const merged = mergeStoredPaymentsWithSeed(stored.length ? stored : PAYMENTS);
  if (!loans) return merged;
  return normalizeAllPayments(merged, loans);
}

/** Carga pagos y préstamos sincronizados (fuente única para el panel). */
export function loadDemoPaymentsBundle() {
  const stored = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const merged = mergeStoredPaymentsWithSeed(stored.length ? stored : PAYMENTS);
  const loans = loadDemoLoans(merged);
  const payments = normalizeAllPayments(merged, loans);
  return { payments, loans };
}

/** Préstamos con saldos sincronizados a los pagos guardados. */
export function loadDemoLoans(payments: PaymentRow[] = loadDemoPayments()): LoanRow[] {
  const stored = readDemoJson<LoanRow[] | null>(DEMO_LOANS_KEY, null);
  const base = stored?.length ? stored : LOANS;
  return syncAllLoans(base, payments);
}

/** Normaliza usuarios guardados antes de la separación correo / usuario. */
function normalizeStoredUser(row: UserRow): UserRow {
  const normalized = normalizeUserPermissions(row);
  if (normalized.email?.trim()) return normalized;
  const login = normalized.login.trim();
  if (login.includes("@")) {
    return {
      ...normalized,
      email: login,
      login: login.split("@")[0] ?? login,
    };
  }
  return normalized;
}

/** Combina usuarios guardados con el seed para no perder cuentas del sistema. */
export function loadDemoUsers(): UserRow[] {
  const stored = readDemoJson<UserRow[]>(DEMO_USERS_KEY, []);
  if (!stored.length) {
    return USERS.map((row) => normalizeUserPermissions(row));
  }

  const merged = stored.map((row) => normalizeStoredUser(row));
  for (const seed of USERS) {
    const idx = merged.findIndex(
      (row) =>
        row.ref === seed.ref || row.login.toLowerCase() === seed.login.toLowerCase(),
    );
    if (idx === -1) {
      merged.push({ ...seed });
      continue;
    }
    if (SYSTEM_LOGINS.has(seed.login.toLowerCase())) {
      merged[idx] = {
        ...merged[idx],
        login: merged[idx].login?.trim() || seed.login,
        password: merged[idx].password?.trim() || seed.password,
        roleRef: seed.roleRef,
        channels: [...seed.channels],
        active: merged[idx].active !== false,
        permissions: merged[idx].permissions?.length
          ? merged[idx].permissions
          : [...seed.permissions],
      };
    }
  }
  return merged.map((row) => normalizeUserPermissions(row));
}
