import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DOMAIN = "prestamo-y-cobranza.vercel.app";
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

const buildId = `${execSync("git rev-parse --short HEAD", {
  cwd: adminRoot,
  encoding: "utf8",
}).trim()}-${Date.now().toString(36)}`;

writeFileSync(
  join(adminRoot, "lib", "app-build.ts"),
  `/** Generado en cada deploy:prod — no editar a mano. */\nexport const APP_BUILD = ${JSON.stringify(buildId)};\n`,
);

console.log(`Publicando build ${buildId} → https://${DOMAIN}`);
run("npx vercel link --yes --project admin");

const out = runCapture("npx vercel deploy --prod --force --yes");
const match = String(out).match(
  /https:\/\/admin-[a-z0-9]+-jhon-fredy-perezs-projects\.vercel\.app/,
);
if (!match) {
  console.error("No se encontró la URL del deploy en la salida.");
  process.exit(1);
}

run(`npx vercel alias set ${match[0]} ${DOMAIN}`);
run("npx vercel cache purge --yes --type cdn");
run("npx vercel cache purge --yes --type data");

console.log(`\nListo (caché limpia) → https://${DOMAIN}`);
console.log(`En el login debe verse: build ${buildId}`);
