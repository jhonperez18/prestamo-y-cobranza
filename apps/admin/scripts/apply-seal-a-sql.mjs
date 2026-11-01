/**
 * Aplica la migración seal_day_close (A no pisa CIE) si hay DATABASE_URL / POSTGRES.
 * Si no: imprime la ruta del SQL para pegar en Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const sqlPath = path.join(
  root,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261101120000_seal_day_close_a_no_pisa_cie.sql",
);
// root = apps/admin/scripts → ../../../supabase = repo/supabase
const sql = fs.readFileSync(sqlPath, "utf8");
const dbUrl =
  env.DATABASE_URL ||
  env.POSTGRES_URL ||
  env.SUPABASE_DB_URL ||
  env.DIRECT_URL ||
  "";

if (!dbUrl) {
  console.log("Sin DATABASE_URL. Pegue este SQL en Supabase → SQL Editor:");
  console.log(sqlPath);
  process.exit(0);
}

const { default: pg } = await import("pg").catch(() => ({ default: null }));
if (!pg) {
  console.log("Sin paquete pg. Pegue el SQL en Supabase:", sqlPath);
  process.exit(0);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log("OK: seal_day_close aplicado");
} finally {
  await client.end();
}
