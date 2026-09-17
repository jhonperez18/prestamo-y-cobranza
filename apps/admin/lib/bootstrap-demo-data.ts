/**
 * Arranque del paquete canónico (Chrome).
 * v16: re-limpia virgen (banco/pagos) — evita que un origen viejo reinyecte historial.
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
  DEMO_LOANS_KEY,
  DEMO_MISC_PAYMENTS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_USERS_KEY,
  scrubLegacyMockDemoRows,
  type DemoSnapshot,
} from "@/lib/demo-persist";
import { DEMO_PAYMENT_EVIDENCE_KEY } from "@/lib/payment-evidence-store";
import { applyDataRetention } from "@/lib/data-retention";
import { COLLECTORS, USERS } from "@/lib/mock-data";

/** Subir versión = reinstala el paquete canónico una vez en cada navegador/origen. */
export const DEMO_BOOTSTRAP_PACKAGE_KEY = "nexo-demo-bootstrap-package-v16";

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
] as const;

const PREVIOUS_PACKAGE_FLAGS = [
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

function clearMirrorQueues() {
  if (typeof window === "undefined") return;
  const queues = [
    "nexo-demo-payment-mirror-queue",
    "nexo-demo-client-mirror-queue",
    "nexo-demo-loan-mirror-queue",
    "nexo-demo-ops-collectors-queue",
    "nexo-demo-ops-routes-queue",
    "nexo-demo-ops-day-closes-queue",
    "nexo-demo-ops-day-expenses-queue",
    "nexo-demo-ops-misc-queue",
    "nexo-demo-ops-assignments-queue",
    "nexo-demo-supervisor-route-seen",
    "nexo-dispatch-date",
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

  if (isCanonicalPackageInstalled()) {
    scrubLegacyMockDemoRows();
    return { restored: false, retention: applyDataRetention() };
  }

  clearLegacyBackups();
  clearMirrorQueues();

  const snapshot = recoverySeed as unknown as DemoSnapshot;
  const keys = snapshot.keys ?? {};

  forceInstallJson(DEMO_CLIENTS_KEY, asArray(keys[DEMO_CLIENTS_KEY]));
  forceInstallJson(DEMO_LOANS_KEY, asArray(keys[DEMO_LOANS_KEY]));
  forceInstallJson(DEMO_PAYMENTS_KEY, asArray(keys[DEMO_PAYMENTS_KEY]));
  forceInstallJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, asArray(keys[DEMO_COLLECTOR_DAY_CLOSES_KEY]));
  forceInstallJson(DEMO_DAILY_ASSIGNMENTS_KEY, asArray(keys[DEMO_DAILY_ASSIGNMENTS_KEY]));
  forceInstallJson(DEMO_DAILY_LOGS_KEY, asArray(keys[DEMO_DAILY_LOGS_KEY]));
  forceInstallJson(DEMO_ROUTES_KEY, asArray(keys[DEMO_ROUTES_KEY]));
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
      ? accounts
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
    window.localStorage.setItem(DEMO_BOOTSTRAP_PACKAGE_KEY, "1");
    for (const key of PREVIOUS_PACKAGE_FLAGS) {
      window.localStorage.setItem(key, "1");
    }
  } catch {
    /* ignore */
  }

  scrubLegacyMockDemoRows();
  const retention = applyDataRetention();
  return { restored: true, retention };
}
