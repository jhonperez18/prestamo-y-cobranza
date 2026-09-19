import { APP_BUILD } from "@/lib/app-build";

/**
 * Build que este proceso está sirviendo de verdad.
 * - Prod / Vercel: el del deploy (`APP_BUILD`).
 * - Dev local: SHA actual de Git en vivo (sin reiniciar Next tras cada commit).
 *
 * Solo servidor (API / RSC). El cliente pide `/api/ops/build-health`.
 */
export function resolveServedBuild(): string {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return APP_BUILD;
  }
  try {
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
