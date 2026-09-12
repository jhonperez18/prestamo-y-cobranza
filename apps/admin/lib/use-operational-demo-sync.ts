"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hydrateOperationalDemo,
  OPERATIONAL_DEMO_STORAGE_PREFIX,
  type OperationalDemoSnapshot,
} from "@/lib/hydrate-operational-demo";
import {
  flushPaymentMirrorQueue,
  pullRemotePaymentsIntoDemo,
} from "@/lib/supabase/payment-mirror";

type Options = {
  /**
   * Cuando pasa a true (ej. admin entra a Vista móvil), relee storage una vez.
   * Así cobros/cierres hechos con login de cobrador se ven igual en el preview.
   */
  resyncActive?: boolean;
};

/**
 * Contrato de sincronización operativa (C4 pagos):
 * 1) Flush cola offline → pull Postgres (raíz) → hidratar proyecciones
 * 2) Re-hidrata si otra pestaña escribe nexo-demo-*
 * 3) Re-hidrata al activar `resyncActive` (entrada a Vista móvil)
 * 4) Al volver visible: flush + pull + hidratar
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
    if (pullInFlightRef.current) {
      runHydrate();
      return;
    }
    pullInFlightRef.current = true;
    try {
      // Caché local primero (UI rápida), luego raíz remota.
      runHydrate();
      await flushPaymentMirrorQueue();
      const pull = await pullRemotePaymentsIntoDemo();
      if (pull.ok && pull.changed) {
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
