/**
 * Borra reportes de aparatos con más de 7 días sin reportar.
 * No toca plata ni usuarios: solo Storage `app-catalog/devices/*.json`.
 * Así el monitor / morning-check no re-descarga basura (egress).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
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
  if (!Number.isFinite(at) || now - at <= MAX_AGE_MS) continue;
  toRemove.push({
    path: pathName,
    userName: row?.userName,
    host: row?.host,
    reportedAt: row?.reportedAt,
    deviceId: row?.deviceId || file.name,
  });
}

if (!toRemove.length) {
  console.log("Nada que borrar (>7 días).");
  process.exit(0);
}

console.log(`A borrar: ${toRemove.length}`);
for (const row of toRemove) {
  console.log(`  - ${row.deviceId} · ${row.userName} · ${row.reportedAt}`);
}

const { error: delErr } = await client.storage.from(BUCKET).remove(toRemove.map((r) => r.path));
if (delErr) {
  console.error("remove", delErr.message);
  process.exit(1);
}
console.log(`OK: borrados ${toRemove.length} reportes viejos.`);
