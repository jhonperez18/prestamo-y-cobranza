/**
 * Historial del sistema principal en celular / PWA.
 * El botón Atrás del aparato vuelve a la vista anterior (o cierra el cajón),
 * en lugar de salir del sitio de golpe.
 *
 * Importante: al arrancar se dejan 2 entradas propias. Si solo hay 1,
 * el primer Atrás cae fuera del sistema.
 */
import type { ModuleId } from "@/lib/navigation";

export const PHONE_SHELL_HISTORY_KIND = "nexo-phone-shell" as const;

export type PhoneShellHistoryState = {
  kind: typeof PHONE_SHELL_HISTORY_KIND;
  moduleId: ModuleId;
  viewId: string;
  /** Menú lateral (cajón) abierto. */
  drawer: boolean;
  /** Índice en la pila interna (0 = raíz). */
  idx: number;
};

export type PhoneShellNavEntry = {
  moduleId: ModuleId;
  viewId: string;
  drawer: boolean;
};

export function isPhoneShellHistoryState(value: unknown): value is PhoneShellHistoryState {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.kind === PHONE_SHELL_HISTORY_KIND &&
    typeof row.moduleId === "string" &&
    typeof row.viewId === "string" &&
    typeof row.drawer === "boolean" &&
    typeof row.idx === "number"
  );
}

export function phoneShellHistoryKey(entry: PhoneShellNavEntry): string {
  return `${entry.moduleId}|${entry.viewId}|${entry.drawer ? "1" : "0"}`;
}

function toState(entry: PhoneShellNavEntry, idx: number): PhoneShellHistoryState {
  return {
    kind: PHONE_SHELL_HISTORY_KIND,
    moduleId: entry.moduleId,
    viewId: entry.viewId,
    drawer: entry.drawer,
    idx,
  };
}

function pageUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Arranque: 2 entradas iguales para que el primer Atrás no salga del sitio. */
export function armPhoneShellHistory(entry: PhoneShellNavEntry): void {
  if (typeof window === "undefined") return;
  const url = pageUrl();
  window.history.replaceState(toState(entry, 0), "", url);
  window.history.pushState(toState(entry, 0), "", url);
}

export function pushPhoneShellHistory(entry: PhoneShellNavEntry, idx: number): void {
  if (typeof window === "undefined") return;
  window.history.pushState(toState(entry, idx), "", pageUrl());
}

export function replacePhoneShellHistory(entry: PhoneShellNavEntry, idx: number): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(toState(entry, idx), "", pageUrl());
}

/** Re-pone la entrada actual cuando el Atrás cayó fuera de nuestra pila. */
export function trapPhoneShellHistory(entry: PhoneShellNavEntry, idx: number): void {
  if (typeof window === "undefined") return;
  window.history.pushState(toState(entry, idx), "", pageUrl());
}

export function readPhoneShellHistoryState(): PhoneShellHistoryState | null {
  if (typeof window === "undefined") return null;
  return isPhoneShellHistoryState(window.history.state) ? window.history.state : null;
}
