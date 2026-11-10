"use client";

/**
 * Detalle de los botones «Lo que gastó» / «Lo que prestó».
 * Local si ya está completo; si no, una sola bajada a Supabase (GAS-/CIE).
 * Misma puerta en cobrador, supervisor y vista PC.
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
  /** Total en pantalla: si > 0 y lista vacía, obligar bajada. */
  gastosTotal: number;
  prestamosTotal: number;
};

export type DayExpenseDetail = {
  gastoLines: RouteExpenseLine[];
  prestamoLines: RouteExpenseLine[];
  loading: boolean;
};

export function useDayExpenseDetail(input: DayExpenseDetailInput): DayExpenseDetail {
  const [remoteGastos, setRemoteGastos] = useState<RouteExpenseLine[]>([]);
  const [remotePrestamos, setRemotePrestamos] = useState<RouteExpenseLine[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  const needGastos = input.gastosTotal > 0 && input.localGastos.length === 0;
  const needPrestamos = input.prestamosTotal > 0 && input.localPrestamos.length === 0;
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

  return useMemo(
    () => ({
      gastoLines: input.localGastos.length ? input.localGastos : remoteGastos,
      prestamoLines: input.localPrestamos.length ? input.localPrestamos : remotePrestamos,
      loading,
    }),
    [input.localGastos, input.localPrestamos, remoteGastos, remotePrestamos, loading],
  );
}
