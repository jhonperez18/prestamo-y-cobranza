import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientRowToMirror } from "@/lib/supabase/catalog-mirror";
import {
  buildDiurnoRoute1Clients,
  DIURNO_ROUTE_NAMES,
} from "@/lib/seeds/diurno-route-1";

/**
 * Siembra DIURNO en Postgres: solo altas faltantes.
 * Nunca hace upsert masivo de fichas ya existentes (eso rebobinaba
 * nombres/edits del padre con MAYÚSCULAS + updated_at fresco).
 */
export async function seedDiurnoClientsInCloud() {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false as const, error: "service_role_missing" };

  const planned = buildDiurnoRoute1Clients();
  const plannedRefs = planned.map((row) => row.ref);

  const { data: existing, error: existErr } = await client
    .from("clients")
    .select("ref")
    .in("ref", plannedRefs);
  if (existErr) return { ok: false as const, error: existErr.message };

  const have = new Set((existing ?? []).map((row) => String(row.ref || "").trim()).filter(Boolean));
  const toInsert = planned
    .filter((row) => !have.has(row.ref))
    .map(clientRowToMirror)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
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
      seeded: toInsert.length,
      skippedExisting: planned.length - toInsert.length,
      routeWarn: routeErr.message,
    };
  }

  return {
    ok: true as const,
    seeded: toInsert.length,
    skippedExisting: planned.length - toInsert.length,
  };
}

export async function catalogClientsCount() {
  const client = createSupabaseAdminClient();
  if (!client) return { ok: false as const, error: "service_role_missing", count: 0 };
  const { count, error } = await client.from("clients").select("*", { count: "exact", head: true });
  if (error) return { ok: false as const, error: error.message, count: 0 };
  return { ok: true as const, count: count ?? 0 };
}
