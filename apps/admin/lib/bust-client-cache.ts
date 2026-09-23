const LAST_BUILD_KEY = "nexo-last-served-build";
const RELOAD_GUARD = "nexo-browser-cache-cleared";

/**
 * Limpia service worker y Cache Storage.
 * No toca localStorage: ahí están cobros, clientes y usuarios.
 * Devuelve true si había algo que soltar.
 */
export async function bustClientCaches() {
  if (typeof window === "undefined") return false;
  let removed = false;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length > 0) removed = true;
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    /* ignore */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      if (keys.length > 0) removed = true;
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
  return removed;
}

/**
 * En cada arranque suelta service worker y Cache Storage.
 * Si había algo guardado, recarga una sola vez en la sesión.
 * Si el build servido cambió, recarga de nuevo.
 */
export async function refreshServedBuildOrReload(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const removed = await bustClientCaches();
  const alreadyReloaded = window.sessionStorage.getItem(RELOAD_GUARD) === "1";
  if (removed && !alreadyReloaded) {
    window.sessionStorage.setItem(RELOAD_GUARD, "1");
    window.location.reload();
    return null;
  }
  try {
    const res = await fetch("/api/ops/build-health", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { build?: string };
    const build = String(data.build || "").trim();
    if (!build) return null;

    const prev = window.sessionStorage.getItem(LAST_BUILD_KEY);
    if (prev === build) return build;

    window.sessionStorage.setItem(LAST_BUILD_KEY, build);
    if (!prev) return build;

    await bustClientCaches();
    window.location.reload();
    return build;
  } catch {
    return null;
  }
}
