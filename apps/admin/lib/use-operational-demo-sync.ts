"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hydrateOperationalDemo,
  OPERATIONAL_DEMO_STORAGE_PREFIX,
  type OperationalDemoSnapshot,
} from "@/lib/hydrate-operational-demo";
import { DEMO_CLIENTS_KEY, readDemoJson } from "@/lib/demo-persist";
import {
  flushPaymentMirrorQueue,
  pullRemotePaymentsIntoDemo,
  reconcileLocalPaymentsToRemote,
  reconcilePaymentEvidenceToRemote,
} from "@/lib/supabase/payment-mirror";
import {
  flushCatalogMirrorQueues,
  pullRemoteCatalogIntoDemo,
} from "@/lib/supabase/catalog-mirror";
import {
  flushOpsMirrorQueues,
  pullRemoteOpsIntoDemo,
  reconcileLocalOpsToRemote,
} from "@/lib/supabase/ops-mirror";

type Options = {
  /**
   * Cuando pasa a true (ej. admin entra a Vista móvil), relee storage una vez.
   * Así cobros/cierres hechos con login de cobrador se ven igual en el preview.
   */
  resyncActive?: boolean;
  /** Aviso cuando este aparato sube constancias que solo tenía en local. */
  onEvidenceSync?: (result: { pushed: number; failed: number }) => void;
};

/**
 * Sync completo C5+C6:
 * flush colas → subir PG- locales huérfanos → pull → hidratar
 */
export function useOperationalDemoSync(
  apply: (snapshot: OperationalDemoSnapshot) => void,
  options: Options = {},
) {
  const { resyncActive = false, onEvidenceSync } = options;
  const [hydrated, setHydrated] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const onEvidenceSyncRef = useRef(onEvidenceSync);
  onEvidenceSyncRef.current = onEvidenceSync;
  const resyncGateRef = useRef(false);
  const pullInFlightRef = useRef(false);

  const runHydrate = useCallback((markReady = true) => {
    const snapshot = hydrateOperationalDemo();
    applyRef.current(snapshot);
    if (markReady) setHydrated(true);
    setEpoch((n) => n + 1);
  }, []);

  const runHydrateWithRemotePull = useCallback(async () => {
    if (pullInFlightRef.current) {
      runHydrate(true);
      return;
    }
    pullInFlightRef.current = true;
    try {
      // Hidrata local primero (puede estar vacío); no marca listo hasta el pull.
      runHydrate(false);
      await flushPaymentMirrorQueue();
      await reconcileLocalPaymentsToRemote();
      const evidenceSync = await reconcilePaymentEvidenceToRemote();
      if (evidenceSync.pushed > 0 || evidenceSync.failed > 0) {
        onEvidenceSyncRef.current?.({
          pushed: evidenceSync.pushed,
          failed: evidenceSync.failed,
        });
      }
      await flushCatalogMirrorQueues();
      await flushOpsMirrorQueues();
      await reconcileLocalOpsToRemote();
      const [paymentsPull, catalogPull, opsPull] = await Promise.all([
        pullRemotePaymentsIntoDemo(),
        pullRemoteCatalogIntoDemo(),
        pullRemoteOpsIntoDemo(),
      ]);
      const localClients = readDemoJson(DEMO_CLIENTS_KEY, [] as unknown[]);
      const catalogEmpty = !Array.isArray(localClients) || localClients.length === 0;
      // Si el catálogo local sigue vacío, reintenta pull de clientes.
      if (catalogEmpty) {
        await pullRemoteCatalogIntoDemo();
      }
      const after = readDemoJson(DEMO_CLIENTS_KEY, [] as unknown[]);
      const filled = Array.isArray(after) && after.length > 0;
      if (
        (paymentsPull.ok && paymentsPull.changed) ||
        (catalogPull.ok && catalogPull.changed) ||
        (opsPull.ok && opsPull.changed) ||
        evidenceSync.pushed > 0 ||
        catalogEmpty ||
        filled
      ) {
        runHydrate(true);
      } else {
        setHydrated(true);
      }
    } finally {
      pullInFlightRef.current = false;
      setHydrated(true);
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
      runHydrate(true);
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
