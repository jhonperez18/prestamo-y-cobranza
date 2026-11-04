/**
 * Limpia el camino del aparato sin dañar datos operativos.
 * Suelta: service worker, Cache Storage, copias -bak rehacibles, warms de sesión.
 * Conserva: cobros, clientes, usuarios, préstamos, cierres, colas de subida.
 */
import { bustClientCaches } from "@/lib/bust-client-cache";
import {
  compactCatalogBackupsOnBoot,
  compactRebuildableStorage,
} from "@/lib/demo-persist";

const SESSION_PREFIXES = [
  "nexo-chain-m-opening:",
  "nexo-day-cash-figure:",
  "nexo-route-own-box:",
  "nexo-cloud-pool-visible-saldo",
  "nexo-auto-update-target",
  "nexo-browser-cache-cleared",
] as const;

const APPLIED_KEY = "nexo-client-clean-applied";

function clearSessionMoneyWarms() {
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
