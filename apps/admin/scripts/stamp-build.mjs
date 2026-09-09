/**
 * Escribe lib/app-build.ts con el commit real del build.
 * En Vercel usa VERCEL_GIT_COMMIT_SHA; en local, git HEAD.
 * Así el login nunca muestra un build viejo tras un push a main.
 */
import { execSync } from "child_process";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function shortSha() {
  const fromVercel = (process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: adminRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

const buildId = shortSha();
const target = join(adminRoot, "lib", "app-build.ts");
writeFileSync(
  target,
  `/** Generado en cada build — no editar a mano. */\nexport const APP_BUILD = ${JSON.stringify(buildId)};\n`,
);
console.log(`[stamp-build] APP_BUILD=${buildId}`);
