import { NextResponse } from "next/server";
import { resolveServedBuild } from "@/lib/app-build";

/** Salud del build servido (para verify:prod y sello vivo en login local). */
export async function GET() {
  const build = resolveServedBuild();
  return NextResponse.json(
    {
      ok: true,
      build,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}
