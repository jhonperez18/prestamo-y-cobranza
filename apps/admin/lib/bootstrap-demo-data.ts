/**
 * Arranque del paquete canónico (lo que se ve en Chrome local recuperado).
 * v2: instala UNA vez el snapshot completo (reemplaza basura vieja de Vercel/otros orígenes).
 * Luego solo aplica retención 30 días; no vuelve a mezclar semilla demo.
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
  writeDemoJson,
  type DemoSnapshot,
} from "@/lib/demo-persist";
import { applyDataRetention } from "@/lib/data-retention";
import { COLLECTORS, USERS } from "@/lib/mock-data";

/** Subir versión = reinstala el paquete canónico una vez en cada navegador/origen. */
export const DEMO_BOOTSTRAP_PACKAGE_KEY = "nexo-demo-bootstrap-package-v2";

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

/** Evita que -bak de Vercel/Chrome viejo reinyecte COD-0… tras instalar el paquete. */
function pinBackupToCurrent(key: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) window.localStorage.setItem(`${key}-bak`, raw);
  } catch {
    /* ignore */
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

/** Borra el flag v2 y vuelve a montar el paquete Chrome (útil en /recovery). */
export function forceReinstallCanonicalPackage() {
  if (typeof window === "undefined") {
    return { restored: false, retention: null as null | { cutoff: string; changed: boolean } };
  }
  try {
    window.localStorage.removeItem(DEMO_BOOTSTRAP_PACKAGE_KEY);
  } catch {
    /* ignore */
  }
  return bootstrapProtectedDemoData();
}

/**
 * Instala el paquete Chrome (días 3–5 + banco + clientes reales) y usuarios de acceso.
 * No mezcla COD-0… demo viejos. Idempotente tras el flag v2.
 */
export function bootstrapProtectedDemoData() {
  if (typeof window === "undefined") {
    return { restored: false, retention: null as null | { cutoff: string; changed: boolean } };
  }

  if (isCanonicalPackageInstalled()) {
    return { restored: false, retention: applyDataRetention() };
  }

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

  // Accesos del paquete: truqui / Carlos / Juan / Lina / Diego (clave 123).
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
    // Apaga merge v1 viejo si existía.
    window.localStorage.setItem("nexo-demo-bootstrap-recovery-v1", "1");
  } catch {
    /* ignore */
  }

  const retention = applyDataRetention();
  return { restored: true, retention };
}
