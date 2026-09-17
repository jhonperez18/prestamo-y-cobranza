import { NextResponse } from "next/server";
import { APP_BUILD } from "@/lib/app-build";

/** Salud del build servido (para verify:prod; no depende del HTML del login). */
export async function GET() {
  return NextResponse.json({
    ok: true,
    build: APP_BUILD,
  });
}
