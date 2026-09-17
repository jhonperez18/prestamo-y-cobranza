import { NextResponse } from "next/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { catalogClientsCount } from "@/lib/diurno-cloud-seed";
import { DIURNO_ROUTE_NAMES } from "@/lib/seeds/diurno-route-1";

/**
 * Salud del catálogo en SQL (para verify:prod).
 * No expone nombres ni datos privados — solo conteos.
 */
export async function GET() {
  const { configured } = getSupabasePublicEnv();
  if (!configured) {
    return NextResponse.json({
      ok: false,
      reason: "supabase_not_configured",
      clients: 0,
      expectedMin: DIURNO_ROUTE_NAMES.length,
    });
  }

  const result = await catalogClientsCount();
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        clients: 0,
        expectedMin: DIURNO_ROUTE_NAMES.length,
      },
      { status: 500 },
    );
  }

  const clients = result.count;
  const expectedMin = DIURNO_ROUTE_NAMES.length;
  return NextResponse.json({
    ok: clients >= expectedMin,
    clients,
    expectedMin,
  });
}
