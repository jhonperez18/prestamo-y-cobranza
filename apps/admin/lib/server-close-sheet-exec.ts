/**
 * Ejecuta el cierre de hoja en el servidor (Fase 4.1).
 * 1) Calcula con la nube (planServerSheetClose).
 * 2) Sella con seal_day_close (cash_float de la base).
 * 3) Sube eslabones PCE- si el plan los armó.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { planillaCashCloseAsDayClose } from "@/lib/planilla-cash-chain";
import { planServerSheetClose } from "@/lib/server-close-sheet";
import { loadOperationalStateFromCloud } from "@/lib/server-day-rollover";
import { callSealDayClose } from "@/lib/server-seal-day-close";
import { dayCloseToRow, upsertDayCloseIdempotent } from "@/lib/supabase/ops-mirror";

export type CloseSheetExecRequest = {
  collectorRef: string;
  date: string;
  route?: string;
  routeRef?: string;
  key: string;
  by: string;
};

export type CloseSheetExecResult =
  | {
      ok: true;
      fullyClosed: boolean;
      cashFloat: number | null;
      cieRef: string | null;
      sealedAssignments: number;
      mClosing: number | null;
      dayFinal: number | null;
      idempotent?: boolean;
    }
  | { ok: false; error: string; missingDay?: string };

export async function executeCloseSheet(
  request: CloseSheetExecRequest,
): Promise<CloseSheetExecResult> {
  const collectorRef = request.collectorRef.trim();
  const date = request.date.trim();
  const key = request.key.trim();
  const by = request.by.trim() || "close-sheet";
  if (!collectorRef || !key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "dato_invalido" };
  }
  // Cobrador: solo hoy. El cron de 23:30 sigue por day-rollover.
  if (date !== businessTodayIso()) {
    return { ok: false, error: "solo_hoy" };
  }

  const loaded = await loadOperationalStateFromCloud();
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const plan = planServerSheetClose(loaded.state, {
    collectorRef,
    date,
    route: request.route,
    routeRef: request.routeRef,
  });
  if (!plan.ok) return { ok: false, error: plan.error };

  const sealed = await callSealDayClose({
    collectorRef,
    date,
    route: request.route,
    key,
    by,
    writeCie: plan.fullyClosed && Boolean(plan.record),
    routeRef: request.routeRef || plan.record?.routeRef,
    collectorName: plan.record?.collectorName,
    collected: plan.record?.collected,
    expenses: plan.record?.expenses,
    expensesTotal: plan.record?.expensesTotal,
    movementRefs: plan.record?.movementRefs,
  });
  if (!sealed.ok) {
    return { ok: false, error: sealed.error, missingDay: sealed.missingDay };
  }

  // PCE- M/T: el plan del servidor los arma; se suben como filas (no llevan cash_float del CIE).
  for (const link of plan.sealedLinks) {
    const asClose = planillaCashCloseAsDayClose(link);
    const row = dayCloseToRow(asClose);
    const up = await upsertDayCloseIdempotent(row, { force: true });
    if (!up.ok) {
      return { ok: false, error: "error" in up ? String(up.error) : "pce_failed" };
    }
  }

  return {
    ok: true,
    fullyClosed: plan.fullyClosed,
    cashFloat: sealed.cashFloat ?? plan.record?.cashFloat ?? null,
    cieRef: sealed.ref ?? plan.record?.ref ?? null,
    sealedAssignments: sealed.sealedAssignments,
    mClosing: plan.mClosing,
    dayFinal: plan.dayFinal,
    idempotent: sealed.idempotent,
  };
}
