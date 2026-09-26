import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createMirrorServerClient,
  mirrorUsesServiceRole,
} from "@/lib/supabase/admin";
import { jsonNoStore } from "@/lib/api-no-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Comprueba Supabase + modo C6.1 (service role) sin exponer secretos. */
export async function GET() {
  const { url, configured } = getSupabasePublicEnv();
  if (!configured) {
    return jsonNoStore(
      { ok: false, error: "missing_env", url: null, projectHost: null },
      { status: 503 },
    );
  }

  let projectHost: string | null = null;
  try {
    projectHost = new URL(url).host;
  } catch {
    projectHost = null;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.getSession();
    if (error) {
      return jsonNoStore(
        { ok: false, error: error.message, url, projectHost },
        { status: 502 },
      );
    }

    const mirror = createMirrorServerClient();
    const payments = mirror
      ? await mirror.from("payments").select("ref").limit(1)
      : { error: { code: "service_role_missing", message: "service_role_missing" } };
    const dayCloses = mirror
      ? await mirror.from("day_closes").select("ref").limit(1)
      : { error: { code: "service_role_missing", message: "service_role_missing" } };
    const tableMissing =
      payments.error?.code === "PGRST205" ||
      /Could not find the table/i.test(payments.error?.message ?? "");

    return jsonNoStore({
      ok: true,
      url,
      projectHost,
      auth: "reachable",
      serviceRole: mirrorUsesServiceRole(),
      sameCloudAsWorkshop: Boolean(projectHost),
      payments: !mirror
        ? { ok: false, error: "service_role_missing" }
        : tableMissing
          ? { ok: false, error: "payments_table_missing" }
          : payments.error
            ? { ok: false, error: payments.error.message }
            : { ok: true },
      dayCloses: !mirror
        ? { ok: false, error: "service_role_missing" }
        : dayCloses.error
          ? { ok: false, error: dayCloses.error.message }
          : { ok: true },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore(
      { ok: false, error: message, url, projectHost },
      { status: 502 },
    );
  }
}
