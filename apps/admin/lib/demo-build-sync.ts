import { APP_BUILD } from "@/lib/app-build";
import {
  DEMO_VIRGIN_WIPE_GEN_KEY,
  VIRGIN_WIPE_GEN,
  isVirginWriteLocked,
} from "@/lib/virgin-lock";

const SERVED_BUILD_KEY = "nexo-demo-served-build";

/** Flags viejos de migraciones de cierre/reapertura que ya no deben bloquear el día. */
const LEGACY_DAY_FLAGS = [
  "nexo-demo-force-close-open-days-v1",
  "nexo-demo-reopen-premature-today-v2",
] as const;

/**
 * Cuando cambia el build desplegado:
 * - limpia flags de jornada
 * - si el candado virgen sigue activo, invalida el paquete local para reinstalar vacío
 *   (así un deploy nuevo sí actualiza el celular, no deja el localStorage viejo).
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
    if (isVirginWriteLocked()) {
      // Obliga a bootstrapProtectedDemoData a reinstalar el paquete vacío.
      for (let v = 2; v <= 40; v += 1) {
        window.localStorage.removeItem(`nexo-demo-bootstrap-package-v${v}`);
      }
      window.localStorage.removeItem("nexo-demo-bootstrap-recovery-v1");
      window.localStorage.setItem(DEMO_VIRGIN_WIPE_GEN_KEY, "0");
    }
    return { changed: true as const, build, previous: prev };
  } catch {
    return { changed: false as const, build };
  }
}

/** true si este origen aún no aplicó la generación de wipe actual. */
export function needsVirginWipeReinstall() {
  if (typeof window === "undefined") return false;
  try {
    const localGen = Number(window.localStorage.getItem(DEMO_VIRGIN_WIPE_GEN_KEY) || "0");
    return !Number.isFinite(localGen) || localGen < VIRGIN_WIPE_GEN;
  } catch {
    return true;
  }
}
