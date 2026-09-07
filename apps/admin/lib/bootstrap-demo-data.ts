/**
 * Arranque seguro:
 * 1) Fusiona el respaldo recuperado (días 3–5 + banco + Martina) sin pisar datos más nuevos.
 * 2) Aplica retención de 30 días.
 */
import recoverySeed from "@/lib/seeds/nexo-respaldo-recovery.json";
import {
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_CLIENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_LOANS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  DEMO_BANK_ACCOUNTS_KEY,
  DEMO_BANK_RECONCILIATIONS_KEY,
  readDemoJson,
  writeDemoJson,
  type DemoSnapshot,
} from "@/lib/demo-persist";
import { applyDataRetention } from "@/lib/data-retention";

export const DEMO_BOOTSTRAP_MERGED_KEY = "nexo-demo-bootstrap-recovery-v1";

function mergeById<T extends Record<string, unknown>>(
  existing: T[],
  incoming: T[],
  idOf: (row: T) => string | undefined,
): T[] {
  const map = new Map<string, T>();
  for (const row of existing) {
    const id = idOf(row);
    if (id) map.set(id, row);
  }
  for (const row of incoming) {
    const id = idOf(row);
    if (!id) continue;
    if (!map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Restaura/fusiona el snapshot recuperado y deja historial bajo política de 30 días.
 * Idempotente: se puede llamar en cada arranque; no borra lo que ya tengas de más.
 */
export function bootstrapProtectedDemoData() {
  if (typeof window === "undefined") return { restored: false, retention: null as null | { cutoff: string; changed: boolean } };

  const snapshot = recoverySeed as DemoSnapshot;
  const keys = snapshot.keys ?? {};

  // Clientes / préstamos / planilla / cobros / banco: keep-all por ref.
  const clients = mergeById(
    readDemoJson(DEMO_CLIENTS_KEY, []),
    asArray(keys[DEMO_CLIENTS_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_CLIENTS_KEY, clients);

  const loans = mergeById(
    readDemoJson(DEMO_LOANS_KEY, []),
    asArray(keys[DEMO_LOANS_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_LOANS_KEY, loans);

  const payments = mergeById(
    readDemoJson(DEMO_PAYMENTS_KEY, []),
    asArray(keys[DEMO_PAYMENTS_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_PAYMENTS_KEY, payments);

  const closes = mergeById(
    readDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
    asArray(keys[DEMO_COLLECTOR_DAY_CLOSES_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_COLLECTOR_DAY_CLOSES_KEY, closes);

  const movements = mergeById(
    readDemoJson(DEMO_BANK_MOVEMENTS_KEY, []),
    asArray(keys[DEMO_BANK_MOVEMENTS_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_BANK_MOVEMENTS_KEY, movements);

  const assignments = mergeById(
    readDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, []),
    asArray(keys[DEMO_DAILY_ASSIGNMENTS_KEY]),
    (row) => String((row as { itemId?: string }).itemId ?? (row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_DAILY_ASSIGNMENTS_KEY, assignments);

  const logs = mergeById(
    readDemoJson(DEMO_DAILY_LOGS_KEY, []),
    asArray(keys[DEMO_DAILY_LOGS_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_DAILY_LOGS_KEY, logs);

  const routes = mergeById(
    readDemoJson(DEMO_ROUTES_KEY, []),
    asArray(keys[DEMO_ROUTES_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  writeDemoJson(DEMO_ROUTES_KEY, routes);

  const accounts = mergeById(
    readDemoJson(DEMO_BANK_ACCOUNTS_KEY, []),
    asArray(keys[DEMO_BANK_ACCOUNTS_KEY]),
    (row) => String((row as { ref?: string }).ref ?? ""),
  );
  if (accounts.length) writeDemoJson(DEMO_BANK_ACCOUNTS_KEY, accounts);

  const reconciliations = mergeById(
    readDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, []),
    asArray(keys[DEMO_BANK_RECONCILIATIONS_KEY]),
    (row) => {
      const r = row as { accountRef?: string; period?: string; ref?: string };
      return r.ref || (r.accountRef && r.period ? `${r.accountRef}:${r.period}` : "");
    },
  );
  if (reconciliations.length) writeDemoJson(DEMO_BANK_RECONCILIATIONS_KEY, reconciliations);

  try {
    window.localStorage.setItem(DEMO_BOOTSTRAP_MERGED_KEY, "1");
  } catch {
    /* ignore */
  }

  const retention = applyDataRetention();
  return { restored: true, retention };
}
