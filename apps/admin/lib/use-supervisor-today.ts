"use client";

import { useEffect, useState } from "react";
import type { CollectorDayCloseRecord, CollectorDayExpenseDraft } from "@/lib/collector-day-close";
import { previousCalendarIso } from "@/lib/collector-day-auto-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { PaymentRow } from "@/lib/mock-data";

export type SupervisorTodayData = {
  date: string;
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  expenses: CollectorDayExpenseDraft[];
};

type SupervisorTodayState = {
  status: "idle" | "loading" | "ready" | "error";
  data: SupervisorTodayData | null;
};

/**
 * El día se pide al abrir y, como mucho, una vez por minuto al volver a la app.
 * Cambiar de pestaña no vuelve a bajar los cierres.
 */
export function useSupervisorToday(enabled: boolean, refreshKey: string): SupervisorTodayState {
  const [state, setState] = useState<SupervisorTodayState>({
    status: enabled ? "loading" : "idle",
    data: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let lastOk = 0;
    const load = async (force: boolean) => {
      if (!force && Date.now() - lastOk < 60_000) return;
      try {
        const res = await fetch("/api/ops/supervisor-today", { cache: "no-store" });
        const body = (await res.json()) as SupervisorTodayData & { ok?: boolean; error?: string };
        if (!res.ok || !body.ok || !body.date) throw new Error(body.error || `HTTP ${res.status}`);
        if (!alive) return;
        lastOk = Date.now();
        setState({
          status: "ready",
          data: {
            date: body.date,
            payments: Array.isArray(body.payments) ? body.payments : [],
            assignments: Array.isArray(body.assignments) ? body.assignments : [],
            dayCloses: Array.isArray(body.dayCloses) ? body.dayCloses : [],
            expenses: Array.isArray(body.expenses) ? body.expenses : [],
          },
        });
      } catch (error) {
        console.error("supervisor-today", error);
        if (!alive) return;
        setState((prev) => (prev.data ? { status: "ready", data: prev.data } : { status: "error", data: null }));
      }
    };
    void load(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, refreshKey]);

  return state;
}

export type RouteAAnchor = { date: string; saldo: number };
export type RouteOwnAnchor = { date: string; saldo: number; route: "A" | "N" };

/**
 * Inicial M del día desde la base (Fase 3.1). Rellena la caché que lee
 * openingCashForChainedPlanilla. Devuelve un epoch para re-pintar el libro.
 * Si no contesta, sigue el CIE local.
 */
export function useChainMOpening(
  enabled: boolean,
  collectorRefs: readonly string[],
  today: string,
): number {
  const key = collectorRefs.filter(Boolean).slice().sort().join(",");
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!enabled || !key || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return;
    let alive = true;
    const load = async () => {
      const { refreshCloudChainMOpening } = await import("@/lib/cloud-chain-m-opening");
      const { refreshCloudDayCashFigure } = await import("@/lib/cloud-day-cash-figure");
      const refs = key.split(",").filter(Boolean);
      await Promise.all(
        refs.flatMap((ref) => [
          refreshCloudChainMOpening(ref, today),
          refreshCloudDayCashFigure(ref, today),
        ]),
      );
      if (!alive) return;
      setEpoch((n) => n + 1);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, key, today]);
  return epoch;
}

/**
 * Fase 3.3: Banco / Nequi desde la base. Epoch para re-pintar totales.
 */
export function useDigitalPoolBalancesCloud(enabled: boolean): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void import("@/lib/cloud-digital-pool-balances").then(({ refreshCloudDigitalPoolBalances }) => {
      void refreshCloudDigitalPoolBalances().then((row) => {
        if (alive && row) setEpoch((n) => n + 1);
      });
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return epoch;
}

/**
 * Caja A/N: ancla de ayer + saldo de hoy en caché (route_own_box).
 * Sin red, la pantalla sigue con su copia local.
 */
export function useRouteOwnAnchor(
  enabled: boolean,
  collectorRefs: readonly string[],
  today: string,
  route: "A" | "N",
) {
  const key = collectorRefs.filter(Boolean).slice().sort().join(",");
  const [anchors, setAnchors] = useState<Record<string, RouteOwnAnchor>>({});
  const [, setEpoch] = useState(0);

  useEffect(() => {
    if (!enabled || !key || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return;
    let alive = true;
    const yesterday = previousCalendarIso(today);
    const load = async () => {
      const { refreshCloudRouteOwnBox } = await import("@/lib/cloud-route-own-box");
      const refs = key.split(",").filter(Boolean);
      const next: Record<string, RouteOwnAnchor> = {};
      await Promise.all(
        refs.map(async (collectorRef) => {
          const [yesterdayRow, todayRow] = await Promise.all([
            refreshCloudRouteOwnBox(collectorRef, yesterday, route),
            refreshCloudRouteOwnBox(collectorRef, today, route),
          ]);
          if (yesterdayRow) {
            next[collectorRef] = {
              date: yesterday,
              saldo: yesterdayRow.saldo,
              route,
            };
          }
          void todayRow;
        }),
      );
      if (!alive) return;
      if (Object.keys(next).length > 0) setAnchors(next);
      setEpoch((n) => n + 1);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, key, today, route]);

  return anchors;
}

/** Compat: ancla de A (ayer). */
export function useRouteAAnchor(enabled: boolean, collectorRefs: readonly string[], today: string) {
  return useRouteOwnAnchor(enabled, collectorRefs, today, "A");
}

/** Ancla de N (ayer) + saldo de hoy en caché. */
export function useRouteNAnchor(enabled: boolean, collectorRefs: readonly string[], today: string) {
  return useRouteOwnAnchor(enabled, collectorRefs, today, "N");
}

export type NequiSaldo = {
  cobrado: number;
  prestado: number;
  gastos: number;
  saldo: number;
};

/**
 * Nequi de la ruta A, leído en el servidor al abrir.
 * Si no contesta, la pantalla sigue con su copia.
 */
export function useNequiSaldo(enabled: boolean): NequiSaldo | null {
  const [saldo, setSaldo] = useState<NequiSaldo | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/ops/nequi-saldo", { cache: "no-store" });
        const body = (await res.json()) as NequiSaldo & { ok?: boolean };
        if (!res.ok || body.ok !== true) return;
        const next = {
          cobrado: Math.trunc(Number(body.cobrado)),
          prestado: Math.trunc(Number(body.prestado)),
          gastos: Math.trunc(Number(body.gastos)),
          saldo: Math.trunc(Number(body.saldo)),
        };
        if (Object.values(next).some((value) => !Number.isFinite(value))) return;
        if (!alive) return;
        setSaldo(next);
      } catch (error) {
        console.error("nequi-saldo", error);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return saldo;
}
