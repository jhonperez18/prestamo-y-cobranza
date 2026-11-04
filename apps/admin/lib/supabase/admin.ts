import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";

/**
 * Node < 22 + supabase-js ≥ 2.55: createClient revienta sin transport WebSocket.
 * El servidor no usa Realtime; igual hay que pasar `ws` o no hay clientes, cobros ni planilla.
 *
 * `eval("require")` evita que Turbopack/Webpack metan `ws` en el bundle del browser
 * (AuthGate → user-mirror → este archivo).
 */
function nodeRealtimeTransport(): { transport?: unknown } {
  if (typeof window !== "undefined") return {};
  try {
    // eslint-disable-next-line no-eval, @typescript-eslint/no-unsafe-call
    const nodeRequire = eval("require") as (id: string) => unknown;
    return { transport: nodeRequire("ws") };
  } catch (error) {
    console.error("supabase-admin-ws-missing", error);
    return {};
  }
}

/**
 * Cliente admin (service role). Solo server / route handlers.
 * C6.1: escribe/lee sin RLS; el browser nunca usa esta key.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const { url, serviceRoleKey, configured } = getSupabaseServiceEnv();
  if (!configured) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: nodeRealtimeTransport(),
  });
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
