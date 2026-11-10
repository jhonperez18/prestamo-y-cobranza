/**
 * Limpia el camino del aparato sin dañar datos operativos.
 * Suelta: service worker, Cache Storage, copias -bak, warms de sesión,
 * cortes de pull viejos, y (cobrador/supervisor) días fuera de la ventana viva.
 * Conserva: cobros/clientes/préstamos vivos, cierres CIE, colas de subida.
 */
import { bustClientCaches } from "@/lib/bust-client-cache";
import { clearCloudRouteDayDetail } from "@/lib/cloud-route-day-detail";
import { releaseClosedDaysOnDevice } from "@/lib/collector-device-release";
import {
  isCollectorLiveDevice,
  isSupervisorLiveDevice,
} from "@/lib/collector-live-window";
import {
  compactCatalogBackupsOnBoot,
  compactRebuildableStorage,
} from "@/lib/demo-persist";
import { clearAllPullCursors } from "@/lib/incremental-pull";
import { trimSupervisorLiveLocalCache } from "@/lib/supervisor-book";

const SESSION_PREFIXES = [
  "nexo-chain-m-opening:",
  "nexo-day-cash-figure:",
  "nexo-route-own-box:",
  "nexo-cloud-pool-visible-saldo",
  "nexo-auto-update-target",
  "nexo-browser-cache-cleared",
  "nexo-last-served-build",
] as const;

const APPLIED_KEY = "nexo-client-clean-applied";

export function clearSessionMoneyWarms() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i) || "";
      if (!key) continue;
      if (SESSION_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) {
        drop.push(key);
      }
    }
    for (const key of drop) sessionStorage.removeItem(key);
  } catch {
    /* cupo / modo privado */
  }
}

/**
 * Cobrador / supervisor: soltar lo que ya no es la ventana viva.
 * No toca colas ni CIE. Cero plata inventada.
 */
export function releaseStaleLiveDeviceRows(): void {
  if (typeof window === "undefined") return;
  try {
    if (isCollectorLiveDevice()) {
      releaseClosedDaysOnDevice();
    }
  } catch (error) {
    console.error("path-clean-collector-release", error);
  }
  try {
    if (isSupervisorLiveDevice()) {
      trimSupervisorLiveLocalCache();
    }
  } catch (error) {
    console.error("path-clean-supervisor-trim", error);
  }
}

/** Limpieza segura del camino (sin borrar plata ni colas). */
export async function cleanDevicePath(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    compactRebuildableStorage();
  } catch (error) {
    console.error("path-clean-rebuildable", error);
  }
  try {
    compactCatalogBackupsOnBoot();
  } catch (error) {
    console.error("path-clean-catalog-bak", error);
  }
  clearSessionMoneyWarms();
  try {
    clearAllPullCursors();
  } catch (error) {
    console.error("path-clean-cursors", error);
  }
  try {
    clearCloudRouteDayDetail();
  } catch (error) {
    console.error("path-clean-route-day", error);
  }
  releaseStaleLiveDeviceRows();
  try {
    await bustClientCaches();
  } catch (error) {
    console.error("path-clean-bust", error);
  }
}

export function readAppliedCleanEpoch(): string {
  try {
    return window.localStorage.getItem(APPLIED_KEY) || "";
  } catch {
    return "";
  }
}

export function markCleanEpochApplied(epoch: string) {
  try {
    window.localStorage.setItem(APPLIED_KEY, epoch);
  } catch (error) {
    console.error("path-clean-mark", error);
  }
}

/**
 * Si el servidor pide una limpieza más nueva que la aplicada → limpia y recarga una vez.
 * Devuelve true si va a recargar (el caller no debe seguir).
 */
export async function applyServerCleanEpochIfNeeded(cleanEpoch: string): Promise<boolean> {
  const epoch = String(cleanEpoch || "").trim();
  if (!epoch || !Number.isFinite(Date.parse(epoch))) return false;
  if (readAppliedCleanEpoch() === epoch) return false;
  await cleanDevicePath();
  markCleanEpochApplied(epoch);
  window.location.reload();
  return true;
}
