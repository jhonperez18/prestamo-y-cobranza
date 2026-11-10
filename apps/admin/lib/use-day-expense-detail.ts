"use client";

/**
 * Detalle de los botones «Lo que gastó» / «Lo que prestó».
 * Misma puerta en cobrador, supervisor y vista PC.
 *
 * Total de pantalla (nube / libro) manda. Si la lista local está vacía o su suma
 * no cuadra con ese total, se baja GAS- de Supabase una vez y se pinta ese detalle.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { RouteExpenseLine } from "@/lib/collector-day-close";
import {
  operativeExpenseLinesForRouteFromDrafts,
  prestamoExpenseLinesForRouteFromDrafts,
  refreshCloudDayExpenses,
} from "@/lib/cloud-day-expenses";
import type { ClientRow, LoanRow } from "@/lib/mock-data";

export type DayExpenseDetailInput = {
  collectorRef: string;
  collectorName?: string;
  date: string;
  route: string | null | undefined;
  chainCollector: boolean;
  clients: ClientRow[];
  loans: LoanRow[];
  /** Ya hay renglones locales de gasto (libro / CIE / GAS- en el aparato). */
  localGastos: RouteExpenseLine[];
  /** Ya hay renglones locales de préstamo en efectivo. */
  localPrestamos: RouteExpenseLine[];
  /** Cuadre / historial a la vista: hay que completar detalle si falta. */
  enabled: boolean;
  /** Total en pantalla: si no cuadra con la lista local, obligar bajada. */
  gastosTotal: number;
  prestamosTotal: number;
};

export type DayExpenseDetail = {
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  loading: boolean;
};

function linesSum(lines: RouteExpenseLine[]): number {
  let total = 0;
  for (const line of lines) total += Math.trunc(Number(line.amount) || 0);
  return total;
}

/** Lista local sirve solo si suma exactamente el total de pantalla. */
function localMatchesTotal(lines: RouteExpenseLine[], total: number): boolean {
  const want = Math.trunc(Number(total) || 0);
  if (want <= 0) return lines.length === 0;
  return lines.length > 0 && linesSum(lines) === want;
}

export function useDayExpenseDetail(input: DayExpenseDetailInput): DayExpenseDetail {
  const [remoteGastos, setRemoteGastos] = useState<RouteExpenseLine[]>([]);
  const [remotePrestamos, setRemotePrestamos] = useState<RouteExpenseLine[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const gastosOk = localMatchesTotal(input.localGastos, input.gastosTotal);
  const prestamosOk = localMatchesTotal(input.localPrestamos, input.prestamosTotal);
  const needGastos = input.gastosTotal > 0 && !gastosOk;
  const needPrestamos = input.prestamosTotal > 0 && !prestamosOk;
  const needFetch = input.enabled && (needGastos || needPrestamos);

  useEffect(() => {
    if (!needFetch) {
      setRemoteGastos([]);
      setRemotePrestamos([]);
      setLoading(false);
      return;
    }
    const collectorRef = input.collectorRef.trim();
    const date = input.date;
    const route = input.route;
    if (!collectorRef || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const req = ++reqRef.current;
    setLoading(true);
    let cancelled = false;
    void refreshCloudDayExpenses(collectorRef, date).then((rows) => {
      if (cancelled || req !== reqRef.current) return;
      if (!rows?.length) {
        setRemoteGastos([]);
        setRemotePrestamos([]);
        setLoading(false);
        return;
      }
      setRemoteGastos(
        operativeExpenseLinesForRouteFromDrafts(rows, route, input.chainCollector),
      );
      setRemotePrestamos(
        prestamoExpenseLinesForRouteFromDrafts(
          rows,
          route,
          input.clients,
          input.loans,
          date,
        ),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    needFetch,
    input.collectorRef,
    input.date,
    input.route,
    input.chainCollector,
    input.clients,
    input.loans,
    needGastos,
    needPrestamos,
  ]);

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
      // Mientras baja o si la nube no trajo renglones: no pintar lista incompleta.
      if (wantRemote && (loading || remote.length === 0)) return [];
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
    loading,
  ]);
}
