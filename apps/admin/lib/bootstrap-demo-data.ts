/**
 * Arranque del paquete canónico (Chrome).
 * v4: reinstala SIEMPRE una vez el snapshot de 10 clientes y borra bak de basura demo.
 * Luego retención 30 días; nunca reinyecta Carlos/Ana/etc.
 */
import recoverySeed from "@/lib/seeds/nexo-respaldo-recovery.json";
import {
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_USERS_KEY,
  scrubLegacyMockDemoRows,
  writeDemoJson,
  type DemoSnapshot,
} from "@/lib/demo-persist";
import { applyDataRetention } from "@/lib/data-retention";
import { COLLECTORS, USERS } from "@/lib/mock-data";

/** Subir versión = reinstala el paquete canónico una vez en cada navegador/origen. */
export const DEMO_BOOTSTRAP_PACKAGE_KEY = "nexo-demo-bootstrap-package-v4";

const PACKAGE_KEYS = [
  DEMO_CLIENTS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  DEMO_USERS_KEY,
  DEMO_COLLECTORS_KEY,
] as const;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pinBackupToCurrent(key: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) window.localStorage.setItem(`${key}-bak`, raw);
  } catch {
    /* ignore */
  }
}

/** Borra bak viejo antes de montar el paquete (evita que Carlos/Ana resuciten). */
function clearLegacyBackups() {
  if (typeof window === "undefined") return;
  for (const key of [DEMO_CLIENTS_KEY, DEMO_LOANS_KEY, DEMO_PAYMENTS_KEY]) {
    try {
      window.localStorage.removeItem(`${key}-bak`);
    } catch {
      /* ignore */
    }
  }
}

export function isCanonicalPackageInstalled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEMO_BOOTSTRAP_PACKAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function forceReinstallCanonicalPackage() {
  if (typeof window === "undefined") {
    return { restored: false, retention: null as null | { cutoff: string; changed: boolean } };
  }
  try {
    window.localStorage.removeItem(DEMO_BOOTSTRAP_PACKAGE_KEY);
    window.localStorage.removeItem("nexo-demo-bootstrap-package-v3");
    window.localStorage.removeItem("nexo-demo-bootstrap-package-v2");
  } catch {
    /* ignore */
  }
  return bootstrapProtectedDemoData();
}

export function bootstrapProtectedDemoData() {
  if (typeof window === "undefined") {
    return { restored: false, retention: null as null | { cutoff: string; changed: boolean } };
  }

  if (isCanonicalPackageInstalled()) {
    scrubLegacyMockDemoRows();
    return { restored: false, retention: applyDataRetention() };
  }

  clearLegacyBackups();

  const snapshot = recoverySeed as DemoSnapshot;
  const keys = snapshot.keys ?? {};

  writeDemoJson(DEMO_CLIENTS_KEY, asArray(keys[DEMO_CLIENTS_KEY]));
  writeDemoJson(DEMO_LOANS_KEY, asArray(keys[DEMO_LOANS_KEY]));
  writeDemoJson(DEMO_PAYMENTS_KEY, asArray(keys[DEMO_PAYMENTS_KEY]));
  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, asArray(keys[DEMO_COLLECTOR_DAY_CLOSES_KEY]));
  writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, asArray(keys[DEMO_BANK_MOVEMENTS_KEY]));
  writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, asArray(keys[DEMO_DAILY_ASSIGNMENTS_KEY]));
  writeDemoJson(DEMO_DAILY_LOGS_KEY, asArray(keys[DEMO_DAILY_LOGS_KEY]));
  writeDemoJson(DEMO_ROUTES_KEY, asArray(keys[DEMO_ROUTES_KEY]));

  const accounts = asArray(keys[DEMO_BANK_ACCOUNTS_KEY]);
  if (accounts.length) writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);

  const reconciliations = asArray(keys[DEMO_BANK_RECONCILIATIONS_KEY]);
  writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, reconciliations);

  writeDemoJson(DEMO_USERS_KEY, USERS.map((row) => ({ ...row })));
  writeDemoJson(
    DEMO_COLLECTORS_KEY,
    COLLECTORS.map((row) => ({ ...row })),
  );

  for (const key of PACKAGE_KEYS) {
    pinBackupToCurrent(key);
  }

  try {
    window.localStorage.setItem(DEMO_BOOTSTRAP_PACKAGE_KEY, "1");
    window.localStorage.setItem("nexo-demo-bootstrap-package-v3", "1");
    window.localStorage.setItem("nexo-demo-bootstrap-package-v2", "1");
    window.localStorage.setItem("nexo-demo-bootstrap-recovery-v1", "1");
  } catch {
    /* ignore */
  }

  scrubLegacyMockDemoRows();
  const retention = applyDataRetention();
  return { restored: true, retention };
}
