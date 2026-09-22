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

/** BOM en globals.css invalida :root → fondo/colores/login rotos. */
function assertGlobalsCssNoBom() {
  run("node scripts/assert-no-bom.mjs", adminRoot);
}

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

function deploymentSha(row) {
  return String(
    row?.meta?.githubCommitSha || row?.meta?.gitCommitSha || row?.meta?.gitlabCommitSha || "",
  ).slice(0, 7);
}

function parseCliJson(raw) {
  const startObj = raw.indexOf("{");
  const startArr = raw.indexOf("[");
  const start =
    startObj < 0 ? startArr : startArr < 0 ? startObj : Math.min(startObj, startArr);
  if (start < 0) throw new Error("sin json");
  const slice = raw.slice(start);
  try {
    return JSON.parse(slice);
  } catch (err) {
    const at = String(err?.message || "").match(/position (\d+)/);
    if (!at) throw err;
    return JSON.parse(slice.slice(0, Number(at[1])));
  }
}

function listProductionDeployments() {
  const raw = capture(`npx vercel ls ${PROJECT} --json`, repoRoot);
  const data = parseCliJson(raw);
  return Array.isArray(data?.deployments) ? data.deployments : [];
}

function latestProductionDeployUrl(expectedSha = "") {
  try {
    const deployments = listProductionDeployments();
    const want = String(expectedSha || "").slice(0, 7);
    if (want) {
      for (const row of deployments) {
        const state = String(row.state || row.readyState || "");
        const urlHost = String(row.url || "");
        if (urlHost && /READY/i.test(state) && deploymentSha(row) === want) {
          return urlHost.startsWith("http") ? urlHost : `https://${urlHost}`;
        }
      }
      return "";
    }
    for (const row of deployments) {
      const state = String(row.state || row.readyState || "");
      const target = String(row.target || "");
      const urlHost = String(row.url || "");
      if (!urlHost) continue;
      const isProd = /production/i.test(target) || Boolean(row.production);
      if (isProd && /READY/i.test(state)) {
        return urlHost.startsWith("http") ? urlHost : `https://${urlHost}`;
      }
    }
  } catch (err) {
    console.warn("Aviso: vercel ls --json falló.", err?.message || err);
  }
  return "";
}

/** Espera Ready del commit esperado (no aliasar deploy viejo ni ERROR). */
function waitForReadyProduction(expectedSha, timeoutMs = 240000) {
  const started = Date.now();
  const want = String(expectedSha || "").slice(0, 7);
  while (Date.now() - started < timeoutMs) {
    try {
      const deployments = listProductionDeployments();
      const newest = deployments[0];
      if (newest) {
        const state = String(newest.state || "");
        const sha = deploymentSha(newest);
        console.log(`Deploy ${sha || "?"} → ${state}`);
        if (want && sha === want && /ERROR|CANCELED/i.test(state)) {
          console.error(`FALLO: deploy ${want} terminó en ${state}.`);
          process.exit(1);
        }
      }
    } catch {
      /* ignore */
    }
    const url = latestProductionDeployUrl(want);
    if (url) {
      console.log(`Deploy Ready → ${url}`);
      return url;
    }
    console.log("Sin deploy Ready del commit aún… esperando");
    sleep(10000);
  }
  return latestProductionDeployUrl(want);
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

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function assertServiceRole() {
  console.log("Comprobando service role (C6.1)…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/health/supabase`);
  } catch (err) {
    console.error(`FALLO: health/supabase → ${err?.message || err}`);
    process.exit(1);
  }
  if (!data.serviceRole) {
    console.error(
      "FALLO: falta SUPABASE_SERVICE_ROLE_KEY en Vercel. Sin eso los mirrors C6.1 no escriben (anon ya no basta).",
    );
    process.exit(1);
  }
  console.log("Service role OK");
}

async function assertLoginBuild(expectedSha) {
  console.log("Comprobando build servido…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/ops/build-health`);
  } catch (err) {
    console.error(`FALLO: build-health → ${err?.message || err}`);
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

async function assertCatalogHealth() {
  console.log("Comprobando catálogo SQL (clientes)…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/ops/catalog-health`);
  } catch (err) {
    console.error(`FALLO: catalog-health → ${err?.message || err}`);
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

void (async () => {
  assertGlobalsCssNoBom();
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
  const expect = remoteSha || sha;
  const prod = waitForReadyProduction(expect);
  if (prod) {
    console.log(`\nSincronizando aliases → ${prod}`);
    syncAliases(prod);
  }
  purgeCaches();
  await assertLoginBuild(expect);
  await assertServiceRole();
  await assertCatalogHealth();
  console.log(`\nListo de verdad. Login → build ${expect}. Catálogo SQL + service role verificados.`);
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
  await assertLoginBuild(sha);
  await assertCatalogHealth();
  console.log(`\nListo → ${DOMAIN}`);
  console.log(`Login debe mostrar: Código en este sitio: ${sha}`);
  process.exit(0);
}

console.error(`Modo desconocido: ${mode}. Usa verify | force`);
process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

