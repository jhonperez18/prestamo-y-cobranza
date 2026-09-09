"use client";

import { useEffect, useRef } from "react";
import {
  runOperationalDayCycle,
  type OperationalDayState,
} from "@/lib/collector-day-auto-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import type {
  CollectorDayCloseRecord,
  CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import {
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";

export type PlanillaDayState = OperationalDayState;

export type PlanillaDayApply = (next: {
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  logs: CollectorDailyLogRow[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  autoClosedCount: number;
}) => void;

/** Entradas del ciclo (no incluye planilla/rutas diarias: esas son salida y reentrarían en bucle). */
function inputKey(state: PlanillaDayState) {
  const payments = state.payments
    .map((row) => `${row.ref}:${row.amount}:${row.paidDate || ""}`)
    .sort()
    .join("|");
  const closes = state.dayCloses
    .map((row) => row.ref)
    .sort()
    .join(",");
  const expenses = state.dayExpenseDrafts
    .map((row) => `${row.collectorRef}:${row.date}:${row.expenses?.length ?? 0}`)
    .sort()
    .join("|");
  const clients = state.clients
    .map((row) => `${row.ref}:${row.route}:${row.awaitingLoan ? 1 : 0}`)
    .sort()
    .join("|");
  const collectors = state.collectors
    .map((row) => row.ref)
    .sort()
    .join("|");
  const loans = state.loans
    .map((row) => `${row.ref}:${row.balance}:${row.paid}:${row.status}`)
    .sort()
    .join("|");
  const catalog = state.routes
    .filter((row) => !row.ref.startsWith("RUT-D-"))
    .map((row) => `${row.ref}:${row.collectorRef || ""}:${routeIsActive(row) ? 1 : 0}`)
    .sort()
    .join("|");
  return [payments, closes, expenses, clients, collectors, loans, catalog].join("::");
}

/** Salida operativa: decide si hace falta setState. */
function outputKey(state: {
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  logs: CollectorDailyLogRow[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
}) {
  const assignments = state.assignments
    .map(
      (row) =>
        `${row.dispatchDate}:${row.collectorRef}:${row.itemId}:${row.visitStatus}:${row.paymentRef || ""}:${row.dayClosedAt || ""}:${row.amountDue}:${row.dispatched ? 1 : 0}`,
    )
    .sort()
    .join("|");
  const routes = state.routes
    .map(
      (row) =>
        `${row.ref}:${row.status}:${row.kind}:${row.collectorRef || ""}:${(row.stops ?? [])
          .map((s) => `${s.clientRef}:${s.visitStatus}:${s.paymentRef || ""}:${s.amountDue}`)
          .join(",")}`,
    )
    .sort()
    .join("|");
  const loans = state.loans
    .map((row) => `${row.ref}:${row.balance}:${row.paid}:${row.status}`)
    .sort()
    .join("|");
  const closes = state.dayCloses
    .map((row) => row.ref)
    .sort()
    .join(",");
  const expenses = state.dayExpenseDrafts
    .map((row) => `${row.collectorRef}:${row.date}:${row.expenses?.length ?? 0}`)
    .sort()
    .join("|");
  return [assignments, routes, loans, closes, expenses, state.logs.length].join("::");
}

/**
 * Ciclo operativo continuo:
 * 1) cierra jornadas vencidas (23:30 / días previos),
 * 2) regenera la planilla de hoy.
 * Se dispara al hidratar, al cambiar datos de entrada, al volver a la pestaña y cada 30s.
 */
export function usePlanillaDayRollover(
  enabled: boolean,
  state: PlanillaDayState,
  apply: PlanillaDayApply,
) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const lastOutputRef = useRef<string>("");
  const trigger = inputKey(state);

  useEffect(() => {
    if (!enabled) return;

    function syncNow() {
      const current = stateRef.current;
      const before = outputKey(current);
      const next = runOperationalDayCycle(current);
      const after = outputKey(next);

      if (next.autoClosed.length === 0 && after === before) return;
      if (next.autoClosed.length === 0 && after === lastOutputRef.current) return;

      lastOutputRef.current = after;
      applyRef.current({
        assignments: next.assignments,
        routes: next.routes,
        loans: next.loans,
        logs: next.logs,
        dayCloses: next.dayCloses,
        dayExpenseDrafts: next.dayExpenseDrafts,
        autoClosedCount: next.autoClosed.length,
      });
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
  }, [enabled, trigger]);
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
