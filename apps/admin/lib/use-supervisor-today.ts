"use client";

import { useEffect, useState } from "react";
import type { CollectorDayCloseRecord, CollectorDayExpenseDraft } from "@/lib/collector-day-close";
import { previousCalendarIso } from "@/lib/collector-day-auto-close";
import { previousMonthLastDayIso } from "@/lib/month-route-carry";
import {
  getCloudChainMOpening,
  refreshCloudChainMOpening,
} from "@/lib/cloud-chain-m-opening";
import { refreshCloudDayCashFigure } from "@/lib/cloud-day-cash-figure";
import { getCloudRouteOwnBox } from "@/lib/cloud-route-own-box";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { PaymentRow } from "@/lib/mock-data";
import { periodFromDateIso } from "@/lib/collector-day-close";

export type SupervisorTodayData = {
  date: string;
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  expenses: CollectorDayExpenseDraft[];
  paymentsReady: boolean;
  expensesReady: boolean;
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
      if (!force && Date.now() - lastOk < 45_000) return;
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer =
        ctrl && typeof window !== "undefined"
          ? window.setTimeout(() => ctrl.abort(), 14_000)
          : 0;
      try {
        const res = await fetch("/api/ops/supervisor-today", {
          cache: "no-store",
          signal: ctrl?.signal,
        });
        const body = (await res.json()) as SupervisorTodayData & { ok?: boolean; error?: string };
        if (!res.ok || !body.ok || !body.date) throw new Error(body.error || `HTTP ${res.status}`);
        if (!alive) return;
        lastOk = Date.now();
        const paymentsReady = body.paymentsReady !== false;
        const expensesReady = body.expensesReady !== false;
        setState({
          status: "ready",
          data: {
            date: body.date,
            payments: Array.isArray(body.payments) ? body.payments : [],
            assignments: Array.isArray(body.assignments) ? body.assignments : [],
            dayCloses: Array.isArray(body.dayCloses) ? body.dayCloses : [],
            expenses: Array.isArray(body.expenses) ? body.expenses : [],
            paymentsReady,
            expensesReady,
          },
        });
        // Misma puerta que el cobrador: day_cash_figure de la base, no cifra local vieja.
        const refs = [
          ...new Set(
            (Array.isArray(body.dayCloses) ? body.dayCloses : [])
              .map((row) => String(row.collectorRef || "").trim())
              .filter(Boolean),
          ),
        ];
        if (refs.length > 0) {
          void Promise.all(refs.map((ref) => refreshCloudDayCashFigure(ref, body.date)));
        }
      } catch (error) {
        console.error("supervisor-today", error);
        if (!alive) return;
        setState((prev) => (prev.data ? { status: "ready", data: prev.data } : { status: "error", data: null }));
      } finally {
        if (timer) window.clearTimeout(timer);
      }
    };
    void load(true);
    // Cada 45 s: los cobros del celular entran al supervisor sin esperar cambio de pestaña.
    const poll = window.setInterval(() => void load(false), 45_000);
    const onVisible = () => {
      // Al volver: pide el día (tope 45 s). Disco en servidor evita “cerrado” con hoja vieja.
      if (document.visibilityState === "visible") void load(false);
    };
    // Tras un pull ops visible, forzar una lectura fresca del día (CIE ayer+hoy).
    const onOpsPull = () => {
      lastOk = 0;
      void load(true);
    };
    window.addEventListener("nexo-ops-visible-pull", onOpsPull);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("nexo-ops-visible-pull", onOpsPull);
    };
  }, [enabled, refreshKey]);

  return state;
}

export type RouteAAnchor = { date: string; saldo: number };
export type RouteOwnAnchor = { date: string; saldo: number; route: "A" | "N" };

export type ChainMOpeningState = {
  /** Sube al terminar la bajada (ok o fallo) → re-pintar INICIO. */
  epoch: number;
  /**
   * true cuando ya se intentó bajar (o había caché de sesión).
   * Mientras sea false, INICIO no pinta CIE local (evita 5.428k → 82k).
   */
  settled: boolean;
};

/**
 * Inicial M del día desde la base (Fase 3.1). Rellena la caché que lee
 * openingCashForChainedPlanilla. Con sessionStorage el primer paint ya puede
 * ser el de la base; si no hay caché, `settled` frena el CIE local fantasma.
 */
export function useChainMOpening(
  enabled: boolean,
  collectorRefs: readonly string[],
  today: string,
): ChainMOpeningState {
  const key = collectorRefs.filter(Boolean).slice().sort().join(",");
  const [epoch, setEpoch] = useState(0);
  const warmReady = (refs: string[]) =>
    refs.length > 0 &&
    refs.every((ref) => {
      const row = getCloudChainMOpening(ref, today);
      return Boolean(row?.ready && row.opening != null);
    });
  const [settled, setSettled] = useState(() => {
    if (!enabled || !key || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
    return warmReady(key.split(",").filter(Boolean));
  });
  useEffect(() => {
    if (!enabled || !key || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return;
    let alive = true;
    let retryTimer = 0;
    const refs = key.split(",").filter(Boolean);
    // Caché de sesión con Inicial listo → primer paint ya es el real (sin «…»).
    if (warmReady(refs)) {
      setSettled(true);
    }
    const load = async () => {
      await Promise.all(
        refs.flatMap((ref) => [
          refreshCloudChainMOpening(ref, today),
          refreshCloudDayCashFigure(ref, today),
        ]),
      );
      if (!alive) return;
      // Solo «settled» con Inicial de la base. Timeout sin ready dejaba pintar
      // CIE local fantasma (5.428k). Historia 31/10 = estática vía chain_m_opening.
      if (warmReady(refs)) {
        setSettled(true);
        setEpoch((n) => n + 1);
        return;
      }
      setSettled(false);
      setEpoch((n) => n + 1);
      // Reintento corto: el servidor ya cachea en disco; 8 s dejaba INICIO en «…».
      retryTimer = window.setTimeout(() => {
        if (alive) void load();
      }, 2_000);
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(retryTimer);
    };
  }, [enabled, key, today]);
  return { epoch, settled };
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

export type PoolVisibleSaldoCloudState = {
  banco: number | null;
  nequi: number | null;
  settled: boolean;
  epoch: number;
};

/**
 * Saldo Banco/Nequi (rutas − gastos) desde el servidor con libro completo.
 * Hasta que conteste: «…». Cero pintar sesión/snap viejo (caso 6.766 vs 7.013).
 */
export function usePoolVisibleSaldoCloud(enabled: boolean, toIso: string): PoolVisibleSaldoCloudState {
  const [epoch, setEpoch] = useState(0);
  const [settled, setSettled] = useState(false);
  const [banco, setBanco] = useState<number | null>(null);
  const [nequi, setNequi] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return;
    let alive = true;
    setBanco(null);
    setNequi(null);
    setSettled(false);
    void import("@/lib/cloud-pool-visible-saldo").then(
      ({ clearCloudPoolVisibleSaldo, refreshCloudPoolVisibleSaldo }) => {
        clearCloudPoolVisibleSaldo();
        const pull = async (tries = 0) => {
          const row = await refreshCloudPoolVisibleSaldo(toIso);
          if (!alive) return;
          if (row && row.toIso === toIso) {
            setSettled(true);
            setBanco(row.banco);
            setNequi(row.nequi);
            setEpoch((n) => n + 1);
            return;
          }
          if (tries < 4) {
            window.setTimeout(() => {
              if (alive) void pull(tries + 1);
            }, 2_000 * (tries + 1));
            return;
          }
          setSettled(true);
        };
        void pull();
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, toIso]);

  return { banco, nequi, settled, epoch };
}

export type RouteOwnAnchorState = {
  anchors: Record<string, RouteOwnAnchor>;
  /** Sube cuando llegó route_own_box (ayer o hoy) → re-pintar INICIO. */
  epoch: number;
};

/**
 * Caja A/N: ancla de ayer + cierre del mes anterior + saldo de hoy (route_own_box).
 * El cierre del mes anterior arrastra la Inicial (caso N 31/10 → 1.311.500).
 * Sin red, la pantalla sigue con su copia local (o la última de esta sesión).
 */
export function useRouteOwnAnchor(
  enabled: boolean,
  collectorRefs: readonly string[],
  today: string,
  route: "A" | "N",
): RouteOwnAnchorState {
  const key = collectorRefs.filter(Boolean).slice().sort().join(",");
  const monthEnd = /^\d{4}-\d{2}-\d{2}$/.test(today)
    ? previousMonthLastDayIso(periodFromDateIso(today))
    : "";
  const [anchors, setAnchors] = useState<Record<string, RouteOwnAnchor>>(() => {
    if (!enabled || !key || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return {};
    const yesterday = previousCalendarIso(today);
    const next: Record<string, RouteOwnAnchor> = {};
    // Calentamiento síncrono (sessionStorage): el primer paint ya usa la cifra de la base.
    for (const collectorRef of key.split(",").filter(Boolean)) {
      const yesterdayRow = getCloudRouteOwnBox(collectorRef, yesterday, route);
      const monthRow =
        monthEnd && monthEnd !== yesterday
          ? getCloudRouteOwnBox(collectorRef, monthEnd, route)
          : null;
      if (yesterdayRow) {
        next[collectorRef] = { date: yesterday, saldo: yesterdayRow.saldo, route };
      } else if (monthRow) {
        next[collectorRef] = { date: monthEnd, saldo: monthRow.saldo, route };
      }
      void getCloudRouteOwnBox(collectorRef, today, route);
    }
    return next;
  });
  const [epoch, setEpoch] = useState(0);

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
          const jobs: Array<Promise<unknown>> = [
            refreshCloudRouteOwnBox(collectorRef, yesterday, route),
            refreshCloudRouteOwnBox(collectorRef, today, route),
          ];
          if (monthEnd && monthEnd !== yesterday && monthEnd !== today) {
            jobs.push(refreshCloudRouteOwnBox(collectorRef, monthEnd, route));
          }
          const [yesterdayRow, todayRow, monthRow] = (await Promise.all(jobs)) as [
            Awaited<ReturnType<typeof refreshCloudRouteOwnBox>>,
            Awaited<ReturnType<typeof refreshCloudRouteOwnBox>>,
            Awaited<ReturnType<typeof refreshCloudRouteOwnBox>> | undefined,
          ];
          // Más reciente antes de hoy gana (ayer > cierre de mes).
          if (yesterdayRow) {
            next[collectorRef] = {
              date: yesterday,
              saldo: yesterdayRow.saldo,
              route,
            };
          } else if (monthRow) {
            next[collectorRef] = {
              date: monthEnd,
              saldo: monthRow.saldo,
              route,
            };
          } else if (todayRow) {
            // Día 1 / sin ancla de ayer: el Inicial de hoy lo da la base.
            next[collectorRef] = {
              date: today,
              saldo: todayRow.opening,
              route,
            };
          }
        }),
      );
      if (!alive) return;
      setAnchors(next);
      setEpoch((n) => n + 1);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, key, today, route, monthEnd]);

  return { anchors, epoch };
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
