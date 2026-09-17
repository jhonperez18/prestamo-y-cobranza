import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientRowToMirror } from "@/lib/supabase/catalog-mirror";
import {
  buildDiurnoRoute1Clients,
  DIURNO_ROUTE_NAMES,
} from "@/lib/seeds/diurno-route-1";

/** Upsert de la hoja DIURNO en Postgres (solo nombre + orden; sin datos privados). */
export async function seedDiurnoClientsInCloud() {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false as const, error: "service_role_missing" };

  const rows = buildDiurnoRoute1Clients()
    .map(clientRowToMirror)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await client.from("clients").upsert(chunk, { onConflict: "ref" });
    if (error) return { ok: false as const, error: error.message };
  }

  const { error: routeErr } = await client
    .from("routes")
    .update({
      clients_count: DIURNO_ROUTE_NAMES.length,
      updated_at: new Date().toISOString(),
    })
    .eq("ref", "RUT-1");
  if (routeErr) {
    return {
      ok: true as const,
      seeded: rows.length,
      routeWarn: routeErr.message,
    };
  }

  return { ok: true as const, seeded: rows.length };
}

export async function catalogClientsCount() {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false as const, error: "service_role_missing", count: 0 };
  const { count, error } = await client.from("clients").select("*", { count: "exact", head: true });
  if (error) return { ok: false as const, error: error.message, count: 0 };
  return { ok: true as const, count: count ?? 0 };
}
