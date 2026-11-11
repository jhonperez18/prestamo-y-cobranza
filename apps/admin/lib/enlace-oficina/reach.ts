/**
 * Memoria del último alcance real al servidor (autoprestamos.org).
 * Fuente: reportes del sync + probe liviano a /api/ops/build-health.
 */
import {
  countPendingMirrorQueues,
  MIRROR_QUEUE_CHANGED_EVENT,
} from "@/lib/supabase/mirror-queue";
import { enlaceEstadoLabel, resolveEnlaceEstado } from "./detect";
import type { EnlaceOficinaSnapshot } from "./types";

export const ENLACE_OFICINA_CHANGED_EVENT = "nexo-enlace-oficina-changed";

const STORAGE_KEY = "nexo-enlace-oficina-reach";
const PROBE_PATH = "/api/ops/build-health";
const PROBE_TIMEOUT_MS = 8_000;
const PROBE_INTERVAL_MS = 45_000;

type ReachMemory = {
  lastReachOk: boolean | null;
  lastReachAt: number | null;
};

let memory: ReachMemory = { lastReachOk: null, lastReachAt: null };
let probeInFlight = false;
let probeTimer: number | null = null;
let listenersBound = false;

function readStoredReach(): ReachMemory {
  if (typeof window === "undefined") return { lastReachOk: null, lastReachAt: null };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { lastReachOk: null, lastReachAt: null };
    const parsed = JSON.parse(raw) as { ok?: boolean; at?: number };
    if (typeof parsed.ok !== "boolean") return { lastReachOk: null, lastReachAt: null };
    const at = typeof parsed.at === "number" && Number.isFinite(parsed.at) ? parsed.at : null;
    return { lastReachOk: parsed.ok, lastReachAt: at };
  } catch {
    return { lastReachOk: null, lastReachAt: null };
  }
}

function writeStoredReach(ok: boolean, at: number) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ok, at }));
  } catch {
    /* cupo / privado: memoria en RAM basta */
  }
}

function ensureMemory() {
  if (memory.lastReachOk != null) return;
  memory = readStoredReach();
}

function emitChanged(snapshot: EnlaceOficinaSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(ENLACE_OFICINA_CHANGED_EVENT, { detail: snapshot }),
    );
  } catch {
    /* ignore */
  }
}

function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/** Foto actual del enlace (puro + memoria). */
export function readEnlaceOficinaSnapshot(): EnlaceOficinaSnapshot {
  ensureMemory();
  const online = isBrowserOnline();
  const pending = typeof window === "undefined" ? 0 : countPendingMirrorQueues().total;
  const lastReachOk = online ? memory.lastReachOk : false;
  const estado = resolveEnlaceEstado({
    online,
    pending,
    lastReachOk: online ? memory.lastReachOk : false,
  });
  return {
    estado,
    label: enlaceEstadoLabel(estado, pending),
    pending,
    lastReachAt: memory.lastReachAt,
    lastReachOk,
    online,
  };
}

/**
 * El sync operativo reporta si el servidor contestó.
 * true = pull/flush llegó; false = falló de red / 5xx / timeout.
 */
export function reportEnlaceReach(ok: boolean): void {
  if (typeof window === "undefined") return;
  const at = Date.now();
  memory = { lastReachOk: Boolean(ok), lastReachAt: at };
  writeStoredReach(Boolean(ok), at);
  emitChanged(readEnlaceOficinaSnapshot());
}

/** Probe liviano: ¿responde la puerta del negocio? */
export async function probeEnlaceOficina(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!isBrowserOnline()) {
    reportEnlaceReach(false);
    return false;
  }
  if (probeInFlight) return memory.lastReachOk === true;
  probeInFlight = true;
  try {
    const res = await fetch(PROBE_PATH, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let bodyOk = false;
    try {
      const body = (await res.json()) as { ok?: boolean };
      bodyOk = body?.ok === true;
    } catch {
      bodyOk = false;
    }
    const ok = res.ok && bodyOk;
    reportEnlaceReach(ok);
    return ok;
  } catch {
    reportEnlaceReach(false);
    return false;
  } finally {
    probeInFlight = false;
  }
}

function onOnline() {
  void probeEnlaceOficina();
}

function onOffline() {
  reportEnlaceReach(false);
}

function onQueueChanged() {
  emitChanged(readEnlaceOficinaSnapshot());
}

function onVisibility() {
  if (typeof document === "undefined") return;
  if (document.visibilityState !== "visible") return;
  void probeEnlaceOficina();
}

/**
 * Arranca listeners + probe periódico. Idempotente.
 * No bloquea cobros; solo actualiza el estado del enlace.
 */
export function startEnlaceOficinaWatch(): () => void {
  if (typeof window === "undefined") return () => {};
  ensureMemory();
  if (!listenersBound) {
    listenersBound = true;
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(MIRROR_QUEUE_CHANGED_EVENT, onQueueChanged);
    document.addEventListener("visibilitychange", onVisibility);
  }
  void probeEnlaceOficina();
  if (probeTimer == null) {
    probeTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void probeEnlaceOficina();
    }, PROBE_INTERVAL_MS);
  }
  emitChanged(readEnlaceOficinaSnapshot());
  return () => {
    /* El watch es de proceso: no se apaga al desmontar una pantalla.
       Varios hooks pueden llamar start; el último cleanup no corta el probe. */
  };
}
