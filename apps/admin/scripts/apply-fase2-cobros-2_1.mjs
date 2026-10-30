/**
 * Aplica el corte 2.1 de Fase 2 Cobros (sella visita + Prestar al liquidar).
 *
 *   set SUPABASE_DB_PASSWORD=...
 *   node apps/admin/scripts/apply-fase2-cobros-2_1.mjs
 *
 * Alternativa: pegar el .sql en SQL Editor del dashboard Supabase.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");
const projectRef = "connkdwezlwqlwgjerav";
const password = process.env.SUPABASE_DB_PASSWORD?.trim();
const rel = "supabase/migrations/20261030223000_fase2_cobro_sella_visita_prestar.sql";

if (!password) {
  console.error(
    [
      "Falta SUPABASE_DB_PASSWORD.",
      "1) Dashboard Supabase → Project Settings → Database → Database password",
      "2) SUPABASE_DB_PASSWORD=... node apps/admin/scripts/apply-fase2-cobros-2_1.mjs",
      `O pega el SQL: ${rel}`,
    ].join("\n"),
  );
  process.exit(1);
}

const file = path.join(root, rel);
if (!fs.existsSync(file)) {
  console.error("No existe", rel);
  process.exit(1);
}

const dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
console.log("Aplicando", rel);

const result = spawnSync(
  "npx",
  ["supabase", "db", "execute", "--db-url", dbUrl, "-f", file],
  { cwd: root, encoding: "utf8", shell: true },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status === 0) {
  console.log("OK Fase 2.1 aplicada.");
  process.exit(0);
}

const psql = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
if (psql.stdout) process.stdout.write(psql.stdout);
if (psql.stderr) process.stderr.write(psql.stderr);
if (psql.status !== 0) {
  console.error("Falló la migración.");
  process.exit(result.status || psql.status || 1);
}
console.log("OK Fase 2.1 aplicada (psql).");
