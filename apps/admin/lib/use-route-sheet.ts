"use client";

import { useEffect, useState } from "react";
import type { ClientRow, LoanRow } from "@/lib/mock-data";
import {
  isClientDeletedStatus,
  isLoanDeletedStatus,
  mirrorToClientRow,
  mirrorToLoanRow,
  type ClientMirrorRow,
  type LoanMirrorRow,
} from "@/lib/supabase/catalog-mirror";

export type RouteSheet = {
  clients: ClientRow[];
  loans: LoanRow[];
};

type RouteSheetState = {
  status: "idle" | "loading" | "ready" | "error";
  sheet: RouteSheet | null;
};

let cached: RouteSheet | null = null;
let pending: Promise<RouteSheet | null> | null = null;

const FETCH_MS = 12_000;

/** Suelta la ficha en memoria (préstamo nuevo / pull) para volver a leer la base. */
export function clearRouteSheetCache() {
  cached = null;
  pending = null;
}

/** Lectura de la ficha en la nube. Cada llamada trae el saldo actual. */
export async function fetchRouteSheet(): Promise<RouteSheet | null> {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    ctrl && typeof window !== "undefined"
      ? window.setTimeout(() => ctrl.abort(), FETCH_MS)
      : 0;
  try {
    const [clientsRes, loansRes] = await Promise.all([
      fetch("/api/clients", { cache: "no-store", signal: ctrl?.signal }),
      fetch("/api/loans", { cache: "no-store", signal: ctrl?.signal }),
    ]);
    const clientsBody = (await clientsRes.json()) as { ok?: boolean; clients?: ClientMirrorRow[] };
    const loansBody = (await loansRes.json()) as { ok?: boolean; loans?: LoanMirrorRow[] };
    if (!clientsRes.ok || !loansRes.ok || !clientsBody.ok || !loansBody.ok) return null;
    const clients = (clientsBody.clients ?? [])
      .map(mirrorToClientRow)
      .filter((row): row is ClientRow => Boolean(row))
      .filter((row) => !isClientDeletedStatus(row));
    const loans = (loansBody.loans ?? [])
      .map(mirrorToLoanRow)
      .filter((row): row is LoanRow => Boolean(row))
      .filter((row) => !isLoanDeletedStatus(row));
    if (!clients.length || !loans.length) return null;
    return { clients, loans };
  } catch (error) {
    console.error("route-sheet", error);
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

function loadRouteSheetOnce(): Promise<RouteSheet | null> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = fetchRouteSheet()
      .then((next) => {
        if (next) cached = next;
        return next;
      })
      .finally(() => {
        if (!cached) pending = null;
      });
  }
  return pending;
}

/**
 * Clientes y préstamos de CLIENTES, PRÉSTAMOS y de la cartera del informe.
 * Lee la ficha en la nube. `refreshKey` fuerza otra bajada (préstamo nuevo en planilla).
 * No se guarda en el aparato: la copia local no puede pintar otra hoja ni otra cartera.
 *
 * La planilla del cobrador NO espera esto: pinta con la copia local y completa huecos.
 */
export function useRouteSheet(active: boolean, refreshKey = ""): RouteSheetState {
  const [state, setState] = useState<RouteSheetState>(() =>
    cached ? { status: "ready", sheet: cached } : { status: active ? "loading" : "idle", sheet: null },
  );

  useEffect(() => {
    if (!active) return;
    let alive = true;
    if (refreshKey) {
      clearRouteSheetCache();
    } else if (cached) {
      setState({ status: "ready", sheet: cached });
      return;
    }
    setState((prev) => ({ status: "loading", sheet: prev.sheet }));
    void loadRouteSheetOnce().then((sheet) => {
      if (!alive) return;
      if (sheet) {
        setState({ status: "ready", sheet });
        return;
      }
      setState((prev) => ({ status: "error", sheet: prev.sheet }));
    });
    return () => {
      alive = false;
    };
  }, [active, refreshKey]);

  return state;
}
