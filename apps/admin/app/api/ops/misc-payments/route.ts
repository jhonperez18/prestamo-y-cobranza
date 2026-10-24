import { jsonNoStore } from "@/lib/api-no-store";
import { fetchOpsTable, rowToMisc } from "@/lib/supabase/ops-mirror";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

/** Pagos varios (PV-). La lista entera: es chica y es la que lee Gastos de Banco. */
export async function GET() {
  try {
    const result = await fetchOpsTable("misc_payments");
    if (!result.ok) {
      return jsonNoStore({ ok: false, error: result.error, rows: [] }, { status: 502 });
    }
    if ("skipped" in result && result.skipped) {
      return jsonNoStore({ ok: true, skipped: true, rows: [] });
    }
    const rows = result.rows
      .map((row) => rowToMisc(row))
      .filter((row) => row != null);
    return jsonNoStore({ ok: true, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "misc_payments_failed";
    return jsonNoStore({ ok: false, error: message, rows: [] }, { status: 500 });
  }
}
