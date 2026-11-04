import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";

/**
 * El servidor no usa Realtime (solo REST/RPC).
 *
 * Causa raíz (VPS): el `fetch` parcheado de Next termina en
 * `TypeError: fetch failed` hacia Supabase, mientras el `fetch` de Node
 * en el mismo host responde 200. Por eso el Inicial caía a CIE local
 * fantasma (5.428k) y chain-audit / payments fallaban.
 *
 * Solución: cliente admin con `undici.fetch` + Agent IPv4 (no el fetch de Next).
 * `undici` se carga con require en runtime (como `ws`): un `import` estático
 * metía `node:net` en el bundle del navegador y tumba Chrome
 * («Cannot find module node:net» → This page couldn't load).
 * Node < 22 sin WebSocket nativo: solo entonces se pasa `ws` a Realtime.
 */

type UndiciAgent = {
  close: () => Promise<void>;
};

type UndiciModule = {
  Agent: new (opts: {
    connect?: { family?: number; timeout?: number };
    keepAliveTimeout?: number;
    keepAliveMaxTimeout?: number;
    connections?: number;
    pipelining?: number;
  }) => UndiciAgent;
  fetch: (
    input: RequestInfo | URL,
    init?: RequestInit & { dispatcher?: UndiciAgent },
  ) => Promise<Response>;
};

/**
 * Un Agent por proceso, IPv4 forzado. keepAlive corto: un pool “muerto”
 * no debe dejar el Next sin respuesta (caso VPS tras minutos).
 */
let undiciAgent: UndiciAgent | null = null;
let undiciMod: UndiciModule | null = null;

function loadUndici(): UndiciModule {
  if (undiciMod) return undiciMod;
  if (typeof window !== "undefined") {
    throw new Error("supabase_admin_undici_browser");
  }
  try {
    // eslint-disable-next-line no-eval, @typescript-eslint/no-unsafe-call
    const nodeRequire = eval("require") as NodeRequire;
    undiciMod = nodeRequire("undici") as UndiciModule;
    return undiciMod;
  } catch (error) {
    console.error("supabase-admin-undici-missing", error);
    throw error;
  }
}

function getUndiciAgent(): UndiciAgent {
  if (!undiciAgent) {
    const { Agent } = loadUndici();
    undiciAgent = new Agent({
      connect: { family: 4, timeout: 15_000 },
      keepAliveTimeout: 1_000,
      keepAliveMaxTimeout: 5_000,
      connections: 8,
      pipelining: 1,
    });
  }
  return undiciAgent;
}

function adminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { fetch: undiciFetch } = loadUndici();
  return undiciFetch(input, {
    ...(init as object),
    dispatcher: getUndiciAgent(),
  }) as unknown as Promise<Response>;
}

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

/** Un solo cliente por proceso. */
let cachedAdmin: SupabaseClient | null | undefined;

/** Suelta cliente + agent si el socket quedó envenenado. */
export function resetSupabaseAdminClient() {
  cachedAdmin = undefined;
  const prev = undiciAgent;
  undiciAgent = null;
  if (prev) {
    void prev.close().catch(() => {
      /* ignore */
    });
  }
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
    global: { fetch: adminFetch },
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
