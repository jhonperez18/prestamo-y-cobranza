/**
 * Arranque del paquete canónico (Chrome).
 * v21: Eliminar ruta es definitivo (nube + tumba local); solo 2 rutas base.
 * Al instalar, reemplaza estado anterior del origen (localhost ≠ vercel.app).
 */
import recoverySeed from "@/lib/seeds/nexo-respaldo-recovery.json";
import {
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  DEMO_BANK_SIDES_VERSION_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_COLLECTORS_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_DELETED_ROUTES_KEY,
  DEMO_LOANS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_USERS_KEY,
  DEMO_VIRGIN_HOLD_UNTIL_KEY,
  DEMO_VIRGIN_OPS_KEY,
  scrubLegacyMockDemoRows,
  type DemoSnapshot,
} from "@/lib/demo-persist";
import { needsVirginWipeReinstall } from "@/lib/demo-build-sync";
import { DEMO_PAYMENT_EVIDENCE_KEY } from "@/lib/payment-evidence-store";
import { applyDataRetention } from "@/lib/data-retention";
import { COLLECTORS, USERS } from "@/lib/mock-data";
import {
  DEMO_VIRGIN_WIPE_GEN_KEY,
  VIRGIN_WIPE_GEN,
} from "@/lib/virgin-lock";

/** Subir versión = reinstala el paquete canónico una vez en cada navegador/origen. */
export const DEMO_BOOTSTRAP_PACKAGE_KEY = "nexo-demo-bootstrap-package-v21";
export const DEMO_VIRGIN_WIPE_GEN = `v${VIRGIN_WIPE_GEN}`;

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
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_COLLECTOR_MONTH_CLOSES_KEY,
  DEMO_PAYMENT_EVIDENCE_KEY,
  DEMO_BANK_SIDES_VERSION_KEY,
  DEMO_DELETED_ROUTES_KEY,
] as const;

const PREVIOUS_PACKAGE_FLAGS = [
  "nexo-demo-bootstrap-package-v20",
  "nexo-demo-bootstrap-package-v19",
  "nexo-demo-bootstrap-package-v18",
  "nexo-demo-bootstrap-package-v17",
  "nexo-demo-bootstrap-package-v16",
  "nexo-demo-bootstrap-package-v15",
  "nexo-demo-bootstrap-package-v14",
  "nexo-demo-bootstrap-package-v13",
  "nexo-demo-bootstrap-package-v12",
  "nexo-demo-bootstrap-package-v11",
  "nexo-demo-bootstrap-package-v10",
  "nexo-demo-bootstrap-package-v9",
  "nexo-demo-bootstrap-package-v8",
  "nexo-demo-bootstrap-package-v7",
  "nexo-demo-bootstrap-package-v6",
  "nexo-demo-bootstrap-package-v5",
  "nexo-demo-bootstrap-package-v4",
  "nexo-demo-bootstrap-package-v3",
  "nexo-demo-bootstrap-package-v2",
  "nexo-demo-bootstrap-recovery-v1",
] as const;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Instala el paquete aunque sea [] (writeDemoJson protege vaciados accidentales). */
function forceInstallJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    const next = JSON.stringify(value);
    window.localStorage.setItem(key, next);
    window.localStorage.setItem(`${key}-bak`, next);
  } catch {
    /* ignore quota / private mode */
  }
}

function clearLegacyBackups() {
  if (typeof window === "undefined") return;
  for (const key of PACKAGE_KEYS) {
    try {
      window.localStorage.removeItem(`${key}-bak`);
    } catch {
      /* ignore */
    }
  }
}

/** Borra colas y restos; no deja “papelera” de cobros/gastos. */
function clearMirrorQueues() {
  if (typeof window === "undefined") return;
  const queues = [
    "nexo-demo-payment-mirror-queue",
    "nexo-demo-client-mirror-queue",
    "nexo-demo-loan-mirror-queue",
    "nexo-demo-ops-collectors-queue",
    "nexo-demo-ops-routes-queue",
    "nexo-demo-ops-route-deletes-queue",
    "nexo-demo-ops-day-closes-queue",
    "nexo-demo-ops-day-expenses-queue",
    "nexo-demo-ops-misc-queue",
    "nexo-demo-ops-assignments-queue",
    "nexo-demo-supervisor-route-seen",
    "nexo-dispatch-date",
    "nexo-demo-nequi-pool",
    "nexo-demo-loan-fund-pool",
  ];
  for (const key of queues) {
    try {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(`${key}-bak`);
    } catch {
      /* ignore */
    }
  }
}

/** Elimina cualquier *-bak nexo y restos operativos sueltos. */
function purgeOrphanDemoKeys() {
  if (typeof window === "undefined") return;
  try {
    const keepExact = new Set<string>([
      DEMO_USERS_KEY,
      DEMO_COLLECTORS_KEY,
      DEMO_BOOTSTRAP_PACKAGE_KEY,
      DEMO_VIRGIN_OPS_KEY,
      DEMO_VIRGIN_HOLD_UNTIL_KEY,
      "nexo-demo-served-build",
      ...PREVIOUS_PACKAGE_FLAGS,
    ]);
    const remove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.endsWith("-bak") && key.startsWith("nexo-demo-")) {
        remove.push(key);
        continue;
      }
      if (key.startsWith("nexo-demo-") && !keepExact.has(key) && !PACKAGE_KEYS.includes(key as (typeof PACKAGE_KEYS)[number])) {
        // Deja solo claves del paquete; quita huérfanos (no papelera).
        if (
          key.includes("queue") ||
          key.includes("trash") ||
          key.includes("papelera") ||
          key.includes("archive") ||
          key.includes("deleted")
        ) {
          remove.push(key);
        }
      }
    }
    for (const key of remove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

function requestCloudVirginWipe() {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/ops/wipe-virgin", {
      method: "POST",
      headers: { "x-nexo-wipe-gen": DEMO_VIRGIN_WIPE_GEN },
      cache: "no-store",
    });
  } catch {
    /* ignore offline */
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
    for (const key of PREVIOUS_PACKAGE_FLAGS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
  return bootstrapProtectedDemoData();
}

export function bootstrapProtectedDemoData() {
  if (typeof window === "undefined") {
    return { restored: false, retention: null as null | { cutoff: string; changed: boolean } };
  }

  // Gen nueva = reinstalar aunque el paquete v19/v20 ya estuviera marcado.
  if (needsVirginWipeReinstall()) {
    try {
      window.localStorage.removeItem(DEMO_BOOTSTRAP_PACKAGE_KEY);
      for (const key of PREVIOUS_PACKAGE_FLAGS) {
        window.localStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }

  if (isCanonicalPackageInstalled()) {
    scrubLegacyMockDemoRows();
    return { restored: false, retention: applyDataRetention() };
  }

  clearLegacyBackups();
  clearMirrorQueues();
  purgeOrphanDemoKeys();

  const snapshot = recoverySeed as unknown as DemoSnapshot;
  const keys = snapshot.keys ?? {};

  forceInstallJson(DEMO_CLIENTS_KEY, asArray(keys[DEMO_CLIENTS_KEY]));
  forceInstallJson(DEMO_LOANS_KEY, asArray(keys[DEMO_LOANS_KEY]));
  forceInstallJson(DEMO_PAYMENTS_KEY, asArray(keys[DEMO_PAYMENTS_KEY]));
  forceInstallJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, asArray(keys[DEMO_COLLECTOR_DAY_CLOSES_KEY]));
  forceInstallJson(DEMO_DAILY_ASSIGNMENTS_KEY, asArray(keys[DEMO_DAILY_ASSIGNMENTS_KEY]));
  forceInstallJson(DEMO_DAILY_LOGS_KEY, asArray(keys[DEMO_DAILY_LOGS_KEY]));
  forceInstallJson(DEMO_ROUTES_KEY, asArray(keys[DEMO_ROUTES_KEY]));
  // RUT-3.. duplicados viejos: quedan marcados borrados para que el pull no los reviva.
  forceInstallJson(DEMO_DELETED_ROUTES_KEY, ["RUT-3", "RUT-4", "RUT-5", "RUT-6"]);
  forceInstallJson(DEMO_MISC_PAYMENTS_KEY, []);
  forceInstallJson(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []);
  forceInstallJson(DEMO_COLLECTOR_MONTH_CLOSES_KEY, []);
  forceInstallJson(DEMO_PAYMENT_EVIDENCE_KEY, {});
  forceInstallJson(DEMO_BANK_SIDES_VERSION_KEY, 2);
  forceInstallJson(DEMO_BANK_MOVEMENTS_KEY, []);
  forceInstallJson(DEMO_BANK_RECONCILIATIONS_KEY, []);

  const accounts = asArray(keys[DEMO_BANK_ACCOUNTS_KEY]);
  forceInstallJson(
    DEMO_BANK_ACCOUNTS_KEY,
    accounts.length
      ? accounts.map((row) =>
          row && typeof row === "object"
            ? { ...(row as Record<string, unknown>), openingBalance: 0 }
            : row,
        )
      : [
          {
            ref: "BCA-1",
            name: "Cuenta operativa",
            bankName: "Bancolombia",
            accountNumber: "",
            accountType: "corriente",
            currency: "COP",
            country: "Colombia (CO)",
            province: "",
            address: "",
            active: true,
            openingBalance: 0,
          },
          {
            ref: "TRUQUI",
            name: "Principal",
            bankName: "Nequi",
            accountNumber: "",
            accountType: "caja",
            currency: "COP",
            country: "Colombia (CO)",
            province: "",
            address: "",
            active: true,
            openingBalance: 0,
          },
        ],
  );

  forceInstallJson(
    DEMO_USERS_KEY,
    USERS.map((row) => ({ ...row })),
  );
  forceInstallJson(
    DEMO_COLLECTORS_KEY,
    COLLECTORS.map((row) => ({ ...row })),
  );

  try {
    window.localStorage.setItem(DEMO_VIRGIN_OPS_KEY, "1");
    window.localStorage.setItem(DEMO_VIRGIN_WIPE_GEN_KEY, String(VIRGIN_WIPE_GEN));
    // 24h: no reimportar cobros/gastos/planilla remotos viejos mientras local está vacío.
    window.localStorage.setItem(
      DEMO_VIRGIN_HOLD_UNTIL_KEY,
      String(Date.now() + 24 * 60 * 60 * 1000),
    );
    window.localStorage.setItem(DEMO_BOOTSTRAP_PACKAGE_KEY, "1");
    for (const key of PREVIOUS_PACKAGE_FLAGS) {
      window.localStorage.setItem(key, "1");
    }
  } catch {
    /* ignore */
  }

  // Nube: borrar de raíz (sin papelera) cobros/gastos/planilla/clientes.
  requestCloudVirginWipe();

  scrubLegacyMockDemoRows();
  const retention = applyDataRetention();
  return { restored: true, retention };
}
