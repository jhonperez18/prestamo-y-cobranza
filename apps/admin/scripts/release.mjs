/**
 * Contrato de producción — un solo camino: el VPS (https://autoprestamos.org).
 *
 * Publicar (después de commit en main):
 *   cd apps/admin && npm run release
 *     → git push origin main · VPS: pull + build + reinicio · revisión completa.
 *
 * Solo revisar lo que está en el aire:
 *   cd apps/admin && npm run verify:prod
 *
 * Si el build del VPS falla, la app sigue con la versión anterior (no se reinicia).
 */
import { execFileSync, execSync } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DOMAIN = "https://autoprestamos.org";
const VPS = process.env.VPS_SSH || "root@162.35.122.243";
const VPS_KEY = process.env.VPS_SSH_KEY || join(homedir(), ".ssh", "id_ed25519");
const VPS_APP = "/var/www/autoprestamos";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(adminRoot, "..", "..");

function run(cmd, cwd = repoRoot) {
  return execSync(cmd, { encoding: "utf8", cwd, stdio: "inherit" });
}

function capture(cmd, cwd = repoRoot) {
  return execSync(cmd, { encoding: "utf8", cwd }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ssh(script) {
  return execFileSync(
    "ssh",
    ["-i", VPS_KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", VPS, "bash -s"],
    { input: script.replace(/\r/g, ""), encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] },
  );
}

/** Pull + build en el VPS. Solo reinicia si el build salió bien. */
function deployVps(expectedSha) {
  console.log(`VPS: actualizando a ${expectedSha}…`);
  ssh(`set -e
cd ${VPS_APP}
git pull -q --ff-only
HEAD=$(git rev-parse --short HEAD)
if [ "$HEAD" != "${expectedSha}" ]; then echo "FALLO: el VPS quedó en $HEAD, se esperaba ${expectedSha}"; exit 1; fi
cd apps/admin
if npm run build > /tmp/build.log 2>&1; then
  pm2 restart autoprestamos > /dev/null
  echo "VPS: build OK y app reiniciada"
else
  echo "FALLO: build del VPS. La app sigue con la versión anterior. Últimas líneas:"
  tail -n 30 /tmp/build.log
  exit 1
fi
`);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

function fail(message) {
  console.error(`FALLO: ${message}`);
  process.exit(1);
}

/** Espera a que el VPS sirva el commit (el reinicio tarda unos segundos). */
async function assertServedBuild(expectedSha, timeoutMs = 120000) {
  console.log("Comprobando build servido…");
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const data = await fetchJson(`${DOMAIN}/api/ops/build-health`);
      last = String(data.build ?? "");
      if (last === expectedSha) {
        console.log(`Build OK → ${last}`);
        return;
      }
    } catch (err) {
      last = String(err?.message || err);
    }
    await sleep(5000);
  }
  fail(`build servido=${last || "?"} esperado=${expectedSha}.`);
}

async function assertServiceRole() {
  console.log("Comprobando service role…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/health/supabase`);
  } catch (err) {
    fail(`health/supabase → ${err?.message || err}`);
  }
  if (!data.serviceRole) fail("falta SUPABASE_SERVICE_ROLE_KEY en el VPS (.env.local).");
  console.log("Service role OK");
}

async function assertCatalogHealth() {
  console.log("Comprobando catálogo SQL (clientes)…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/ops/catalog-health`);
  } catch (err) {
    fail(`catalog-health → ${err?.message || err}`);
  }
  if (!data.ok) {
    if (data.error) console.error(`  error: ${data.error}`);
    fail(`catálogo incompleto. clients=${data.clients ?? "?"} expectedMin=${data.expectedMin ?? "?"}`);
  }
  console.log(`Catálogo OK → ${data.clients} clientes (mín ${data.expectedMin})`);
}

async function assertCashChain() {
  console.log("Comprobando regla de inicio en la nube (Inicial M hoy = CIE ayer)…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/ops/chain-audit`);
  } catch (err) {
    fail(`chain-audit → ${err?.message || err}`);
  }
  for (const row of data.rows ?? []) {
    const tag = row.kind === "independent" ? "Caja" : "CIE";
    const tLabel = row.kind === "independent" ? "Caja hoy" : "Inicial T";
    console.log(
      `  ${row.ok ? "OK   " : "FALLA"} ${row.collectorName || row.collectorRef}: ${tag} ${row.yesterday} = ${row.yesterdayCieFloat} · Inicial hoy = ${row.todayOpening ?? "—"} · ${tLabel} = ${row.todayMClosing ?? "—"} · saldo final = ${row.todayFinal ?? "—"}`,
    );
  }
  if (!data.ok) {
    fail(`regla de inicio rota en ${data.businessDate ?? "hoy"}.${data.error ? ` ${data.error}` : ""}`);
  }
  console.log("Regla de inicio OK");
}

/** Aviso (no frena: puede ser justo la versión que lo arregla). */
async function reportDeviceStorage() {
  console.log("Comprobando aparatos (¿guardan lo que bajan?)…");
  let data;
  try {
    data = await fetchJson(`${DOMAIN}/api/ops/devices`);
  } catch (err) {
    console.error(`AVISO: monitor de aparatos → ${err?.message || err}`);
    return;
  }
  const alerts = data.storageAlerts ?? [];
  for (const a of alerts) {
    console.error(`  ALERTA ${a.userName} (${a.roleName}, ${a.host}, build ${a.build}): ${a.reason}`);
  }
  console.log(alerts.length ? `Aparatos con alarma: ${alerts.length} (recargar con este build)` : "Aparatos OK");
}

async function verify(expectedSha) {
  await assertServedBuild(expectedSha);
  await assertServiceRole();
  await assertCatalogHealth();
  await assertCashChain();
  await reportDeviceStorage();
  console.log(`\nListo de verdad. ${DOMAIN} → build ${expectedSha}. Catálogo + service role + regla de inicio verificados.`);
}

const mode = process.argv[2] || "verify";

void (async () => {
  if (capture("git rev-parse --abbrev-ref HEAD") !== "main") {
    fail("producción solo sale de main.");
  }
  run("node scripts/assert-no-bom.mjs", adminRoot);
  const sha = capture("git rev-parse --short HEAD");

  if (mode === "release") {
    console.log(`── Publicar ${sha} → ${DOMAIN} ──`);
    run("git push origin main");
    deployVps(sha);
    await verify(sha);
    process.exit(0);
  }

  if (mode === "verify") {
    const remoteSha = capture("git rev-parse --short origin/main");
    console.log(`── Revisar ${DOMAIN} (origin/main ${remoteSha}) ──`);
    await verify(remoteSha);
    process.exit(0);
  }

  fail(`modo desconocido: ${mode}. Usa release | verify`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
