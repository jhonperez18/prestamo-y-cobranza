import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/** Cliente browser (login, lectura con RLS). */
export function createSupabaseBrowserClient() {
  const { url, anonKey, configured } = getSupabasePublicEnv();
  if (!configured) {
    throw new Error(
      "Supabase no configurado. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local",
    );
  }
  return createBrowserClient(url, anonKey);
}
