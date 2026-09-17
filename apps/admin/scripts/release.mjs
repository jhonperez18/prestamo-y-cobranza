/**
 * Contrato de producción — un solo camino, sin parches.
 *
 * Uso diario (después de push a main + Ready):
 *   cd apps/admin && npm run verify:prod
 *
 * Emergencia (forzar rebuild en Vercel):
 *   npm run release:force
 *
 * Siempre: aliases alineados + purge de caché CDN/data (nada viejo arrastrado).
 * Además: espera Ready del commit, comprueba build en login y catálogo SQL.
 */
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const PROJECT = "prestamo-y-cobranza";
const CANONICAL_HOST = "prestamo-y-cobranza.vercel.app";
const LEGACY_HOST = "admin-jhon-fredy-perezs-projects.vercel.app";
const DOMAIN = `https://${CANONICAL_HOST}`;
const DEPLOY_URL_RE =
  /https:\/\/prestamo-y-cobranza-[a-z0-9]+-jhon-fredy-perezs-projects\.vercel\.app/;

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Raíz del monorepo: Vercel Root Directory = apps/admin. */
const repoRoot = join(adminRoot, "..", "..");

function run(cmd, cwd = repoRoot) {
  return execSync(cmd, { encoding: "utf8", cwd, stdio: "inherit" });
}

function capture(cmd, cwd = repoRoot) {
  return execSync(cmd, { encoding: "utf8", cwd }).trim();
}

function sleep(ms) {
  try {
    execSync(`powershell -NoProfile -Command "Start-Sleep -Milliseconds ${ms}"`, {
      stdio: "ignore",
    });
  } catch {
    /* ignore */
  }
}

function ensureLinked() {
  // Siempre el proyecto canónico. Nunca "admin" u otro.
  run(`npx vercel link --yes --project ${PROJECT}`, repoRoot);
  run(`npx vercel link --yes --project ${PROJECT}`, adminRoot);
  // `vercel link` a veces vuelve a appendear `.vercel` / `.env*` al .gitignore.
  try {
    capture("git checkout -- .gitignore", repoRoot);
  } catch {
    /* ignore */
  }
}

function latestProductionDeployUrl() {
  const out = capture(`npx vercel ls ${PROJECT}`, repoRoot);
  const lines = out.split(/\r?\n/);
  for (const line of lines) {
    if (!/Production/i.test(line) || !/Ready/i.test(line)) continue;
    const match = line.match(DEPLOY_URL_RE);
    if (match?.[0]) return match[0];
  }
  const fallback = out.match(DEPLOY_URL_RE);
  return fallback?.[0] || "";
}

/** Espera Ready del deploy más reciente (no aliasar Building). */
function waitForReadyProduction(timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const url = latestProductionDeployUrl();
    if (url) {
      console.log(`Deploy Ready → ${url}`);
      return url;
    }
    console.log("Sin deploy Ready aún… esperando");
    sleep(8000);
  }
  return "";
}

function syncAliases(deploymentUrl) {
  if (!deploymentUrl) {
    console.error("No hay URL de deploy Ready para sincronizar aliases.");
    process.exit(1);
  }
  run(`npx vercel alias set ${deploymentUrl} ${CANONICAL_HOST}`, repoRoot);
  run(`npx vercel alias set ${deploymentUrl} ${LEGACY_HOST}`, repoRoot);
}

/** Obligatorio: sin esto el celular/CDN arrastra HTML/JS viejo. */
function purgeCaches() {
  console.log("Purgando caché CDN…");
  run("npx vercel cache purge --yes --type cdn", repoRoot);
  console.log("Purgando caché Data…");
  try {
    run("npx vercel cache purge --yes --type data", repoRoot);
  } catch {
    console.warn("Aviso: no se pudo purgar Data cache (CDN sí se limpió).");
  }
}

function assertLoginBuild(expectedSha) {
  console.log("Comprobando build servido…");
  const raw = capture(`curl -fsSL "${DOMAIN}/api/ops/build-health"`);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("FALLO: build-health no devolvió JSON.");
    process.exit(1);
  }
  if (!data.build || String(data.build) !== String(expectedSha)) {
    console.error(
      `FALLO: build servido=${data.build ?? "?"} esperado=${expectedSha}. CDN o alias aún viejos.`,
    );
    process.exit(1);
  }
  console.log(`Build OK → ${data.build}`);
}

function assertCatalogHealth() {
  console.log("Comprobando catálogo SQL (clientes)…");
  const raw = capture(`curl -fsSL "${DOMAIN}/api/ops/catalog-health"`);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("FALLO: catalog-health no devolvió JSON.");
    process.exit(1);
  }
  if (!data.ok) {
    console.error(
      `FALLO: catálogo incompleto. clients=${data.clients ?? "?"} expectedMin=${data.expectedMin ?? "?"}`,
    );
    if (data.error) console.error(`  error: ${data.error}`);
    process.exit(1);
  }
  console.log(`Catálogo OK → ${data.clients} clientes (mín ${data.expectedMin})`);
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
  console.log(`Alias legado    : https://${LEGACY_HOST}`);
  console.log(`Commit local    : ${sha}`);
  console.log(`origin/main     : ${remoteSha || "(sin fetch)"}`);
  console.log("");
  console.log(`En el login DEBE verse: Código en este sitio: ${remoteSha || sha}`);
  console.log(`Abrir solo: ${DOMAIN}`);
  console.log("GitHub muestra código fuente, no la app. La app es Vercel.");
  console.log("");
  ensureLinked();
  const prod = waitForReadyProduction();
  if (prod) {
    console.log(`\nSincronizando aliases → ${prod}`);
    syncAliases(prod);
  }
  purgeCaches();
  const expect = remoteSha || sha;
  assertLoginBuild(expect);
  assertCatalogHealth();
  console.log(`\nListo de verdad. Login → build ${expect}. Catálogo SQL verificado.`);
  process.exit(0);
}

if (mode === "force") {
  console.log(`Forzando deploy ${sha} → ${DOMAIN}`);
  ensureLinked();
  const out = execSync("npx vercel deploy --prod --force --yes", {
    encoding: "utf8",
    cwd: repoRoot,
    stdio: ["inherit", "pipe", "inherit"],
  });
  const match = String(out).match(DEPLOY_URL_RE);
  if (!match?.[0]) {
    console.error("No se encontró URL del deploy.");
    process.exit(1);
  }
  syncAliases(match[0]);
  purgeCaches();
  assertLoginBuild(sha);
  assertCatalogHealth();
  console.log(`\nListo → ${DOMAIN}`);
  console.log(`Login debe mostrar: Código en este sitio: ${sha}`);
  process.exit(0);
}

console.error(`Modo desconocido: ${mode}. Usa verify | force`);
process.exit(1);
