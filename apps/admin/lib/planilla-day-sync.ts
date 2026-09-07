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

function todayOpenCount(assignments: DailyCollectionAssignment[], date: string) {
  return assignments.filter(
    (row) => row.dispatchDate === date && row.dispatched && !row.dayClosedAt,
  ).length;
}

/**
 * Regenera la planilla Lun–sáb y la deja despachada a la app.
 * Se dispara al hidratar, al cambiar rutas/préstamos/clientes, al volver a la pestaña
 * y cada 30s (antes solo corría al cambiar de día y podía dejar el día sin cobros).
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

  useEffect(() => {
    if (!enabled) return;

    function syncNow() {
      const date = todayIso();
      const current = stateRef.current;
      const synced = syncPermanentRoutePlanilla(
        date,
        current.routes,
        current.clients,
        current.loans,
        current.collectors,
        current.assignments,
      );

      const before = todayOpenCount(current.assignments, date);
      const after = todayOpenCount(synced.assignments, date);
      const routesChanged = synced.routes !== current.routes;
      if (before === after && !routesChanged) {
        // Misma cantidad de cobros abiertos: igual aplica si cambió el contenido del día.
        const prevIds = current.assignments
          .filter((row) => row.dispatchDate === date && !row.dayClosedAt)
          .map((row) => row.itemId)
          .sort()
          .join("|");
        const nextIds = synced.assignments
          .filter((row) => row.dispatchDate === date && !row.dayClosedAt)
          .map((row) => row.itemId)
          .sort()
          .join("|");
        if (prevIds === nextIds) return;
      }

      applyRef.current(synced);
    }

    syncNow();

    const onVisible = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    const interval = window.setInterval(syncNow, 30_000);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [
    enabled,
    state.loans,
    state.clients,
    state.routes,
    state.collectors,
  ]);
}

/** Asignaciones despachadas de una ruta en una fecha (espejo de lo enviado a la app). */
export function planillaAssignmentsForRoute(
  assignments: DailyCollectionAssignment[],
  routeName: string,
  collectorRef: string | undefined,
  date: string,
) {
  if (!collectorRef) return [];
  const seen = new Set<string>();
  return assignments
    .filter(
      (row) =>
        row.dispatchDate === date &&
        row.dispatched &&
        row.collectorRef === collectorRef &&
        (row.clientRoute === routeName || row.clientRoute === String(routeName)),
    )
    .filter((row) => {
      const key = row.itemId || `${row.loanRef}:${row.clientRef}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice()
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}
