import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";

/**
 * Cliente admin (service role). Solo server / route handlers.
 * C6.1: escribe/lee sin RLS; el browser nunca usa esta key.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const { url, serviceRoleKey, configured } = getSupabaseServiceEnv();
  if (!configured) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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
