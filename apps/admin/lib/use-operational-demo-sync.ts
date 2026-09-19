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
import {
  flushUserMirrorQueues,
  pullRemoteUsersIntoDemo,
} from "@/lib/supabase/user-mirror";

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
 * flush colas → subir PG- locales huérfanos → pull → hidratar UNA vez (sin parpadeo).
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
  const lastVisiblePullAtRef = useRef(0);

  const commitHydrate = useCallback(() => {
    const snapshot = hydrateOperationalDemo();
    applyRef.current(snapshot);
    setHydrated(true);
    setEpoch((n) => n + 1);
  }, []);

  const runHydrateWithRemotePull = useCallback(async () => {
    if (pullInFlightRef.current) return;
    pullInFlightRef.current = true;
    try {
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
      await flushUserMirrorQueues();
      await reconcileLocalOpsToRemote();
      await Promise.all([
        pullRemotePaymentsIntoDemo(),
        pullRemoteCatalogIntoDemo(),
        pullRemoteOpsIntoDemo(),
        pullRemoteUsersIntoDemo(),
      ]);
      const localClients = readDemoJson(DEMO_CLIENTS_KEY, [] as unknown[]);
      if (!Array.isArray(localClients) || localClients.length === 0) {
        await pullRemoteCatalogIntoDemo();
      }
      // Una sola pintura a la UI: evita saltos 0 → 81 → 0.
      commitHydrate();
    } finally {
      pullInFlightRef.current = false;
      setHydrated(true);
    }
  }, [commitHydrate]);

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
      // Solo otra pestaña: no re-pull completo (evita espabilar).
      commitHydrate();
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      // Máximo un pull por visibilidad cada 15s.
      if (now - lastVisiblePullAtRef.current < 15_000) return;
      lastVisiblePullAtRef.current = now;
      void runHydrateWithRemotePull();
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [commitHydrate, runHydrateWithRemotePull]);

  return { hydrated, epoch, reload: runHydrateWithRemotePull };
}
