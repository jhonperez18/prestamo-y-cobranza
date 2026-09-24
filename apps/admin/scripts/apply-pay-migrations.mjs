/**
 * Aplica las migraciones de cobro atómico + bucket evidence.
 * Uso (una vez, con la contraseña de la DB del proyecto):
 *   set SUPABASE_DB_PASSWORD=...
 *   node apps/admin/scripts/apply-pay-migrations.mjs
 *
 * Alternativa: pegar los .sql en SQL Editor del dashboard Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const projectRef = "connkdwezlwqlwgjerav";
const password = process.env.SUPABASE_DB_PASSWORD?.trim();

const migrations = [
  "supabase/migrations/20260924100000_register_pay_atomic.sql",
  "supabase/migrations/20260924110000_evidence_storage_bucket.sql",
];

if (!password) {
  console.error(
    [
      "Falta SUPABASE_DB_PASSWORD.",
      "1) Dashboard Supabase → Project Settings → Database → Database password",
      "2) SUPABASE_DB_PASSWORD=... node apps/admin/scripts/apply-pay-migrations.mjs",
      "O pega los SQL en SQL Editor:",
      ...migrations.map((m) => `  - ${m}`),
    ].join("\n"),
  );
  process.exit(1);
}

const dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;

for (const rel of migrations) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.error("No existe", rel);
    process.exit(1);
  }
  console.log("Aplicando", rel);
  const result = spawnSync(
    "npx",
    ["supabase", "db", "execute", "--db-url", dbUrl, "-f", file],
    { cwd: root, encoding: "utf8", shell: true },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    // Fallback: psql si existe
    const psql = spawnSync(
      "psql",
      [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", file],
      { cwd: root, encoding: "utf8", shell: true },
    );
    if (psql.stdout) process.stdout.write(psql.stdout);
    if (psql.stderr) process.stderr.write(psql.stderr);
    if (psql.status !== 0) {
      console.error("Falló", rel);
      process.exit(result.status || psql.status || 1);
    }
  }
  console.log("OK", rel);
}

console.log("Migraciones de cobro aplicadas.");
