const LAST_BUILD_KEY = "nexo-last-served-build";

/**
 * Limpia SW + Cache Storage del navegador.
 * Solo cuando el build servido cambió (no en cada foco / pestaña).
 */
export async function bustClientCaches() {
  if (typeof window === "undefined") return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    /* ignore */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Lee el build servido desde la API dueña.
 * - Misma SHA → no toca caché ni recarga.
 * - SHA nueva vs sello de sesión → limpia caché una vez y recarga.
 */
export async function refreshServedBuildOrReload(): Promise<string | null> {
  if (typeof window === "undefined") return null;
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
