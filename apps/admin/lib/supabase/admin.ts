import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";

/**
 * Node < 22 + supabase-js ≥ 2.55: createClient revienta sin transport WebSocket.
 * El servidor no usa Realtime; igual hay que pasar `ws` o no hay clientes, cobros ni planilla.
 *
 * No importar `ws` estático: Turbopack lo metería en el browser (AuthGate → user-mirror).
 */
function nodeRealtimeTransport(): { transport?: unknown } {
  if (typeof window !== "undefined") return {};
  try {
    // eslint-disable-next-line no-eval, @typescript-eslint/no-unsafe-call
    const nodeRequire = eval("require") as NodeRequire;
    return { transport: nodeRequire("ws") };
  } catch (error) {
    console.error("supabase-admin-ws-missing", error);
    return {};
  }
}

/** Un solo cliente por proceso: evita cientos de sockets colgados bajo carga. */
let cachedAdmin: SupabaseClient | null | undefined;

/**
 * Cliente admin (service role). Solo server / route handlers.
 * C6.1: escribe/lee sin RLS; el browser nunca usa esta key.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  if (typeof window !== "undefined") return null;
  if (cachedAdmin !== undefined) return cachedAdmin;
  const { url, serviceRoleKey, configured } = getSupabaseServiceEnv();
  if (!configured) {
    cachedAdmin = null;
    return null;
  }
  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase tipa transport como WebSocket nativo; en Node 20 pasamos `ws`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: nodeRealtimeTransport() as any,
  });
  return cachedAdmin;
}

/**
 * Cliente para mirrors en server: **solo** service role (C6.1).
 * Sin fallback anon: con RLS sin políticas anon, anon fallaría en silencio.
 */
export function createMirrorServerClient(): SupabaseClient | null {
  return createSupabaseAdminClient();
}

export function mirrorUsesServiceRole() {
  return getSupabaseServiceEnv().configured;
}
