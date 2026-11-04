/**
 * Siembra data/users-catalog-cache.json desde Storage (o desde stdin JSON).
 * Uso en VPS tras release si /api/users falla por red a Supabase.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "data", "users-catalog-cache.json");

function loadEnv() {
  const raw = fs.readFileSync(path.join(root, ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}

function userRowToMirror(row) {
  return {
    ref: row.ref,
    login: row.login,
    email: row.email ?? null,
    password: row.password ?? null,
    name: row.name || "",
    phone: row.phone || "",
    document: row.document ?? null,
    role_ref: row.roleRef || row.role_ref || "",
    collector_ref: row.collectorRef ?? row.collector_ref ?? null,
    channels: Array.isArray(row.channels) ? row.channels : [],
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
    active: row.active !== false,
    last_access: row.lastAccess ?? row.last_access ?? null,
    updated_at: row.catalogUpdatedAt ?? row.updated_at ?? new Date().toISOString(),
  };
}

async function fromStorage() {
  loadEnv();
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing_supabase_env");
  const c = createClient(url, key, { auth: { persistSession: false } });
  const r = await c.storage.from("app-catalog").download("users.json");
  if (r.error) throw new Error(r.error.message);
  const text = await r.data.text();
  const parsed = JSON.parse(text);
  const raw = Array.isArray(parsed) ? parsed : parsed.users;
  return (raw || []).map(userRowToMirror).filter((u) => u.ref && u.login);
}

async function main() {
  let users;
  if (process.argv[2] === "--stdin") {
    const text = fs.readFileSync(0, "utf8");
    const parsed = JSON.parse(text);
    const raw = Array.isArray(parsed)
      ? parsed
      : parsed.users || parsed.rows || [];
    users = raw.map(userRowToMirror).filter((u) => u.ref && u.login);
  } else {
    users = await fromStorage();
  }
  if (!users.length) throw new Error("empty_users");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const payload = { at: new Date().toISOString(), users };
  fs.writeFileSync(outFile, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, count: users.length, file: outFile }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
  process.exit(1);
});
