import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceEnv } from "@/lib/supabase/service-env";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

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
 * Cliente para mirrors en server: prefiere service role; si no hay, anon (dev legacy).
 * En browser no se llama (los mirrors van por /api/*).
 */
export function createMirrorServerClient(): SupabaseClient | null {
  const admin = createSupabaseAdminClient();
  if (admin) return admin;

  const { url, anonKey, configured } = getSupabasePublicEnv();
  if (!configured) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function mirrorUsesServiceRole() {
  return getSupabaseServiceEnv().configured;
}
