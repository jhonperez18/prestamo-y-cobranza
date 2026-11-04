import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";

/**
 * El servidor no usa Realtime (solo REST/RPC).
 * Node < 22 + supabase-js ≥ 2.55: createClient exige transport WebSocket.
 * Node ≥ 22 trae WebSocket nativo: no inyectar `ws` (dejaba el fetch HTTP
 * en `TypeError: fetch failed` tras unos minutos en el VPS → Inicial 5.428k).
 *
 * No importar `ws` estático: Turbopack lo metería en el browser (AuthGate → user-mirror).
 */
function nodeRealtimeTransport(): { transport?: unknown } {
  if (typeof window !== "undefined") return {};
  if (typeof WebSocket !== "undefined") return {};
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

/** Suelta el cliente envenenado (fetch failed) para el próximo request. */
export function resetSupabaseAdminClient() {
  cachedAdmin = undefined;
}

function isFetchFailed(error: unknown) {
  if (!error) return false;
  const msg =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  return /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_|network/i.test(msg);
}

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
  const realtime = nodeRealtimeTransport();
  cachedAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(realtime.transport
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { realtime: realtime as any }
      : {}),
  });
  return cachedAdmin;
}

/**
 * Ejecuta una lectura/RPC; si el cliente quedó en `fetch failed`, lo suelta
 * y reintenta una vez (sin reiniciar PM2).
 */
export async function withSupabaseAdmin<T>(
  run: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const first = createSupabaseAdminClient();
  if (!first) throw new Error("sin_servicio");
  try {
    return await run(first);
  } catch (error) {
    if (!isFetchFailed(error)) throw error;
    console.error("supabase-admin-fetch-failed-retry", error);
    resetSupabaseAdminClient();
    const second = createSupabaseAdminClient();
    if (!second) throw error;
    return await run(second);
  }
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
