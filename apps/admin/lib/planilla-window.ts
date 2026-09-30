/**
 * Ventana operativa de la planilla: lo que baja de la nube (bundle) y lo que guarda
 * el aparato. Lo más viejo vive solo en Supabase (`daily_assignments`).
 */
import { businessDaysAgoIso } from "@/lib/business-timezone";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";

export const PLANILLA_WINDOW_DAYS = 45;

export function planillaWindowStartIso(now = new Date()) {
  return businessDaysAgoIso(PLANILLA_WINDOW_DAYS, now);
}

/** Deja las visitas de la ventana. Sin fecha legible: se conserva (no se adivina). */
export function assignmentsInPlanillaWindow(
  rows: DailyCollectionAssignment[],
  now = new Date(),
): DailyCollectionAssignment[] {
  const since = planillaWindowStartIso(now);
  const kept = rows.filter((row) => {
    const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
    return !date || date >= since;
  });
  return kept.length === rows.length ? rows : kept;
}
