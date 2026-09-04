"use client";

import { useEffect, useRef } from "react";
import { syncPermanentRoutePlanilla } from "@/lib/route-planilla";
import { todayIso } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, CollectorRow, LoanRow, RouteRow } from "@/lib/mock-data";

type PlanillaState = {
  routes: RouteRow[];
  clients: ClientRow[];
  loans: LoanRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
};

/**
 * Al cambiar el día calendario (medianoche local), regenera la planilla
 * Lun–sáb y la deja despachada a la app. También re-sincroniza al volver a la pestaña.
 */
export function usePlanillaDayRollover(
  enabled: boolean,
  state: PlanillaState,
  apply: (next: { assignments: DailyCollectionAssignment[]; routes: RouteRow[] }) => void,
) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const lastDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function syncIfNeeded(force = false) {
      const date = todayIso();
      if (!force && lastDateRef.current === date) return;
      lastDateRef.current = date;
      const current = stateRef.current;
      const synced = syncPermanentRoutePlanilla(
        date,
        current.routes,
        current.clients,
        current.loans,
        current.collectors,
        current.assignments,
      );
      applyRef.current(synced);
    }

    syncIfNeeded(true);

    const onVisible = () => {
      if (document.visibilityState === "visible") syncIfNeeded(false);
    };
    const interval = window.setInterval(() => syncIfNeeded(false), 30_000);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled]);
}

/** Asignaciones despachadas de una ruta en una fecha (espejo de lo enviado a la app). */
export function planillaAssignmentsForRoute(
  assignments: DailyCollectionAssignment[],
  routeName: string,
  collectorRef: string | undefined,
  date: string,
) {
  if (!collectorRef) return [];
  return assignments
    .filter(
      (row) =>
        row.dispatchDate === date &&
        row.dispatched &&
        row.collectorRef === collectorRef &&
        (row.clientRoute === routeName || row.clientRoute === String(routeName)),
    )
    .slice()
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}
