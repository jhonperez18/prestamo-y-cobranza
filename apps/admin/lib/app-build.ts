/** Id de build = commit corto. Lo inyecta next.config en cada build/arranque. */
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD || "dev";

/**
 * Build que este proceso está sirviendo de verdad.
 * - Prod / Vercel: el del deploy (`APP_BUILD`).
 * - Dev local: SHA actual de Git en vivo (sin reiniciar Next tras cada commit).
 *
 * Solo usar en servidor (API / RSC). El cliente pide `/api/ops/build-health`.
 */
export function resolveServedBuild(): string {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return APP_BUILD;
  }
  try {
    // Dynamic require: no meter child_process en el bundle del cliente.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require("child_process") as typeof import("child_process");
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || APP_BUILD;
  } catch {
    return APP_BUILD;
  }
}
