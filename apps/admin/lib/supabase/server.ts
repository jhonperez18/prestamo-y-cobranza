import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

/** Cliente server (RSC / route handlers) con cookies de sesión. */
export async function createSupabaseServerClient() {
  const { url, anonKey, configured } = getSupabasePublicEnv();
  if (!configured) {
    throw new Error(
      "Supabase no configurado. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // set desde Server Component de solo lectura: se ignora.
        }
      },
    },
  });
}
