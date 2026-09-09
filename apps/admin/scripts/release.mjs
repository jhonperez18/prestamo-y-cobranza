/**
 * Contrato de producción — un solo camino, sin parches.
 *
 * Uso diario:
 *   git push origin main
 *   npm run verify:prod
 *
 * Emergencia (forzar rebuild en Vercel):
 *   npm run release:force
 */
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const PROJECT = "prestamo-y-cobranza";
const DOMAIN = "https://prestamo-y-cobranza.vercel.app";
const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(adminRoot, "..", "..");

function run(cmd, cwd = repoRoot) {
  return execSync(cmd, { encoding: "utf8", cwd, stdio: "inherit" });
}

function capture(cmd, cwd = repoRoot) {
  return execSync(cmd, { encoding: "utf8", cwd }).trim();
}

const mode = process.argv[2] || "verify";

const branch = capture("git rev-parse --abbrev-ref HEAD");
const sha = capture("git rev-parse --short HEAD");
const remoteSha = (() => {
  try {
    return capture("git rev-parse --short origin/main");
  } catch {
    return "";
  }
})();

if (branch !== "main") {
  console.error(`Abortado: estás en "${branch}". Producción solo sale de main.`);
  process.exit(1);
}

if (mode === "verify") {
  console.log("── Producción (contrato fijo) ──");
  console.log(`Proyecto Vercel : ${PROJECT}`);
  console.log(`URL canónica    : ${DOMAIN}`);
  console.log(`Commit local    : ${sha}`);
  console.log(`origin/main     : ${remoteSha || "(sin fetch)"}`);
  console.log("");
  console.log(`En el login DEBE verse: build ${remoteSha || sha}`);
  console.log(`Abrir solo: ${DOMAIN}`);
  console.log("No uses admin-*.vercel.app (proyecto viejo desconectado).");
  console.log("");
  run(`npx vercel link --yes --project ${PROJECT}`, adminRoot);
  run("npx vercel ls prestamo-y-cobranza", adminRoot);
  process.exit(0);
}

if (mode === "force") {
  console.log(`Forzando deploy ${sha} → ${DOMAIN}`);
  run(`npx vercel link --yes --project ${PROJECT}`, adminRoot);
  const out = execSync("npx vercel deploy --prod --force --yes", {
    encoding: "utf8",
    cwd: adminRoot,
    stdio: ["inherit", "pipe", "inherit"],
  });
  const match = String(out).match(
    /https:\/\/prestamo-y-cobranza-[a-z0-9]+-jhon-fredy-perezs-projects\.vercel\.app/,
  );
  if (!match) {
    console.error("No se encontró URL del deploy.");
    process.exit(1);
  }
  run(`npx vercel alias set ${match[0]} prestamo-y-cobranza.vercel.app`, adminRoot);
  try {
    run("npx vercel cache purge --yes --type cdn", adminRoot);
  } catch {
    /* opcional */
  }
  console.log(`\nListo → ${DOMAIN}`);
  console.log(`Login debe mostrar: build ${sha}`);
  process.exit(0);
}

console.error(`Modo desconocido: ${mode}. Usa verify | force`);
process.exit(1);
