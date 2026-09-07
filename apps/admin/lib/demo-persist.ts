/**
 * Persistencia demo en localStorage.
 *
 * Regla de oro: NUNCA borrar ni sobrescribir datos del usuario/demo con semillas.
 * Flujo: App móvil / panel → claves nexo-demo-* (con respaldo -bak).
 */
import {
  CLIENTS,
  LOANS,
  PAYMENTS,
  USERS,
  normalizeUserPermissions,
  type ClientRow,
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
/** Clave breve usada en un deploy; se migra de vuelta a DEMO_USERS_KEY. */
const DEMO_USERS_KEY_V2 = "nexo-demo-users-v2";
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
export const DEMO_COLLECTOR_MONTH_CLOSES_KEY = "nexo-demo-collector-month-closes";
export const DEMO_COLLECTOR_DAY_EXPENSES_KEY = "nexo-demo-collector-day-expenses";
export const DEMO_COLLECTOR_DAY_CLOSES_KEY = "nexo-demo-collector-day-closes";

/** Banderas legadas (ya no borran datos; solo se marcan para no reactivar limpiezas viejas). */
export const DEMO_LOANS_CLEARED_KEY = "nexo-demo-loans-cleared-v2";
export const DEMO_LOANS_RESEED_KEY = "nexo-demo-loans-reseed-v1";
export const DEMO_BANK_REGISTROS_CLEAN_KEY = "nexo-demo-banco-registros-clean-v1";
export const DEMO_PLANILLA_PURGE_KEY = "nexo-demo-planilla-purge-invalid-v1";

const SYSTEM_LOGINS = new Set([
  "truqui",
  "supervisor",
  "juan.rios",
  "lina.soto",
  "diego.mora",
]);

const SEED_CLIENT_REFS = new Set(CLIENTS.map((row) => row.ref));
const SEED_PAYMENT_REFS = new Set(PAYMENTS.map((row) => row.ref));
const SEED_LOAN_REFS = new Set(LOANS.map((row) => row.ref));

/**
 * Clientes demo del catálogo mock (Carlos, María, Ana…) que NO son del paquete Chrome.
 * COD-8/COD-9 del paquete son Martina/Roberto reales — no tocar.
 */
export const LEGACY_MOCK_CLIENT_REFS = new Set([
  "COD-0",
  "COD-1",
  "COD-2",
  "COD-3",
  "COD-4",
  "COD-5",
  "COD-6",
  "COD-7",
]);

function backupKey(key: string) {
  return `${key}-bak`;
}

/** Desactiva para siempre las limpiezas destructivas del pasado. */
function disarmLegacyWipes() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_LOANS_CLEARED_KEY, "1");
    window.localStorage.setItem(DEMO_LOANS_RESEED_KEY, "1");
    window.localStorage.setItem(DEMO_BANK_REGISTROS_CLEAN_KEY, "1");
    window.localStorage.setItem(DEMO_PLANILLA_PURGE_KEY, "1");
  } catch {
    /* ignore quota */
  }
}

/** @deprecated No-op: antes vaciaba préstamos/cobros/planilla. */
export function ensureBankRegistrosCleanOnce() {
  disarmLegacyWipes();
}

/** @deprecated No-op: antes purgaba filas de planilla. */
export function ensureInvalidPlanillaPurgedOnce() {
  disarmLegacyWipes();
}

function readRaw(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readBakArray<T>(key: string): T[] {
  const bak = parseJson<T[]>(readRaw(backupKey(key)));
  return Array.isArray(bak) ? bak : [];
}

/** Lee JSON; si la clave principal falla o está vacía, intenta el respaldo -bak. */
export function readDemoJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const primary = parseJson<T>(readRaw(key));
  if (primary !== null && primary !== undefined) {
    if (Array.isArray(primary) && primary.length === 0) {
      const bak = parseJson<T>(readRaw(backupKey(key)));
      if (Array.isArray(bak) && bak.length > 0) return bak;
    }
    return primary;
  }
  const bak = parseJson<T>(readRaw(backupKey(key)));
  if (bak !== null && bak !== undefined) return bak;
  return fallback;
}

/**
 * Escribe JSON guardando antes una copia en -bak (no pisa un bak bueno con []).
 * Así un fallo o una limpieza accidental no destruye el último estado válido.
 */
export function writeDemoJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    const prev = readRaw(key);
    const next = JSON.stringify(value);
    if (prev && prev !== next) {
      const prevParsed = parseJson<unknown>(prev);
      const wipingArray =
        Array.isArray(value) &&
        value.length === 0 &&
        Array.isArray(prevParsed) &&
        prevParsed.length > 0;
      // Nunca respaldar un [] encima de un bak con datos.
      if (!wipingArray) {
        window.localStorage.setItem(backupKey(key), prev);
      } else {
        // Intento de vaciar: conservar prev en -bak y NO escribir [] si hay datos.
        window.localStorage.setItem(backupKey(key), prev);
        return;
      }
    }
    window.localStorage.setItem(key, next);
  } catch {
    /* ignore quota / private mode */
  }
}

function mergeByRefKeepAll<T extends { ref?: string }>(primary: T[], extra: T[]): T[] {
  const byRef = new Map<string, T>();
  for (const row of primary) {
    if (row?.ref) byRef.set(row.ref, row);
  }
  for (const row of extra) {
    if (row?.ref && !byRef.has(row.ref)) byRef.set(row.ref, row);
  }
  return [...byRef.values()];
}

/**
 * Recupera del -bak filas personalizadas (no-semilla) que desaparecieron del primary.
 * No reinyecta borrados de filas semilla: evita impedir deletes intencionales del catálogo base.
 */
function recoverCustomRowsFromBak<T extends { ref?: string }>(
  key: string,
  stored: T[],
  seedRefs: Set<string>,
): T[] {
  const bak = readBakArray<T>(key);
  if (!bak.length) return stored;
  if (!stored.length) return bak;

  const byRef = new Map<string, T>();
  for (const row of stored) {
    if (row?.ref) byRef.set(row.ref, row);
  }
  let restored = 0;
  for (const row of bak) {
    if (!row?.ref || byRef.has(row.ref)) continue;
    if (seedRefs.has(row.ref)) continue;
    byRef.set(row.ref, row);
    restored += 1;
  }
  return restored > 0 ? [...byRef.values()] : stored;
}

/** Lee préstamos guardados; null = primera vez / vacío tras wipe legado. */
function readStoredLoans(): LoanRow[] | null {
  if (typeof window === "undefined") return null;
  const primary = parseJson<LoanRow[]>(readRaw(DEMO_LOANS_KEY));
  if (primary && Array.isArray(primary)) {
    if (primary.length === 0) {
      const bak = readBakArray<LoanRow>(DEMO_LOANS_KEY);
      if (bak.length > 0) return bak;
      return null;
    }
    return recoverCustomRowsFromBak(DEMO_LOANS_KEY, primary, SEED_LOAN_REFS);
  }
  const bak = readBakArray<LoanRow>(DEMO_LOANS_KEY);
  if (bak.length > 0) return bak;
  return null;
}

function readStoredPayments(): PaymentRow[] | null {
  if (typeof window === "undefined") return null;
  const primary = parseJson<PaymentRow[]>(readRaw(DEMO_PAYMENTS_KEY));
  if (primary && Array.isArray(primary)) {
    if (primary.length === 0) {
      const bak = readBakArray<PaymentRow>(DEMO_PAYMENTS_KEY);
      if (bak.length > 0) return bak;
      return null;
    }
    return recoverCustomRowsFromBak(DEMO_PAYMENTS_KEY, primary, SEED_PAYMENT_REFS);
  }
  const bak = readBakArray<PaymentRow>(DEMO_PAYMENTS_KEY);
  if (bak.length > 0) return bak;
  return null;
}

/**
 * Clientes: conserva guardados (Martina, altas en calle, etc.).
 * Con paquete canónico instalado NO reinyecta la semilla demo COD-0… (evita duplicados viejos en Vercel).
 */
function isCanonicalPackageFlag() {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem("nexo-demo-bootstrap-package-v3") === "1" ||
      window.localStorage.getItem("nexo-demo-bootstrap-package-v2") === "1"
    );
  } catch {
    return false;
  }
}

/** Quita clientes/préstamos/pagos mock COD-0…7 que inflan admin y no van con cobradores. */
export function scrubLegacyMockDemoRows() {
  if (typeof window === "undefined" || !isCanonicalPackageFlag()) {
    return { clients: 0, loans: 0, payments: 0 };
  }

  const clients = readDemoJson<ClientRow[]>(DEMO_CLIENTS_KEY, []);
  const nextClients = clients.filter((row) => !LEGACY_MOCK_CLIENT_REFS.has(row.ref));
  if (nextClients.length !== clients.length) {
    writeDemoJson(DEMO_CLIENTS_KEY, nextClients);
  }

  const loans = readDemoJson<LoanRow[]>(DEMO_LOANS_KEY, []);
  const nextLoans = loans.filter((row) => !LEGACY_MOCK_CLIENT_REFS.has(row.clientRef));
  if (nextLoans.length !== loans.length) {
    writeDemoJson(DEMO_LOANS_KEY, nextLoans);
  }

  const dropLoanRefs = new Set(
    loans.filter((row) => LEGACY_MOCK_CLIENT_REFS.has(row.clientRef)).map((row) => row.ref),
  );
  const payments = readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []);
  const nextPayments = payments.filter((row) => !(row.loanRef && dropLoanRefs.has(row.loanRef)));
  if (nextPayments.length !== payments.length) {
    writeDemoJson(DEMO_PAYMENTS_KEY, nextPayments);
  }

  return {
    clients: clients.length - nextClients.length,
    loans: loans.length - nextLoans.length,
    payments: payments.length - nextPayments.length,
  };
}

export function loadDemoClients(seed: ClientRow[] = CLIENTS): ClientRow[] {
  disarmLegacyWipes();
  const packaged = isCanonicalPackageFlag();

  const stored = readDemoJson<ClientRow[] | null>(DEMO_CLIENTS_KEY, null);
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    const bak = readBakArray<ClientRow>(DEMO_CLIENTS_KEY);
    if (bak && bak.length > 0) {
      if (packaged) {
        const cleaned = bak.filter((row) => !LEGACY_MOCK_CLIENT_REFS.has(row.ref));
        writeDemoJson(DEMO_CLIENTS_KEY, cleaned);
        return cleaned;
      }
      const merged = mergeClientsKeepAll(bak, seed);
      writeDemoJson(DEMO_CLIENTS_KEY, merged);
      return merged;
    }
    return seed.map((row) => ({ ...row }));
  }

  // Con paquete: solo clientes reales; quita COD-0…7 si quedaron mezclados.
  if (packaged) {
    const cleaned = stored.filter((row) => !LEGACY_MOCK_CLIENT_REFS.has(row.ref));
    if (cleaned.length !== stored.length) {
      writeDemoJson(DEMO_CLIENTS_KEY, cleaned);
    }
    return cleaned;
  }

  const withCustom = recoverCustomRowsFromBak(DEMO_CLIENTS_KEY, stored, SEED_CLIENT_REFS);
  const merged = mergeClientsKeepAll(withCustom, seed);
  if (merged.length !== stored.length) {
    writeDemoJson(DEMO_CLIENTS_KEY, merged);
  }
  return merged;
}

function mergeClientsKeepAll(stored: ClientRow[], seed: ClientRow[]): ClientRow[] {
  return mergeByRefKeepAll(stored, seed.map((row) => ({ ...row })));
}

/** Pagos registrados (incluye cobros móviles con evidencia). */
export function loadDemoPayments(loans?: LoanRow[]): PaymentRow[] {
  disarmLegacyWipes();
  const packaged = isCanonicalPackageFlag();
  const stored = readStoredPayments();
  const firstBoot = stored === null;
  const merged = mergeStoredPaymentsWithSeed(stored ?? (packaged ? [] : PAYMENTS), {
    addMissingSeed: firstBoot && !packaged,
  });
  if (!loans) return merged;
  return normalizeAllPayments(merged, loans);
}

/** Carga pagos y préstamos sincronizados (fuente única para el panel). */
export function loadDemoPaymentsBundle() {
  disarmLegacyWipes();
  const packaged = isCanonicalPackageFlag();
  if (packaged) scrubLegacyMockDemoRows();
  const stored = readStoredPayments();
  const firstBoot = stored === null;
  // Paquete canónico: no mezclar pagos demo del seed (evita “doble historial”).
  const merged = mergeStoredPaymentsWithSeed(stored ?? (packaged ? [] : PAYMENTS), {
    addMissingSeed: firstBoot && !packaged,
  });
  const loans = loadDemoLoans(merged);
  const payments = normalizeAllPayments(merged, loans);
  // Rehidrata claves vacías tras wipe legado para que el siguiente arranque no “parta de cero”.
  if (firstBoot || !readRaw(DEMO_PAYMENTS_KEY)) {
    writeDemoJson(DEMO_PAYMENTS_KEY, payments);
  }
  if (!readRaw(DEMO_LOANS_KEY) || readStoredLoans() === null) {
    writeDemoJson(DEMO_LOANS_KEY, loans);
  }
  return { payments, loans };
}

/** Préstamos: usa guardados; si no hay clave / quedó [], semilla. Nunca vacía datos existentes. */
export function loadDemoLoans(payments: PaymentRow[] = loadDemoPayments()): LoanRow[] {
  disarmLegacyWipes();
  const packaged = isCanonicalPackageFlag();
  const stored = readStoredLoans();
  const base = stored ?? (packaged ? [] : LOANS);
  const filtered = packaged
    ? base.filter((row) => !LEGACY_MOCK_CLIENT_REFS.has(row.clientRef))
    : base;
  return syncAllLoans(filtered, payments);
}

/** Cierres de jornada: recupera -bak si la clave quedó vacía. */
export function loadDemoDayCloses<T extends { ref?: string }>(fallback: T[] = []): T[] {
  disarmLegacyWipes();
  const stored = readDemoJson<T[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, fallback);
  if (!Array.isArray(stored) || stored.length === 0) {
    const bak = readBakArray<T>(DEMO_COLLECTOR_DAY_CLOSES_KEY);
    if (bak.length > 0) {
      writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, bak);
      return bak;
    }
    return fallback;
  }
  const bak = readBakArray<T>(DEMO_COLLECTOR_DAY_CLOSES_KEY);
  if (!bak.length) return stored;
  const merged = mergeByRefKeepAll(stored, bak);
  if (merged.length > stored.length) {
    writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, merged);
    return merged;
  }
  return stored;
}

/** Movimientos de banco: nunca parte de [] si hay -bak; fusiona refs del respaldo. */
export function loadDemoBankMovements<T extends { ref?: string }>(fallback: T[] = []): T[] {
  disarmLegacyWipes();
  const stored = readDemoJson<T[] | null>(DEMO_BANK_MOVEMENTS_KEY, null);
  const bak = readBakArray<T>(DEMO_BANK_MOVEMENTS_KEY);
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    if (bak.length > 0) {
      writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, bak);
      return bak;
    }
    return fallback;
  }
  const merged = mergeByRefKeepAll(stored, bak);
  if (merged.length > stored.length) {
    writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, merged);
    return merged;
  }
  return stored;
}

/** Asignaciones de planilla: no pierde historial de otros días si la clave quedó vacía. */
export function loadDemoDailyAssignments<T>(fallback: T[] = []): T[] {
  disarmLegacyWipes();
  return readDemoJson<T[]>(DEMO_DAILY_ASSIGNMENTS_KEY, fallback);
}

/** Claves operativas a respaldar (negocio + banco). */
const DEMO_SNAPSHOT_KEYS = [
  DEMO_USERS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
] as const;

export type DemoSnapshot = {
  exportedAt: string;
  version: 1;
  keys: Record<string, unknown>;
  source?: string;
  note?: string;
};

/** Exporta todo el estado de negocio/banco del navegador (para archivo de seguridad). */
export function exportDemoSnapshot(): DemoSnapshot {
  disarmLegacyWipes();
  const keys: Record<string, unknown> = {};
  for (const key of DEMO_SNAPSHOT_KEYS) {
    const primary = parseJson<unknown>(readRaw(key));
    if (primary !== null && primary !== undefined) keys[key] = primary;
    const bak = parseJson<unknown>(readRaw(backupKey(key)));
    if (bak !== null && bak !== undefined) keys[backupKey(key)] = bak;
  }
  return { exportedAt: new Date().toISOString(), version: 1, keys };
}

export function downloadDemoSnapshot() {
  if (typeof window === "undefined") return;
  const snapshot = exportDemoSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const day = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `nexo-respaldo-${day}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Restaura un respaldo JSON. Recarga la página después. */
export function importDemoSnapshot(raw: string): { ok: true } | { ok: false; error: string } {
  if (typeof window === "undefined") return { ok: false, error: "Solo en el navegador." };
  try {
    const parsed = JSON.parse(raw) as DemoSnapshot;
    if (!parsed || parsed.version !== 1 || !parsed.keys || typeof parsed.keys !== "object") {
      return { ok: false, error: "Archivo de respaldo inválido." };
    }
    for (const [key, value] of Object.entries(parsed.keys)) {
      if (!key.startsWith("nexo-demo-")) continue;
      window.localStorage.setItem(key, JSON.stringify(value));
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo leer el archivo JSON." };
  }
}

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
  disarmLegacyWipes();
  let stored = readDemoJson<UserRow[]>(DEMO_USERS_KEY, []);
  if (!stored.length) {
    const v2 = readDemoJson<UserRow[]>(DEMO_USERS_KEY_V2, []);
    if (v2.length) {
      stored = v2;
      writeDemoJson(DEMO_USERS_KEY, v2);
    }
  }
  if (!stored.length) {
    return USERS.map((row) => normalizeUserPermissions(row));
  }

  const merged = stored.map((row) => normalizeStoredUser(row));
  for (const seed of USERS) {
    const idx = merged.findIndex((row) => row.ref === seed.ref);
    if (idx === -1) {
      const loginTaken = merged.some(
        (row) => row.login.toLowerCase() === seed.login.toLowerCase(),
      );
      if (!loginTaken) merged.push({ ...seed });
      continue;
    }
    if (SYSTEM_LOGINS.has(seed.login.toLowerCase())) {
      const login = seed.login.toLowerCase();
      merged[idx] = {
        ...merged[idx],
        login: seed.login,
        // Clave demo fija para el paquete sincronizado.
        password: seed.password || "123",
        roleRef: seed.roleRef,
        // Acceso por canal: admin solo truqui; cobrador/supervisor solo mobile.
        channels: [...seed.channels],
        collectorRef: seed.collectorRef ?? merged[idx].collectorRef,
        active: merged[idx].active !== false,
        permissions: seed.permissions?.length
          ? [...seed.permissions]
          : merged[idx].permissions,
        // Supervisor siempre Carlos; truqui mantiene nombre guardado si existe.
        name:
          login === "supervisor"
            ? seed.name
            : merged[idx].name?.trim() || seed.name,
      };
    }
  }
  return merged.map((row) => normalizeUserPermissions(row));
}
