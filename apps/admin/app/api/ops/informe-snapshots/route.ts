import { jsonNoStore } from "@/lib/api-no-store";
import { listInformeSnapshots } from "@/lib/supabase/informe-snapshot-mirror";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = await listInformeSnapshots();
    if (!result.ok) return jsonNoStore(result, { status: 502 });
    return jsonNoStore(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
