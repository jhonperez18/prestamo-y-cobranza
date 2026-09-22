/**
 * Catálogo de cuentas bancarias compartido (localhost = Vercel).
 * Storage `app-catalog/bank-accounts.json` — sin segunda raíz por dominio.
 */
import { createMirrorServerClient, createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeBankAccount,
  type BankAccount,
  type BankAccountType,
} from "@/lib/bank";
import {
  DEMO_BANK_ACCOUNTS_KEY,
  readDemoJson,
  writeDemoJson,
} from "@/lib/demo-persist";

export const DEMO_BANK_ACCOUNT_MIRROR_QUEUE_KEY = "nexo-demo-bank-account-mirror-queue";
export const DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY = "nexo-demo-bank-account-pull-shield";
const CLIENT_PULL_SHIELD_MS = 15 * 60 * 1000;

const STORAGE_BUCKET = "app-catalog";
const STORAGE_PATH = "bank-accounts.json";

type CatalogFile = {
  updatedAt: string;
  accounts: BankAccount[];
};

type PullShieldEntry = { account: BankAccount; until: number };

function stampAccount(row: BankAccount): BankAccount {
  return normalizeBankAccount({
    ...row,
    updatedAt: row.updatedAt?.trim() || new Date().toISOString(),
  });
}

function accountSignature(row: BankAccount) {
  return [
    row.ref,
    row.name,
    row.bankName,
    row.accountNumber,
    row.accountType,
    row.currency,
    row.country,
    row.province,
    row.address,
    row.active ? 1 : 0,
    Number(row.openingBalance) || 0,
  ].join("|");
}

function readQueue() {
  return readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNT_MIRROR_QUEUE_KEY, []).filter(
    (row) => row?.ref,
  );
}

function writeQueue(rows: BankAccount[]) {
  writeDemoJson(DEMO_BANK_ACCOUNT_MIRROR_QUEUE_KEY, rows);
}

function readPullShield(): Map<string, BankAccount> {
  const raw = readDemoJson<PullShieldEntry[]>(DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY, []);
  const now = Date.now();
  const alive: PullShieldEntry[] = [];
  const byRef = new Map<string, BankAccount>();
  for (const entry of raw) {
    if (!entry?.account?.ref || !entry.until || entry.until <= now) continue;
    alive.push(entry);
    byRef.set(entry.account.ref, entry.account);
  }
  if (alive.length !== raw.length) writeDemoJson(DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY, alive);
  return byRef;
}

function armPullShield(account: BankAccount) {
  if (!account?.ref) return;
  const raw = readDemoJson<PullShieldEntry[]>(DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY, []);
  const until = Date.now() + CLIENT_PULL_SHIELD_MS;
  const next = raw.filter((entry) => entry?.account?.ref && entry.account.ref !== account.ref);
  next.push({ account, until });
  writeDemoJson(DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY, next);
}

function prunePullShield(remoteByRef: Map<string, BankAccount>) {
  const raw = readDemoJson<PullShieldEntry[]>(DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY, []);
  const now = Date.now();
  const next = raw.filter((entry) => {
    if (!entry?.account?.ref || !entry.until || entry.until <= now) return false;
    const remote = remoteByRef.get(entry.account.ref);
    if (!remote) return true;
    return accountSignature(entry.account) !== accountSignature(remote);
  });
  if (next.length !== raw.length) writeDemoJson(DEMO_BANK_ACCOUNT_PULL_SHIELD_KEY, next);
}

async function readStorageCatalog(): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  accounts: BankAccount[];
}> {
  const supabase = createSupabaseAdminClient() ?? createMirrorServerClient();
  if (!supabase) {
    return { ok: true, skipped: true, reason: "supabase_not_configured", accounts: [] };
  }
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(STORAGE_PATH);
  if (error) {
    if (/not found|No such file|404/i.test(error.message)) {
      return { ok: true, accounts: [] };
    }
    return { ok: false, error: error.message, accounts: [] };
  }
  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as CatalogFile | BankAccount[];
    const raw = Array.isArray(parsed) ? parsed : parsed.accounts;
    const accounts = (raw ?? [])
      .filter((row) => row?.ref && row?.name)
      .map((row) => normalizeBankAccount(row as BankAccount));
    return { ok: true, accounts };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "invalid_bank_accounts_catalog",
      accounts: [],
    };
  }
}

async function writeStorageCatalog(accounts: BankAccount[]) {
  const supabase = createSupabaseAdminClient() ?? createMirrorServerClient();
  if (!supabase) {
    return { ok: true as const, skipped: true as const, reason: "supabase_not_configured" };
  }
  const payload: CatalogFile = {
    updatedAt: new Date().toISOString(),
    accounts: accounts
      .map((row) => stampAccount(normalizeBankAccount(row)))
      .filter((row) => row.ref)
      .sort((a, b) => a.ref.localeCompare(b.ref, "es")),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(STORAGE_PATH, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

export async function mirrorBankAccountToSupabase(account: BankAccount) {
  const normalized = stampAccount(normalizeBankAccount(account));
  if (!normalized.ref) {
    return { ok: true as const, skipped: true as const, reason: "invalid_account" };
  }
  const current = await readStorageCatalog();
  if (!current.ok) return { ok: false as const, error: current.error || "read_failed" };
  if (current.skipped) {
    return { ok: true as const, skipped: true as const, reason: current.reason };
  }
  const byRef = new Map(current.accounts.map((row) => [row.ref, row]));
  byRef.set(normalized.ref, normalized);
  return writeStorageCatalog(Array.from(byRef.values()));
}

export async function fetchBankAccountsFromSupabase() {
  const storage = await readStorageCatalog();
  if (storage.skipped) {
    return {
      ok: true as const,
      skipped: true as const,
      reason: storage.reason,
      accounts: [] as BankAccount[],
    };
  }
  if (!storage.ok) {
    return {
      ok: false as const,
      error: storage.error || "fetch_failed",
      accounts: [] as BankAccount[],
    };
  }
  return { ok: true as const, accounts: storage.accounts };
}

async function postMirror(account: BankAccount) {
  const res = await fetch("/api/bank-accounts/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account }),
    keepalive: true,
  });
  const json = (await res.json()) as {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    error?: string;
  };
  return { res, json };
}

export async function persistBankAccountToSupabase(account: BankAccount) {
  if (typeof window === "undefined") {
    return { ok: true as const, skipped: true as const, reason: "ssr" };
  }
  const stamped = stampAccount(account);
  try {
    const { res, json } = await postMirror(stamped);
    if (!res.ok || !json.ok) {
      const q = readQueue().filter((r) => r.ref !== stamped.ref);
      q.push(stamped);
      writeQueue(q);
      return { ok: false as const, error: json.error || `http_${res.status}` };
    }
    if (!json.skipped) {
      writeQueue(readQueue().filter((r) => r.ref !== stamped.ref));
      armPullShield(stamped);
    }
    return { ok: true as const, skipped: json.skipped };
  } catch (err) {
    const q = readQueue().filter((r) => r.ref !== stamped.ref);
    q.push(stamped);
    writeQueue(q);
    return { ok: false as const, error: err instanceof Error ? err.message : "network" };
  }
}

export function queueBankAccountMirror(account: BankAccount) {
  if (typeof window === "undefined") return;
  const stamped = stampAccount(account);
  const q = readQueue().filter((r) => r.ref !== stamped.ref);
  q.push(stamped);
  writeQueue(q);
  armPullShield(stamped);
  void persistBankAccountToSupabase(stamped);
}

export function queueBankAccountsMirror(accounts: BankAccount[]) {
  for (const row of accounts) queueBankAccountMirror(row);
}

export async function flushBankAccountMirrorQueues() {
  if (typeof window === "undefined") return;
  const accounts = readQueue();
  const left: BankAccount[] = [];
  for (const account of accounts) {
    try {
      const { res, json } = await postMirror(stampAccount(account));
      if (res.ok && json.ok && !json.skipped) {
        armPullShield(account);
        continue;
      }
      if (res.ok && json.ok && json.skipped && json.reason === "invalid_account") continue;
      left.push(account);
    } catch {
      left.push(account);
    }
  }
  writeQueue(left);
}

function mergePreferPendingLocal(
  local: BankAccount[],
  remote: BankAccount[],
  pendingByRef: Map<string, BankAccount>,
): { merged: BankAccount[]; changed: boolean } {
  const localByRef = new Map(local.map((row) => [row.ref, row]));
  const merged: BankAccount[] = [];
  let changed = false;
  const seen = new Set<string>();

  for (const remoteRow of remote) {
    if (!remoteRow?.ref) continue;
    seen.add(remoteRow.ref);
    const pending = pendingByRef.get(remoteRow.ref);
    const localRow = localByRef.get(remoteRow.ref);
    if (pending) {
      if (!localRow || accountSignature(pending) !== accountSignature(localRow)) changed = true;
      if (accountSignature(pending) !== accountSignature(remoteRow)) changed = true;
      merged.push(pending);
      localByRef.delete(remoteRow.ref);
      continue;
    }
    if (!localRow) {
      merged.push(remoteRow);
      changed = true;
      continue;
    }
    const localTs = Date.parse(String(localRow.updatedAt || "")) || 0;
    const remoteTs = Date.parse(String(remoteRow.updatedAt || "")) || 0;
    if (accountSignature(localRow) === accountSignature(remoteRow)) {
      const winner = remoteTs > localTs ? remoteRow : localRow;
      if (winner !== localRow) changed = true;
      merged.push(winner);
      localByRef.delete(remoteRow.ref);
      continue;
    }
    const winner = remoteTs > localTs ? remoteRow : localRow;
    if (accountSignature(winner) !== accountSignature(localRow)) changed = true;
    merged.push(winner);
    localByRef.delete(remoteRow.ref);
  }

  for (const row of localByRef.values()) {
    const pending = pendingByRef.get(row.ref);
    merged.push(pending ?? row);
  }
  for (const [ref, row] of pendingByRef) {
    if (seen.has(ref) || localByRef.has(ref)) continue;
    merged.push(row);
    changed = true;
  }
  return { merged, changed };
}

export type PullBankAccountsResult = {
  ok: boolean;
  changed: boolean;
  reason?: string;
};

/** Pull cuentas: cola/escudo y updatedAt local ganan sobre remoto viejo. */
export async function pullRemoteBankAccountsIntoDemo(): Promise<PullBankAccountsResult> {
  if (typeof window === "undefined") {
    return { ok: true, changed: false, reason: "ssr" };
  }
  try {
    const res = await fetch("/api/bank-accounts", { cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      error?: string;
      accounts?: BankAccount[];
    };
    if (!res.ok || !body.ok) {
      return { ok: false, changed: false, reason: body.error || "bank_accounts_pull_failed" };
    }
    if (body.skipped) return { ok: true, changed: false, reason: "skipped" };

    const remote = (body.accounts ?? [])
      .filter((row) => row?.ref && row?.name)
      .map((row) => normalizeBankAccount(row));
    const local = readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount);
    const pendingByRef = new Map(readQueue().map((row) => [row.ref, row]));
    for (const [ref, row] of readPullShield()) {
      if (!pendingByRef.has(ref)) pendingByRef.set(ref, row);
    }
    const merge = mergePreferPendingLocal(local, remote, pendingByRef);
    if (merge.changed || (local.length === 0 && remote.length > 0)) {
      writeDemoJson(
        DEMO_BANK_ACCOUNTS_KEY,
        merge.merged.length ? merge.merged : remote,
      );
    }
    prunePullShield(new Map(remote.map((row) => [row.ref, row])));
    return { ok: true, changed: merge.changed || (local.length === 0 && remote.length > 0) };
  } catch (err) {
    return {
      ok: false,
      changed: false,
      reason: err instanceof Error ? err.message : "bank_accounts_pull_failed",
    };
  }
}

/** Sube cuentas locales que la nube aún no tiene o tiene viejas (PC padre). */
export async function reconcileLocalBankAccountsToRemote() {
  if (typeof window === "undefined") return { pushed: 0, failed: 0 };
  const local = readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []).map(normalizeBankAccount);
  if (!local.length) return { pushed: 0, failed: 0 };

  let remote: BankAccount[] = [];
  try {
    const res = await fetch("/api/bank-accounts", { cache: "no-store" });
    const body = (await res.json()) as {
      ok?: boolean;
      skipped?: boolean;
      accounts?: BankAccount[];
    };
    if (!res.ok || !body.ok || body.skipped) return { pushed: 0, failed: 0 };
    remote = (body.accounts ?? []).map((row) => normalizeBankAccount(row));
  } catch {
    return { pushed: 0, failed: 0 };
  }

  const remoteByRef = new Map(remote.map((row) => [row.ref, row]));
  let pushed = 0;
  let failed = 0;
  for (const row of local) {
    const remoteRow = remoteByRef.get(row.ref);
    if (remoteRow && accountSignature(row) === accountSignature(remoteRow)) continue;
    const localTs = Date.parse(String(row.updatedAt || "")) || 0;
    const remoteTs = Date.parse(String(remoteRow?.updatedAt || "")) || 0;
    if (remoteRow && remoteTs > localTs) continue;
    const result = await persistBankAccountToSupabase(row);
    if (result.ok && !result.skipped) pushed += 1;
    else if (!result.ok) failed += 1;
  }
  return { pushed, failed };
}

export type { BankAccountType };
