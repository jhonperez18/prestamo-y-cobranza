/** Variables de servidor Supabase (nunca exponer al browser). */
export function getSupabaseServiceEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return {
    url,
    serviceRoleKey,
    configured: Boolean(url && serviceRoleKey),
  };
}
