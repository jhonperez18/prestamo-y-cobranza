"use client";

import { useEffect, useState } from "react";
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
  return { date, opening, closing, efectivo, gastos, prestamos };
}

/**
 * Días pasados de una caja (M, A, N) calculados por el servidor (nube completa). Sin señal o con error
 * queda la última lectura buena (o `null`: el celular calcula con lo que tiene).
 */
export function useRouteCashBook(
  collectorRef: string,
  route: string | null,
  refreshKey: string,
): RouteCashBook | null {
  const [book, setBook] = useState<{ key: string; days: RouteCashBook } | null>(null);
  const key = route && hasRouteCashBook(route) ? `${collectorRef}|${route.trim().toUpperCase()}` : "";

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const [ref, routeKey] = key.split("|");
    const load = async () => {
      try {
        const params = new URLSearchParams({ collectorRef: ref, route: routeKey });
        const res = await fetch(`/api/ops/route-cash-book?${params}`, { cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; days?: unknown[]; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const days: RouteCashBook = new Map();
        for (const raw of body.days ?? []) {
          const day = toBookDay(raw);
          if (day) days.set(day.date, day);
        }
        if (alive) setBook({ key, days });
      } catch (error) {
        console.error("route-cash-book-load", error);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [key, refreshKey]);

  return book && book.key === key ? book.days : null;
}
