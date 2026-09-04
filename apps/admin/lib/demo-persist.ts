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
export const DEMO_BANK_SIDES_VERSION_KEY = "nexo-demo-banco-sides-version";
export const DEMO_MISC_PAYMENTS_KEY = "nexo-demo-pagos-varios";
/** Cierres de mes del cobrador (revisión / arrastre de saldo). */
export const DEMO_COLLECTOR_MONTH_CLOSES_KEY = "nexo-demo-collector-month-closes";
/** Borradores de gastos de ruta (se guardan durante el día; el cierre los fija). */
export const DEMO_COLLECTOR_DAY_EXPENSES_KEY = "nexo-demo-collector-day-expenses";
/** Cierres de jornada del cobrador (cuadre + caja menor). */
export const DEMO_COLLECTOR_DAY_CLOSES_KEY = "nexo-demo-collector-day-closes";
/** Una sola vez: vacía préstamos y cobros guardados en el navegador. */
export const DEMO_LOANS_CLEARED_KEY = "nexo-demo-loans-cleared-v2";
/** Una sola vez: limpia Registros banco + cobros demo para empezar de nuevo. */
export const DEMO_BANK_REGISTROS_CLEAN_KEY = "nexo-demo-banco-registros-clean-v1";
/** Una sola vez: saca de planillas a no-clientes (pte. revisión / visitas inventadas). */
export const DEMO_PLANILLA_PURGE_KEY = "nexo-demo-planilla-purge-invalid-v1";

const SYSTEM_LOGINS = new Set(["truqui", "supervisor"]);

function ensureLoansClearedOnce() {
  if (typeof window === "undefined") return;
  const done = readDemoJson<number>(DEMO_LOANS_CLEARED_KEY, 0);
  if (done >= 1) return;
  writeDemoJson(DEMO_LOANS_KEY, []);
  writeDemoJson(DEMO_PAYMENTS_KEY, []);
  writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, []);
  writeDemoJson(DEMO_LOANS_CLEARED_KEY, 1);
}

/**
 * Ya no borra datos. Las limpiezas automáticas desalineaban la app (Historial)
 * del sistema (Registros / Gastos). Solo marca la bandera si faltaba.
 */
export function ensureBankRegistrosCleanOnce() {
  if (typeof window === "undefined") return;
  const done = readDemoJson<number>(DEMO_BANK_REGISTROS_CLEAN_KEY, 0);
  if (done >= 1) return;
  writeDemoJson(DEMO_BANK_REGISTROS_CLEAN_KEY, 1);
}

/**
 * Saca de la planilla guardada a quien no es cliente activo (pte. revisión, visita inventada).
 * Crítico: no puede aparecer en listas de cobro.
 */
export function ensureInvalidPlanillaPurgedOnce() {
  if (typeof window === "undefined") return;
  const done = readDemoJson<number>(DEMO_PLANILLA_PURGE_KEY, 0);
  if (done >= 1) return;

  const clients = readDemoJson<
    Array<{ ref?: string; status?: string }>
  >(DEMO_CLIENTS_KEY, []);
  const reviewRefs = new Set(
    clients
      .filter((row) => row.status === "Pte. revisión" || row.status === "Prospecto")
      .map((row) => row.ref)
      .filter(Boolean) as string[],
  );

  const assignments = readDemoJson<
    Array<{
      clientRef?: string;
      loanRef?: string;
      itemId?: string;
      clientName?: string;
      [key: string]: unknown;
    }>
  >(DEMO_DAILY_ASSIGNMENTS_KEY, []);

  writeDemoJson(
    DEMO_DAILY_ASSIGNMENTS_KEY,
    assignments.filter((row) => {
      if (!row.loanRef || String(row.itemId ?? "").includes(":ruta")) return false;
      if (row.clientRef && reviewRefs.has(row.clientRef)) return false;
      const name = String(row.clientName ?? "").toLowerCase();
      if (name.includes("roberto") && name.includes("vargas")) return false;
      return true;
    }),
  );

  writeDemoJson(DEMO_PLANILLA_PURGE_KEY, 1);
}

/** Lee préstamos guardados; `[]` cuenta (no vuelve a la semilla). */
function readStoredLoans(): LoanRow[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_LOANS_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as LoanRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

/** Lee cobros guardados; `[]` cuenta (no vuelve a la semilla). */
function readStoredPayments(): PaymentRow[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_PAYMENTS_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as PaymentRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

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
  ensureLoansClearedOnce();
  ensureBankRegistrosCleanOnce();
  ensureInvalidPlanillaPurgedOnce();
  const stored = readStoredPayments();
  const firstBoot = stored === null;
  const merged = mergeStoredPaymentsWithSeed(stored ?? PAYMENTS, {
    addMissingSeed: firstBoot,
  });
  if (!loans) return merged;
  return normalizeAllPayments(merged, loans);
}

/** Carga pagos y préstamos sincronizados (fuente única para el panel). */
export function loadDemoPaymentsBundle() {
  ensureLoansClearedOnce();
  ensureBankRegistrosCleanOnce();
  ensureInvalidPlanillaPurgedOnce();
  const stored = readStoredPayments();
  const firstBoot = stored === null;
  const merged = mergeStoredPaymentsWithSeed(stored ?? PAYMENTS, {
    addMissingSeed: firstBoot,
  });
  const loans = loadDemoLoans(merged);
  const payments = normalizeAllPayments(merged, loans);
  return { payments, loans };
}

/** Préstamos con saldos sincronizados a los pagos guardados. */
export function loadDemoLoans(payments: PaymentRow[] = loadDemoPayments()): LoanRow[] {
  ensureLoansClearedOnce();
  const stored = readStoredLoans();
  const base = stored ?? LOANS;
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
