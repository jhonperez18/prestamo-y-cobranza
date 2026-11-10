"use client";

/**
 * Detalle ruta+día (gastos / préstamos / efectivo / banco|nequi / N/P).
 *
 * Ley: si la lista local no cuadra con el total de pantalla, manda
 * `/api/ops/route-day-detail`. Mientras baja → loading; no lista incompleta.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import {
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
  const needGastos = input.gastosTotal > 0 && !gastosOk;
  const needPrestamos = input.prestamosTotal > 0 && !prestamosOk;
  const needFetch =
    input.enabled &&
    Boolean(input.route) &&
    (needGastos || needPrestamos || Boolean(input.needCollections));

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

    const req = ++reqRef.current;
    setLoading(true);
    setFetched(false);
    let cancelled = false;
    void refreshCloudRouteDayDetail(collectorRef, date, route, { force: true }).then((row) => {
      if (cancelled || req !== reqRef.current) return;
      setCloud(row);
      setLoading(false);
      setFetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, [
    needFetch,
    input.collectorRef,
    input.date,
    input.route,
    needGastos,
    needPrestamos,
    input.needCollections,
  ]);

  return useMemo(() => {
    const remoteGastos = cloud?.gastoLines ?? emptyCloud.gastoLines;
    const remotePrestamos = cloud?.prestamoLines ?? emptyCloud.prestamoLines;
    const pick = (
      ok: boolean,
      local: RouteExpenseLine[],
      remote: RouteExpenseLine[],
      total: number,
      wantRemote: boolean,
    ): RouteExpenseLine[] => {
      if (Math.trunc(Number(total) || 0) <= 0) return [];
      if (ok) return local;
      if (remote.length) return remote;
      if (wantRemote && fetched && !loading) return [];
      if (wantRemote) return [];
      return local;
    };
    return {
      gastoLines: pick(gastosOk, input.localGastos, remoteGastos, input.gastosTotal, needGastos),
      prestamoLines: pick(
        prestamosOk,
        input.localPrestamos,
        remotePrestamos,
        input.prestamosTotal,
        needPrestamos,
      ),
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
    needGastos,
    needPrestamos,
    input.localGastos,
    input.localPrestamos,
    input.gastosTotal,
    input.prestamosTotal,
    cloud,
    loading,
    fetched,
  ]);
}
