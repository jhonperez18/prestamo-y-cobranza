import { jsonNoStore } from "@/lib/api-no-store";
import type { CollectorDayExpenseDraft, RouteExpenseLine } from "@/lib/collector-day-close";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rowToDayClose, rowToDayExpense } from "@/lib/supabase/ops-mirror";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

function operativeCount(lines: RouteExpenseLine[]): number {
  return lines.filter(
    (line) =>
      (Number(line.amount) || 0) > 0 &&
      String(line.category || "") !== "prestamo_ruta" &&
      String(line.id || "") !== "prestamo",
  ).length;
}

/**
 * Detalle de gastos / préstamos del día (GAS-; si falta, renglones del CIE-).
 * Una sola lectura para cobrador, supervisor y PC — sin depender del disco del aparato.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const collectorRef = String(url.searchParams.get("collectorRef") || "").trim();
    const date = String(url.searchParams.get("date") || "").trim();
    if (!collectorRef || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return jsonNoStore({ ok: false, error: "dato_invalido" }, { status: 400 });
    }
    const client = createSupabaseAdminClient();
    if (!client) return jsonNoStore({ ok: false, error: "sin_servicio" }, { status: 503 });

    const [{ data: gasRows, error: gasError }, { data: cieRows, error: cieError }] =
      await Promise.all([
        client
          .from("day_expenses")
          .select("*")
          .eq("collector_ref", collectorRef)
          .eq("expense_date", date)
          .limit(5),
        client
          .from("day_closes")
          .select("*")
          .eq("collector_ref", collectorRef)
          .eq("close_date", date)
          .like("ref", "CIE-%")
          .limit(5),
      ]);
    if (gasError) return jsonNoStore({ ok: false, error: gasError.message }, { status: 502 });
    if (cieError) return jsonNoStore({ ok: false, error: cieError.message }, { status: 502 });

    let expenses = (gasRows || [])
      .map((row) => rowToDayExpense(row as Record<string, unknown>))
      .filter((row): row is CollectorDayExpenseDraft => Boolean(row));

    const gasOperative = expenses.reduce(
      (sum, row) => sum + operativeCount(row.expenses || []),
      0,
    );
    if (gasOperative === 0) {
      for (const raw of cieRows || []) {
        const cie = rowToDayClose(raw as Record<string, unknown>);
        if (!cie || cie.provisional) continue;
        const lines = (cie.expenses || []).filter((line) => (Number(line.amount) || 0) > 0);
        if (!lines.length) continue;
        // CIE con detalle y GAS- vacío / solo préstamos: el botón lee este listado.
        expenses = [
          {
            ref: `GAS-${collectorRef}-${date}`,
            collectorRef,
            collectorName: cie.collectorName || "",
            date,
            routeRef: cie.routeRef || "",
            expenses: lines,
            expensesTotal: lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0),
            updatedAt: cie.updatedAt || cie.closedAt || new Date().toISOString(),
          },
        ];
        break;
      }
    }

    return jsonNoStore({ ok: true, date, collectorRef, expenses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "day_expenses_failed";
    console.error("day-expenses", error);
    return jsonNoStore({ ok: false, error: message }, { status: 500 });
  }
}
