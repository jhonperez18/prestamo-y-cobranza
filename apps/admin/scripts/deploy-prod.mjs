/**
 * Deploy de emergencia / forzado al ÚNICO proyecto de producción.
 * Flujo normal: git push a main → Vercel despliega solo "prestamo-y-cobranza".
 * No usar el proyecto duplicado "admin" (genera URLs viejas / confusión).
 */
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DOMAIN = "prestamo-y-cobranza.vercel.app";
const PROJECT = "prestamo-y-cobranza";
const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: adminRoot, stdio: "inherit" });
}

function runCapture(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    cwd: adminRoot,
    stdio: ["inherit", "pipe", "inherit"],
  });
}

const sha = execSync("git rev-parse --short HEAD", {
  cwd: adminRoot,
  encoding: "utf8",
}).trim();

console.log(`Publicando ${sha} → https://${DOMAIN} (proyecto ${PROJECT})`);
run("node scripts/stamp-build.mjs");
run(`npx vercel link --yes --project ${PROJECT}`);

const out = runCapture("npx vercel deploy --prod --force --yes");
const match = String(out).match(
  /https:\/\/prestamo-y-cobranza-[a-z0-9]+-jhon-fredy-perezs-projects\.vercel\.app/,
);
if (!match) {
  console.error("No se encontró la URL del deploy en la salida.");
  process.exit(1);
}

run(`npx vercel alias set ${match[0]} ${DOMAIN}`);
try {
  run("npx vercel cache purge --yes --type cdn");
  run("npx vercel cache purge --yes --type data");
} catch {
  console.warn("No se pudo purgar caché Vercel (sigue el deploy).");
}

console.log(`\nListo → https://${DOMAIN}`);
console.log(`En el login debe verse: build ${sha}`);
console.log("Si ves otra URL (admin-*.vercel.app), ignore: es el proyecto viejo duplicado.");
