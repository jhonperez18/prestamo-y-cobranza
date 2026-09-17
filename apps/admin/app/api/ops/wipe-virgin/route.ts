import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/** Generación de wipe virgen: debe coincidir con el bootstrap del cliente. */
const WIPE_GEN = "v19";

const WIPE_TABLES = [
  "payments",
  "loans",
  "clients",
  "daily_assignments",
  "day_closes",
  "day_expenses",
  "misc_payments",
] as const;

async function deleteAllRefs(
  client: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  table: string,
) {
  for (let round = 0; round < 12; round += 1) {
    const { data, error } = await client.from(table).select("ref").limit(2000);
    if (error) return { ok: false as const, error: error.message };
    const refs = (data ?? []).map((row) => row.ref).filter(Boolean) as string[];
    if (!refs.length) return { ok: true as const, deleted: 0 };
    for (let i = 0; i < refs.length; i += 100) {
      const chunk = refs.slice(i, i + 100);
      const del = await client.from(table).delete().in("ref", chunk);
      if (del.error) return { ok: false as const, error: del.error.message };
    }
  }
  return { ok: true as const, deleted: 0 };
}

/**
 * Vacía cobros / clientes / préstamos / planilla / CIE / gastos / PV.
 * Conserva logins (profiles) y deja rutas/cobradores para el arranque.
 * No mueve nada a “papelera”: borra de raíz en Postgres.
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

  const client = createSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "service_role_missing" }, { status: 500 });
  }

  try {
    const counts: Record<string, number | string> = {};
    for (const table of WIPE_TABLES) {
      const result = await deleteAllRefs(client, table);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: `${table}: ${result.error}` }, { status: 502 });
      }
      const { count } = await client.from(table).select("*", { count: "exact", head: true });
      counts[table] = count ?? 0;
    }

    // Rutas: solo las 3 base, sin clientes ni historial.
    const { data: routeRows } = await client.from("routes").select("ref").limit(5000);
    const routeRefs = (routeRows ?? []).map((row) => row.ref).filter(Boolean) as string[];
    for (let i = 0; i < routeRefs.length; i += 100) {
      await client.from("routes").delete().in("ref", routeRefs.slice(i, i + 100));
    }
    await client.from("routes").upsert(
      [
        {
          ref: "RUT-1",
          slug: "1",
          name: "1",
          collector_ref: "COB-0",
          collector_name: "Juan Ríos",
          zone: "",
          frequency: "Lun–Sáb",
          stops: [],
          clients_count: 0,
          status: "Activa",
          kind: "ok",
        },
        {
          ref: "RUT-2",
          slug: "2",
          name: "2",
          collector_ref: "COB-1",
          collector_name: "Lina Soto",
          zone: "",
          frequency: "Lun–Sáb",
          stops: [],
          clients_count: 0,
          status: "Activa",
          kind: "ok",
        },
        {
          ref: "RUT-3",
          slug: "3",
          name: "3",
          collector_ref: "COB-2",
          collector_name: "Diego Mora",
          zone: "",
          frequency: "Lun–Sáb",
          stops: [],
          clients_count: 0,
          status: "Activa",
          kind: "ok",
        },
      ],
      { onConflict: "ref" },
    );
    const { count: routesCount } = await client
      .from("routes")
      .select("*", { count: "exact", head: true });
    counts.routes = routesCount ?? 0;

    return NextResponse.json({ ok: true, gen: WIPE_GEN, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "wipe_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
