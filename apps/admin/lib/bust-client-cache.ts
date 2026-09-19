const LAST_BUILD_KEY = "nexo-last-served-build";

/**
 * Limpia SW + Cache Storage del navegador.
 * El panel madre / login deben verse siempre con el código fresco.
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
 * Lee el build servido, sincroniza sello local y, si cambió el commit,
 * recarga una vez sin caché de documento.
 */
export async function refreshServedBuildOrReload(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  await bustClientCaches();
  try {
    const res = await fetch("/api/ops/build-health", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { build?: string };
    const build = String(data.build || "").trim();
    if (!build) return null;
    const prev = window.sessionStorage.getItem(LAST_BUILD_KEY);
    window.sessionStorage.setItem(LAST_BUILD_KEY, build);
    if (prev && prev !== build) {
      // Hard reload: descarta shell/JS viejo del documento.
      window.location.reload();
      return build;
    }
    return build;
  } catch {
    return null;
  }
}
