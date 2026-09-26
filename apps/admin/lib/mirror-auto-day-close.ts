/**
 * Auto-cierre 23:30 / rollover → misma cadena que cierre manual:
 * encolar CIE + planilla sellada y await flush a Supabase.
 *
 * Sin esto el corte solo vive en el navegador y a la mañana
 * otro aparato reabre la jornada (error diario).
 *
 * Nota: PCE- (cadena M↔T) aún no van a day_closes hasta aplicar
 * supabase/migrations/20260926143000_day_closes_pce_and_cie_unique.sql
 * (check actual solo admite ^CIE-).
 */
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { CollectorDayCloseRecord } from "@/lib/collector-day-close";
import type { PlanillaCashCloseRecord } from "@/lib/planilla-cash-chain";
import {
  flushOpsMirrorQueues,
  queueAssignmentsMirror,
  queueDayCloseMirror,
} from "@/lib/supabase/ops-mirror";

export type MirrorAutoDayCloseInput = {
  dayCloses: CollectorDayCloseRecord[];
  planillaCashCloses?: PlanillaCashCloseRecord[];
  assignments: DailyCollectionAssignment[];
};

/**
 * Encola cierres CIE y planilla sellada, luego espera el flush nube.
 * Idempotente: queueDayCloseMirror / assignment deduplican por firma.
 */
export async function mirrorAutoDayCloseToCloud(
  input: MirrorAutoDayCloseInput,
): Promise<void> {
  if (typeof window === "undefined") return;

  for (const row of input.dayCloses) {
    if (!row?.ref) continue;
    // Solo CIE- a day_closes (esquema actual). PCE- espera migración.
    if (String(row.ref).startsWith("PCE-")) continue;
    queueDayCloseMirror(row);
  }

  const sealed = input.assignments.filter((row) => Boolean(row.dayClosedAt));
  if (sealed.length > 0) {
    queueAssignmentsMirror(sealed);
  }

  await flushOpsMirrorQueues();
  await flushOpsMirrorQueues();
}
