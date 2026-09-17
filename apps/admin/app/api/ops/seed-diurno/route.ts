import { NextResponse } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { VIRGIN_WIPE_GEN } from "@/lib/virgin-lock";
import { seedDiurnoClientsInCloud } from "@/lib/diurno-cloud-seed";
import { DIURNO_ROUTE_NAMES } from "@/lib/seeds/diurno-route-1";

const WIPE_GEN = `v${VIRGIN_WIPE_GEN}`;

/**
 * Siembra (o repara) la hoja DIURNO en SQL sin wipe.
 * Idempotente: upsert por ref. No toca cobros ni préstamos.
 */
export async function POST(req: Request) {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return NextResponse.json({ ok: true, skipped: true, reason: "supabase_not_configured" });
  }

  const gen = req.headers.get("x-nexo-wipe-gen")?.trim();
  if (gen !== WIPE_GEN) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const result = await seedDiurnoClientsInCloud();
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    seeded: result.seeded,
    expected: DIURNO_ROUTE_NAMES.length,
    routeWarn: "routeWarn" in result ? result.routeWarn : undefined,
  });
}
