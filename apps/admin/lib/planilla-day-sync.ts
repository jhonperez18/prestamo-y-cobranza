"use client";

import { useEffect, useMemo, useRef } from "react";
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
  type LoanRow,
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
  planillaCashCloses?: import("@/lib/planilla-cash-chain").PlanillaCashCloseRecord[];
  autoClosedCount: number;
}) => void;

/**
 * Firma de cierres: ref + saldo + sellado. Un CIE- provisional que pasa a sellado (mismo ref)
 * o que cambia de saldo es otro Inicial de M: el ciclo tiene que verlo.
 */
function dayClosesKey(dayCloses: CollectorDayCloseRecord[]) {
  return dayCloses
    .map((row) => `${row.ref}:${row.cashFloat}:${row.provisional ? 1 : 0}:${row.closedAt || ""}`)
    .sort()
    .join(",");
}

/** Entradas del ciclo (no incluye planilla/rutas diarias: esas son salida y reentrarían en bucle). */
function inputKey(state: PlanillaDayState) {
  const payments = state.payments
    .map((row) => `${row.ref}:${row.amount}:${row.paidDate || ""}`)
    .sort()
    .join("|");
  const closes = dayClosesKey(state.dayCloses);
  const cashChain = (state.planillaCashCloses ?? [])
    .map((row) => `${row.ref}:${row.closingCash}`)
    .sort()
    .join("|");
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
    .map(
      (row) =>
        `${row.ref}:${row.balance}:${row.paid}:${row.status}:${Number(row.installment) || 0}:${(row.schedule ?? [])[0]?.date || ""}:${row.schedule?.length || 0}`,
    )
    .sort()
    .join("|");
  const catalog = state.routes
    .filter((row) => !row.ref.startsWith("RUT-D-"))
    .map((row) => `${row.ref}:${row.collectorRef || ""}:${routeIsActive(row) ? 1 : 0}`)
    .sort()
    .join("|");
  return [payments, closes, cashChain, expenses, clients, collectors, loans, catalog].join("::");
}

type OutputState = {
  assignments: DailyCollectionAssignment[];
  routes: RouteRow[];
  loans: LoanRow[];
  logs: CollectorDailyLogRow[];
  dayCloses: CollectorDayCloseRecord[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  planillaCashCloses?: import("@/lib/planilla-cash-chain").PlanillaCashCloseRecord[];
};

function outputParts(state: OutputState): unknown[] {
  return [
    state.assignments,
    state.routes,
    state.loans,
    state.logs,
    state.dayCloses,
    state.dayExpenseDrafts,
    state.planillaCashCloses,
  ];
}

/** Las listas de estado no se mutan: mismas listas ⇒ misma firma (5 000+ visitas no se re-firman). */
function cachedOutputKey(
  cache: { parts: unknown[]; key: string } | null,
  state: OutputState,
): { parts: unknown[]; key: string } {
  const parts = outputParts(state);
  if (cache && cache.parts.every((part, index) => part === parts[index])) return cache;
  return { parts, key: outputKey(state) };
}

/** Salida operativa: decide si hace falta setState. */
function outputKey(state: OutputState) {
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
    .map(
      (row) =>
        `${row.ref}:${row.balance}:${row.paid}:${row.status}:${Number(row.installment) || 0}:${(row.schedule ?? [])[0]?.date || ""}:${row.schedule?.length || 0}`,
    )
    .sort()
    .join("|");
  const closes = dayClosesKey(state.dayCloses);
  const cashChain = (state.planillaCashCloses ?? [])
    .map((row) => `${row.ref}:${row.closingCash}`)
    .sort()
    .join("|");
  const expenses = state.dayExpenseDrafts
    .map((row) => `${row.collectorRef}:${row.date}:${row.expenses?.length ?? 0}`)
    .sort()
    .join("|");
  return [assignments, routes, loans, closes, cashChain, expenses, state.logs.length].join("::");
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
  const outputCacheRef = useRef<{ parts: unknown[]; key: string } | null>(null);
  const lastRunAtRef = useRef(0);
  const trigger = useMemo(
    () => inputKey(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la firma solo lee estas listas
    [
      state.payments,
      state.dayCloses,
      state.planillaCashCloses,
      state.dayExpenseDrafts,
      state.clients,
      state.collectors,
      state.loans,
      state.routes,
    ],
  );

  useEffect(() => {
    if (!enabled) return;

    function syncNow() {
      lastRunAtRef.current = Date.now();
      const current = stateRef.current;
      outputCacheRef.current = cachedOutputKey(outputCacheRef.current, current);
      const before = outputCacheRef.current.key;
      const next = runOperationalDayCycle(current);
      outputCacheRef.current = cachedOutputKey(outputCacheRef.current, next);
      const after = outputCacheRef.current.key;

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
        planillaCashCloses: next.planillaCashCloses,
        autoClosedCount: next.autoClosed.length,
      });
    }

    syncNow();

    // Al volver a la app llegan `visibilitychange` y `focus` juntos: un solo ciclo.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRunAtRef.current < 1_000) return;
      syncNow();
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
    // Toda la ruta del día: cobros + Completar (sin préstamo).
    .filter((row) => !row.itemId.includes(":ruta"))
    .filter((row) => {
      const key = row.itemId || `${row.loanRef}:${row.clientRef}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice()
    .sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}
