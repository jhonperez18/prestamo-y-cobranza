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

/** Lectura de la ficha en la nube. Cada llamada trae el saldo actual. */
export async function fetchRouteSheet(): Promise<RouteSheet | null> {
  try {
    const [clientsRes, loansRes] = await Promise.all([
      fetch("/api/clients", { cache: "no-store" }),
      fetch("/api/loans", { cache: "no-store" }),
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
 * Una sola lectura de la ficha por apertura. No se guarda en el aparato:
 * la copia local no puede pintar otra hoja ni otra cartera.
 */
export function useRouteSheet(active: boolean): RouteSheetState {
  const [state, setState] = useState<RouteSheetState>(() =>
    cached ? { status: "ready", sheet: cached } : { status: active ? "loading" : "idle", sheet: null },
  );

  useEffect(() => {
    if (!active) return;
    let alive = true;
    if (cached) {
      setState({ status: "ready", sheet: cached });
      return;
    }
    setState({ status: "loading", sheet: null });
    void loadRouteSheetOnce().then((sheet) => {
      if (!alive) return;
      setState(sheet ? { status: "ready", sheet } : { status: "error", sheet: null });
    });
    return () => {
      alive = false;
    };
  }, [active]);

  return state;
}
