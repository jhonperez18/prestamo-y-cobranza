/**
 * Borra del monitor de aparatos:
 * - cualquier reporte con host vercel.app (mundo viejo, ya no se usa)
 * - cualquier reporte con nombre Cristian (prueba eliminada del sistema)
 *
 * No toca usuarios, cobradores, cobros ni CIE. Solo Storage `app-catalog/devices/*.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, "..", ".env.local");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
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

const { data: files, error: listErr } = await client.storage.from(BUCKET).list(FOLDER, { limit: 500 });
if (listErr) {
  console.error("list", listErr.message);
  process.exit(1);
}

const entries = (files ?? []).filter((f) => f.name.endsWith(".json"));
const toRemove = [];

for (const file of entries) {
  const pathName = `${FOLDER}/${file.name}`;
  const { data, error } = await client.storage.from(BUCKET).download(pathName);
  if (error || !data) {
    console.warn("skip read", file.name, error?.message);
    continue;
  }
  let row;
  try {
    row = JSON.parse(await data.text());
  } catch {
    console.warn("skip parse", file.name);
    continue;
  }
  const host = String(row?.host || "");
  const name = String(row?.userName || "");
  const vercel = /vercel\.app/i.test(host);
  const cristian = /^cristian$/i.test(name.trim());
  if (!vercel && !cristian) continue;
  toRemove.push({
    path: pathName,
    reason: [vercel ? "vercel" : null, cristian ? "cristian" : null].filter(Boolean).join("+"),
    userName: name,
    host,
    deviceId: row?.deviceId || file.name,
  });
}

if (!toRemove.length) {
  console.log("Nada que borrar.");
  process.exit(0);
}

console.log(`A borrar: ${toRemove.length}`);
for (const row of toRemove) {
  console.log(`  - ${row.deviceId} · ${row.userName} · ${row.host} (${row.reason})`);
}

const { data: removed, error: delErr } = await client.storage
  .from(BUCKET)
  .remove(toRemove.map((r) => r.path));
if (delErr) {
  console.error("remove", delErr.message);
  process.exit(1);
}
console.log(`OK: borrados ${removed?.length ?? toRemove.length} reportes fantasma.`);
