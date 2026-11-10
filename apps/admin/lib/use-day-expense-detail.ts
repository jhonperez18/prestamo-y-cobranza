"use client";

/**
 * Detalle «Lo que gastó» / «Lo que prestó».
 *
 * Ley: si la lista local no cuadra con el total de pantalla, manda la puerta
 * `/api/ops/route-day-detail` (renglones ya filtrados por ruta en el servidor).
 * Mientras baja → loading; no se pinta lista incompleta como si fuera la verdad.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import { refreshCloudRouteDayDetail } from "@/lib/cloud-route-day-detail";
import type { ClientRow, LoanRow } from "@/lib/mock-data";

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
};

export type DayExpenseDetail = {
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  loading: boolean;
  /** Totales de la puerta (si ya contestó). Sirven cuando el aparato no tiene renglones. */
  cloudGastosTotal: number | null;
  cloudPrestamosTotal: number | null;
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

export function useDayExpenseDetail(input: DayExpenseDetailInput): DayExpenseDetail {
  const [remoteGastos, setRemoteGastos] = useState<RouteExpenseLine[]>([]);
  const [remotePrestamos, setRemotePrestamos] = useState<RouteExpenseLine[]>([]);
  const [cloudGastosTotal, setCloudGastosTotal] = useState<number | null>(null);
  const [cloudPrestamosTotal, setCloudPrestamosTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const reqRef = useRef(0);

  const gastosOk = localMatchesTotal(input.localGastos, input.gastosTotal);
  const prestamosOk = localMatchesTotal(input.localPrestamos, input.prestamosTotal);
  const needGastos = input.gastosTotal > 0 && !gastosOk;
  const needPrestamos = input.prestamosTotal > 0 && !prestamosOk;
  const needFetch = input.enabled && Boolean(input.route) && (needGastos || needPrestamos);

  useEffect(() => {
    if (!needFetch) {
      setRemoteGastos([]);
      setRemotePrestamos([]);
      setCloudGastosTotal(null);
      setCloudPrestamosTotal(null);
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
      if (!row) {
        setRemoteGastos([]);
        setRemotePrestamos([]);
        setCloudGastosTotal(null);
        setCloudPrestamosTotal(null);
        setLoading(false);
        setFetched(true);
        return;
      }
      setRemoteGastos(row.gastoLines);
      setRemotePrestamos(row.prestamoLines);
      setCloudGastosTotal(row.gastosTotal);
      setCloudPrestamosTotal(row.prestamosTotal);
      setLoading(false);
      setFetched(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needFetch, input.collectorRef, input.date, input.route, needGastos, needPrestamos]);

  return useMemo(() => {
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
      // Bajó y la nube no tiene renglones: lista vacía (total puede ser de otra puerta).
      if (wantRemote && fetched && !loading) return [];
      // Mientras baja: no pintar local incompleto.
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
      cloudGastosTotal: fetched ? cloudGastosTotal : null,
      cloudPrestamosTotal: fetched ? cloudPrestamosTotal : null,
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
    remoteGastos,
    remotePrestamos,
    cloudGastosTotal,
    cloudPrestamosTotal,
    loading,
    fetched,
  ]);
}
