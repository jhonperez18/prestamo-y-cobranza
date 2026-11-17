"use client";

/**
 * Detalle ruta+día (gastos / préstamos / efectivo / banco|nequi / N/P).
 *
 * Día sellado: si hay caché de sesión → pinta al instante (historial sin movimiento).
 * Hoy: fuerza lectura fresca. La nube manda la lista.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { businessTodayIso } from "@/lib/business-timezone";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import {
  getCloudRouteDayDetail,
  refreshCloudRouteDayDetail,
  type CloudRouteDayDetail,
} from "@/lib/cloud-route-day-detail";
import type { ClientRow, LoanRow } from "@/lib/mock-data";
import type { RouteDayNpLine, RouteDayPayLine } from "@/lib/server-route-day-detail";

export type DayExpenseDetailInput = {
  collectorRef: string;
  collectorName?: string;
  date: string;
  route: string | null | undefined;
  chainCollector: boolean;
  clients: ClientRow[];
  loans: LoanRow[];
  localGastos: RouteExpenseLine[];
  localPrestamos: RouteExpenseLine[];
  enabled: boolean;
  gastosTotal: number;
  prestamosTotal: number;
  /** También pedir cobros / N/P (misma puerta). */
  needCollections?: boolean;
};

export type DayExpenseDetail = {
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  loading: boolean;
  cloudGastosTotal: number | null;
  cloudPrestamosTotal: number | null;
  cloudReady: boolean;
  efectivoTotal: number | null;
  cashPays: RouteDayPayLine[];
  digitalTotal: number | null;
  digitalPays: RouteDayPayLine[];
  digitalPool: "banco" | "nequi" | null;
  npCount: number | null;
  npRows: RouteDayNpLine[];
};

function linesSum(lines: RouteExpenseLine[]): number {
  let total = 0;
  for (const line of lines) total += Math.trunc(Number(line.amount) || 0);
  return total;
}

function localMatchesTotal(lines: RouteExpenseLine[], total: number): boolean {
  const want = Math.trunc(Number(total) || 0);
  if (want <= 0) return lines.length === 0;
  return lines.length > 0 && linesSum(lines) === want;
}

const emptyCloud = {
  gastoLines: [] as RouteExpenseLine[],
  prestamoLines: [] as RouteExpenseLine[],
  cashPays: [] as RouteDayPayLine[],
  digitalPays: [] as RouteDayPayLine[],
  npRows: [] as RouteDayNpLine[],
  gastosTotal: null as number | null,
  prestamosTotal: null as number | null,
  efectivoTotal: null as number | null,
  digitalTotal: null as number | null,
  digitalPool: null as "banco" | "nequi" | null,
  npCount: null as number | null,
};

export function useDayExpenseDetail(input: DayExpenseDetailInput): DayExpenseDetail {
  const [cloud, setCloud] = useState<CloudRouteDayDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const reqRef = useRef(0);

  const gastosOk = localMatchesTotal(input.localGastos, input.gastosTotal);
  const prestamosOk = localMatchesTotal(input.localPrestamos, input.prestamosTotal);
  const needFetch = input.enabled && Boolean(input.route);

  useEffect(() => {
    if (!needFetch) {
      setCloud(null);
      setLoading(false);
      setFetched(false);
      return;
    }
    const collectorRef = input.collectorRef.trim();
    const date = input.date;
    const route = String(input.route || "").trim();
    if (!collectorRef || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !route) return;

    const today = businessTodayIso();
    const sealed = date < today;
    const warm = getCloudRouteDayDetail(collectorRef, date, route);
    const req = ++reqRef.current;
    let cancelled = false;

    // Historial sellado con foto en sesión → pintar ya (casi al instante).
    if (sealed && warm) {
      setCloud(warm);
      setLoading(false);
      setFetched(true);
      // Soft refresh sin bloquear (respeta TTL 12 h).
      void refreshCloudRouteDayDetail(collectorRef, date, route, {
        force: false,
        todayIso: today,
      }).then((row) => {
        if (cancelled || req !== reqRef.current || !row) return;
        setCloud(row);
      });
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setFetched(false);
    void refreshCloudRouteDayDetail(collectorRef, date, route, {
      // Solo el día vivo fuerza; el sellado usa caché.
      force: !sealed,
      todayIso: today,
    }).then((row) => {
      if (cancelled || req !== reqRef.current) return;
      setCloud(row);
      setLoading(false);
      setFetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needFetch, input.collectorRef, input.date, input.route, input.needCollections]);

  return useMemo(() => {
    const remoteGastos = cloud?.gastoLines ?? emptyCloud.gastoLines;
    const remotePrestamos = cloud?.prestamoLines ?? emptyCloud.prestamoLines;
    const pick = (
      ok: boolean,
      local: RouteExpenseLine[],
      remote: RouteExpenseLine[],
    ): RouteExpenseLine[] => {
      if (fetched && remote.length > 0) return remote;
      if (ok) return local;
      if (fetched && !loading) return remote;
      return local;
    };
    return {
      gastoLines: pick(gastosOk, input.localGastos, remoteGastos),
      prestamoLines: pick(prestamosOk, input.localPrestamos, remotePrestamos),
      loading,
      cloudGastosTotal: fetched && cloud ? cloud.gastosTotal : null,
      cloudPrestamosTotal: fetched && cloud ? cloud.prestamosTotal : null,
      cloudReady: fetched && Boolean(cloud),
      efectivoTotal: fetched && cloud ? cloud.efectivoTotal : null,
      cashPays: cloud?.cashPays ?? [],
      digitalTotal: fetched && cloud ? cloud.digitalTotal : null,
      digitalPays: cloud?.digitalPays ?? [],
      digitalPool: fetched && cloud ? cloud.digitalPool : null,
      npCount: fetched && cloud ? cloud.npCount : null,
      npRows: cloud?.npRows ?? [],
    };
  }, [
    gastosOk,
    prestamosOk,
    input.localGastos,
    input.localPrestamos,
    cloud,
    loading,
    fetched,
  ]);
}
