"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hydrateOperationalDemo,
  OPERATIONAL_DEMO_STORAGE_PREFIX,
  type OperationalDemoSnapshot,
} from "@/lib/hydrate-operational-demo";
import { pullRemotePaymentsIntoDemo } from "@/lib/supabase/payment-mirror";

type Options = {
  /**
   * Cuando pasa a true (ej. admin entra a Vista móvil), relee storage una vez.
   * Así cobros/cierres hechos con login de cobrador se ven igual en el preview.
   */
  resyncActive?: boolean;
};

/**
 * Contrato de sincronización operativa:
 * 1) Hidrata al montar
 * 2) Re-hidrata si otra pestaña escribe nexo-demo-*
 * 3) Re-hidrata al activar `resyncActive` (entrada a Vista móvil)
 * 4) Re-hidrata al volver a la pestaña si `resyncActive` sigue activo
 * 5) C3: tras hidratar / al volver visible, pull de payments desde Supabase
 *    y re-hidrata solo si entraron refs nuevos
 */
export function useOperationalDemoSync(
  apply: (snapshot: OperationalDemoSnapshot) => void,
  options: Options = {},
) {
  const { resyncActive = false } = options;
  const [hydrated, setHydrated] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const resyncGateRef = useRef(false);
  const pullInFlightRef = useRef(false);

  const runHydrate = useCallback(() => {
    const snapshot = hydrateOperationalDemo();
    applyRef.current(snapshot);
    setHydrated(true);
    setEpoch((n) => n + 1);
  }, []);

  const runHydrateWithRemotePull = useCallback(async () => {
    runHydrate();
    if (pullInFlightRef.current) return;
    pullInFlightRef.current = true;
    try {
      const pull = await pullRemotePaymentsIntoDemo();
      if (pull.ok && pull.added > 0) {
        runHydrate();
      }
    } finally {
      pullInFlightRef.current = false;
    }
  }, [runHydrate]);

  useEffect(() => {
    void runHydrateWithRemotePull();
  }, [runHydrateWithRemotePull]);

  useEffect(() => {
    if (!hydrated) return;
    if (!resyncActive) {
      resyncGateRef.current = false;
      return;
    }
    if (resyncGateRef.current) return;
    resyncGateRef.current = true;
    void runHydrateWithRemotePull();
  }, [hydrated, resyncActive, runHydrateWithRemotePull]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (!event.key || !event.key.startsWith(OPERATIONAL_DEMO_STORAGE_PREFIX)) return;
      runHydrate();
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      // C3: siempre intentar pull al volver (celular ↔ PC).
      void runHydrateWithRemotePull();
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [runHydrate, runHydrateWithRemotePull]);

  return { hydrated, epoch, reload: runHydrateWithRemotePull };
}
