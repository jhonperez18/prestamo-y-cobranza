import { fetchPaymentsFromSupabase } from "@/lib/supabase/payment-mirror";
import { changedSinceCursor, readChangedSince } from "@/lib/supabase/changed-since";
import { jsonNoStore } from "@/lib/api-no-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/**
 * C3: lista cobros en public.payments para fusionar en el demo local.
 * Sin caché: cada GET lee Supabase en vivo.
 * `?since=` → solo lo que cambió o se creó desde ese corte (`incremental: true`).
 */
export async function GET(request: Request) {
  try {
    const cursor = changedSinceCursor();
    const evidence = new URL(request.url).searchParams.get("evidence") === "1";
    const since = evidence ? null : readChangedSince(request);
    const result = await fetchPaymentsFromSupabase({ evidence, since });
    if ("skipped" in result && result.skipped) {
      return jsonNoStore({
        ok: true,
        skipped: true,
        reason: result.reason,
        payments: [],
      });
    }
    if (!result.ok) {
      return jsonNoStore(
        { ok: false, error: result.error, payments: [] },
        { status: 502 },
      );
    }
    return jsonNoStore({ ok: true, incremental: Boolean(since), cursor, payments: result.rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore(
      { ok: false, error: message, payments: [] },
      { status: 500 },
    );
  }
}
