import { execSync } from "node:child_process";
import { NextResponse } from "next/server";
import { APP_BUILD } from "@/lib/app-build";

/**
 * Build que este proceso está sirviendo de verdad.
 * Dueño único: esta ruta API (servidor). El cliente nunca resuelve Git.
 *
 * - Prod / Vercel → sello del deploy (`APP_BUILD`).
 * - Dev local → SHA corto de HEAD (sin reiniciar Next tras cada commit).
 */
function resolveServedBuild(): string {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    return APP_BUILD;
  }
  try {
    const sha = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || APP_BUILD;
  } catch {
    return APP_BUILD;
  }
}

/** Salud del build servido (verify:prod + sello vivo en login). */
export async function GET() {
  const build = resolveServedBuild();
  return NextResponse.json(
    { ok: true, build },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}
