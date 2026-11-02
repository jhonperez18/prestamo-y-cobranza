/**
 * 1) Basura >7 días sin reportar.
 * 2) Duplicados vivos: misma persona+host → deja el reporte más reciente.
 * No toca plata ni usuarios: solo Storage `app-catalog/devices/*.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const LIVE_MS = 36 * 60 * 60_000;
const root = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, "..", ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta SUPABASE en .env.local");
  process.exit(1);
}

const BUCKET = "app-catalog";
const FOLDER = "devices";
const client = createClient(url, key, { auth: { persistSession: false } });
const now = Date.now();

const { data: files, error: listErr } = await client.storage.from(BUCKET).list(FOLDER, { limit: 500 });
if (listErr) {
  console.error("list", listErr.message);
  process.exit(1);
}

const toRemove = [];
const live = [];

for (const file of (files ?? []).filter((f) => f.name.endsWith(".json"))) {
  const pathName = `${FOLDER}/${file.name}`;
  const { data, error } = await client.storage.from(BUCKET).download(pathName);
  if (error || !data) continue;
  let row;
  try {
    row = JSON.parse(await data.text());
  } catch {
    continue;
  }
  const at = Date.parse(String(row?.reportedAt || ""));
  if (!Number.isFinite(at)) continue;
  if (now - at > MAX_AGE_MS) {
    toRemove.push({
      path: pathName,
      why: ">7d",
      userName: row?.userName,
      host: row?.host,
      reportedAt: row?.reportedAt,
      deviceId: row?.deviceId || file.name,
    });
    continue;
  }
  if (now - at > LIVE_MS) continue;
  const userRef = String(row?.userRef || "").trim();
  const host = String(row?.host || "").trim();
  if (!userRef || /vercel\.app/i.test(host)) continue;
  live.push({
    path: pathName,
    userKey: `${userRef}|${host}`.toLowerCase(),
    at,
    userName: row?.userName,
    host,
    reportedAt: row?.reportedAt,
    deviceId: row?.deviceId || file.name,
  });
}

const best = new Map();
for (const row of live) {
  const prev = best.get(row.userKey);
  if (!prev || row.at > prev.at) best.set(row.userKey, row);
}
const keep = new Set([...best.values()].map((row) => row.path));
for (const row of live) {
  if (keep.has(row.path)) continue;
  toRemove.push({
    path: row.path,
    why: "duplicado",
    userName: row.userName,
    host: row.host,
    reportedAt: row.reportedAt,
    deviceId: row.deviceId,
  });
}

if (!toRemove.length) {
  console.log("Nada que borrar (>7 días ni duplicados).");
  process.exit(0);
}

console.log(`A borrar: ${toRemove.length}`);
for (const row of toRemove) {
  console.log(`  - [${row.why}] ${row.deviceId} · ${row.userName} · ${row.reportedAt}`);
}

const { error: delErr } = await client.storage.from(BUCKET).remove(toRemove.map((r) => r.path));
if (delErr) {
  console.error("remove", delErr.message);
  process.exit(1);
}
console.log(`OK: borrados ${toRemove.length} reportes.`);
