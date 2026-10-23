/**
 * La hoja del día se escribe una vez, desde la ficha de la nube.
 * A las 23:35 queda montada la del día siguiente: a las 00:00 ya está.
 * Si la ruta ya tiene visitas, no se le agrega nadie.
 */
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import { isDailyCollectionDay } from "@/lib/colombia-holidays";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import { insertAssignmentRowsNew } from "@/lib/supabase/ops-mirror";

function onDate(row: DailyCollectionAssignment, date: string) {
  return (normalizeHistoryDate(row.dispatchDate) || row.dispatchDate) === date;
}

/**
 * Visitas que faltan por montar.
 * De noche (`fillMissing`) completa la lista de mañana aunque un intento
 * anterior haya dejado la ruta a medias: no pisa lo que ya está.
 * De día solo escribe si esa fecha todavía no tiene a nadie.
 */
export function daySheetBirthRows(
  state: Pick<
    OperationalDayState,
    "assignments" | "routes" | "clients" | "loans" | "collectors" | "payments"
  >,
  date: string,
  fillMissing = false,
): DailyCollectionAssignment[] {
  if (!isDailyCollectionDay(date)) return [];
  const already = state.assignments.filter((row) => onDate(row, date));
  if (!fillMissing && already.length > 0) return [];
  const present = new Set(already.map((row) => row.itemId));
  const built = syncPermanentRoutePlanilla(
    date,
    state.routes,
    state.clients,
    state.loans,
    state.collectors,
    state.assignments.filter((row) => !onDate(row, date)),
    state.payments,
  );
  return built.assignments.filter((row) => {
    if (!onDate(row, date)) return false;
    if (!String(row.clientRoute || "").trim()) return false;
    return !present.has(row.itemId);
  });
}

export async function persistDaySheet(
  state: Pick<
    OperationalDayState,
    "assignments" | "routes" | "clients" | "loans" | "collectors" | "payments"
  >,
  date: string,
  fillMissing = false,
): Promise<{ ok: true; mounted: number; skipped?: string } | { ok: false; error: string; mounted: number }> {
  const rows = daySheetBirthRows(state, date, fillMissing);
  if (!rows.length) {
    return {
      ok: true,
      mounted: 0,
      skipped: isDailyCollectionDay(date) ? "ya_montada" : "dia_sin_cobro",
    };
  }
  const saved = await insertAssignmentRowsNew(rows);
  if (!saved.ok) return saved;
  return { ok: true, mounted: saved.mounted };
}
