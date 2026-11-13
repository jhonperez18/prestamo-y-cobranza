"use client";

import { useEffect, useState } from "react";
import {
  notifyCloudDayCashFigure,
  rememberCloudDayCashFigure,
} from "@/lib/cloud-day-cash-figure";
import {
  notifyCloudRouteOwnBox,
  rememberCloudRouteOwnBox,
} from "@/lib/cloud-route-own-box";
import {
  hasRouteCashBook,
  type RouteCashBook,
  type RouteCashBookDay,
} from "@/lib/independent-route-cash";

function toBookDay(raw: unknown): RouteCashBookDay | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const date = typeof row.date === "string" ? row.date : "";
  const nums = [row.opening, row.closing, row.efectivo, row.gastos, row.prestamos].map(Number);
  if (!date || nums.some((n) => !Number.isFinite(n))) return null;
  const [opening, closing, efectivo, gastos, prestamos] = nums;
  const cobrado = Number(row.cobrado);
  const dayFinal = Number(row.dayFinal);
  const cieRaw = row.cie;
  const cie =
    cieRaw == null || cieRaw === ""
      ? null
      : Number.isFinite(Number(cieRaw))
        ? Math.trunc(Number(cieRaw))
        : null;
  const mClosing = Number(row.mClosing);
  const tEfectivo = Number(row.tEfectivo);
  const tPrestamos = Number(row.tPrestamos);
  const tGastos = Number(row.tGastos);
  return {
    date,
    opening,
    closing,
    efectivo,
    gastos,
    prestamos,
    ...(Number.isFinite(cobrado) ? { cobrado } : {}),
    ...(Number.isFinite(dayFinal) ? { dayFinal: Math.trunc(dayFinal) } : {}),
    ...(cieRaw !== undefined ? { cie } : {}),
    ...(Number.isFinite(mClosing) ? { mClosing: Math.trunc(mClosing) } : {}),
    ...(Number.isFinite(tEfectivo) ? { tEfectivo: Math.trunc(tEfectivo) } : {}),
    ...(Number.isFinite(tPrestamos) ? { tPrestamos: Math.trunc(tPrestamos) } : {}),
    ...(Number.isFinite(tGastos) ? { tGastos: Math.trunc(tGastos) } : {}),
  };
}

/** Un libro = una bajada: también calienta cachés que leen Historial M/T/A/N. */
function seedCachesFromBook(
  collectorRef: string,
  route: string,
  days: RouteCashBook,
) {
  const pin = route.trim().toUpperCase();
  const fetchedAt = new Date().toISOString();
  let seededChain = 0;
  let seededOwn = 0;
  for (const day of days.values()) {
    if (pin === "M" && day.mClosing != null && Number.isFinite(day.mClosing)) {
      rememberCloudDayCashFigure(
        {
          collectorRef,
          date: day.date,
          ready: true,
          chain: true,
          opening: day.opening,
          mClosing: day.mClosing,
          dayFinal: day.dayFinal ?? null,
          cie: day.cie ?? null,
          saldo: day.dayFinal ?? day.mClosing,
          mEfectivo: day.efectivo,
          mPrestamos: day.prestamos,
          mGastos: day.gastos,
          tEfectivo: day.tEfectivo ?? null,
          tPrestamos: day.tPrestamos ?? null,
          tGastos: day.tGastos ?? null,
          fetchedAt,
        },
        { silent: true },
      );
      seededChain += 1;
      continue;
    }
    if (pin === "A" || pin === "N") {
      rememberCloudRouteOwnBox(
        {
          collectorRef,
          date: day.date,
          route: pin,
          opening: day.opening,
          efectivo: day.efectivo,
          prestamos: day.prestamos,
          gastos: day.gastos,
          saldo: day.closing,
          fetchedAt,
        },
        { silent: true },
      );
      seededOwn += 1;
    }
  }
  if (seededChain > 0) notifyCloudDayCashFigure();
  if (seededOwn > 0) notifyCloudRouteOwnBox();
}

/**
 * Días pasados de una caja (M, A, N) vía RPC del servidor.
 * `fromIso`/`toIso` acotan la ventana (historial del mes). Sin eso, el servidor
 * usa mes anterior + vivo. Abort a los 20 s: no deja el supervisor pegado.
 */
export function useRouteCashBook(
  collectorRef: string,
  route: string | null,
  refreshKey: string,
  range?: { fromIso?: string; toIso?: string } | null,
): RouteCashBook | null {
  const [book, setBook] = useState<{ key: string; days: RouteCashBook } | null>(null);
  const routeKey = route && hasRouteCashBook(route) ? route.trim().toUpperCase() : "";
  const fromIso = range?.fromIso && /^\d{4}-\d{2}-\d{2}$/.test(range.fromIso) ? range.fromIso : "";
  const toIso = range?.toIso && /^\d{4}-\d{2}-\d{2}$/.test(range.toIso) ? range.toIso : "";
  const key = routeKey ? `${collectorRef}|${routeKey}|${fromIso}|${toIso}` : "";

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const [ref, pin] = key.split("|");
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer =
      ctrl && typeof window !== "undefined"
        ? window.setTimeout(() => ctrl.abort(), 20_000)
        : 0;
    const load = async () => {
      try {
        const params = new URLSearchParams({ collectorRef: ref, route: pin });
        if (fromIso) params.set("from", fromIso);
        if (toIso) params.set("to", toIso);
        const res = await fetch(`/api/ops/route-cash-book?${params}`, {
          cache: "no-store",
          signal: ctrl?.signal,
        });
        const body = (await res.json()) as { ok?: boolean; days?: unknown[]; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const days: RouteCashBook = new Map();
        for (const raw of body.days ?? []) {
          const day = toBookDay(raw);
          if (day) days.set(day.date, day);
        }
        if (!alive) return;
        seedCachesFromBook(ref, pin, days);
        setBook({ key, days });
      } catch (error) {
        console.error("route-cash-book-load", error);
      } finally {
        if (timer) window.clearTimeout(timer);
      }
    };
    void load();
    return () => {
      alive = false;
      ctrl?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [key, refreshKey, fromIso, toIso]);

  return book && book.key === key ? book.days : null;
}
