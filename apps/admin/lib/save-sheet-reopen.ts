/**
 * Reabrir la hoja de hoy (supervisor / admin): la nube primero (marca en el CIE- +
 * visitas abiertas), después este aparato con la misma regla que aplica el pull.
 */
import type { CollectorDayCloseRecord } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_PLANILLA_CASH_CLOSES_KEY,
  readDemoJson,
} from "@/lib/demo-persist";
import type { PlanillaCashCloseRecord } from "@/lib/planilla-cash-chain";
import { routesToReopen, sheetReopenWindow, type DayCloseReopen } from "@/lib/sheet-reopen";
import { applySheetReopensLocally, readKnownSheetReopens } from "@/lib/supabase/ops-mirror";

export type SheetReopenRequest = { collectorRef: string; route: string };

export type SaveSheetReopenResult =
  | {
      ok: true;
      dayCloses: CollectorDayCloseRecord[];
      planillaCashCloses: PlanillaCashCloseRecord[];
      assignments: DailyCollectionAssignment[];
      message: string;
    }
  | { ok: false; error: string };

type ReopenApiJson =
  | { ok: true; reopens: DayCloseReopen[]; reopenedVisits: number }
  | { ok: false; error?: string };

export async function reopenSheetToday(
  input: SheetReopenRequest & { by: string },
): Promise<SaveSheetReopenResult> {
  const gate = sheetReopenWindow(
    input.collectorRef,
    input.route,
    readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
    readKnownSheetReopens(),
  );
  if (!gate.open) return { ok: false, error: gate.reason };

  let json: ReopenApiJson;
  try {
    const res = await fetch("/api/ops/reopen-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(input),
    });
    json = (await res.json()) as ReopenApiJson;
  } catch (error) {
    console.error("reopen-sheet", error);
    return { ok: false, error: "Sin conexión con la nube: la hoja sigue cerrada. Intente de nuevo." };
  }
  if (!json.ok) return { ok: false, error: json.error || "La nube no reabrió la hoja." };

  applySheetReopensLocally(json.reopens);
  const routes = routesToReopen(input.route).join(" y ");
  return {
    ok: true,
    dayCloses: readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []),
    planillaCashCloses: readDemoJson<PlanillaCashCloseRecord[]>(DEMO_PLANILLA_CASH_CLOSES_KEY, []),
    assignments: readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []),
    message: `Hoja ${routes} reabierta. El cobrador ya puede cobrar y volver a cerrar (el saldo final se recalcula).`,
  };
}
