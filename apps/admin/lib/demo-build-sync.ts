import { APP_BUILD } from "@/lib/app-build";

const SERVED_BUILD_KEY = "nexo-demo-served-build";

/** Flags viejos de migraciones de cierre/reapertura que ya no deben bloquear el día. */
const LEGACY_DAY_FLAGS = [
  "nexo-demo-force-close-open-days-v1",
  "nexo-demo-reopen-premature-today-v2",
] as const;

/**
 * Cuando cambia el build desplegado, limpia flags de jornada en localStorage
 * para que el navegador no se quede en el “día cerrado” de un deploy anterior.
 */
export function syncDemoStorageToServedBuild(build = APP_BUILD) {
  if (typeof window === "undefined") return { changed: false as const };
  try {
    const prev = window.localStorage.getItem(SERVED_BUILD_KEY);
    if (prev === build) return { changed: false as const, build };
    window.localStorage.setItem(SERVED_BUILD_KEY, build);
    for (const key of LEGACY_DAY_FLAGS) {
      window.localStorage.removeItem(key);
    }
    return { changed: true as const, build, previous: prev };
  } catch {
    return { changed: false as const, build };
  }
}
