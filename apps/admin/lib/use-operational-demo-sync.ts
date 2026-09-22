"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hydrateOperationalDemo,
  OPERATIONAL_DEMO_STORAGE_PREFIX,
  type OperationalDemoSnapshot,
} from "@/lib/hydrate-operational-demo";
import { DEMO_CLIENTS_KEY, DEMO_BANK_ACCOUNTS_KEY, readDemoJson } from "@/lib/demo-persist";
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
import {
  flushBankAccountMirrorQueues,
  pullRemoteBankAccountsIntoDemo,
  reconcileLocalBankAccountsToRemote,
} from "@/lib/supabase/bank-accounts-mirror";
import type { BankAccount } from "@/lib/bank";

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
 * Sync C5+C6 — local primero (arranque rápido), luego flush/pull en fondo.
 * Rehidrata al terminar el pull (sin dejar UI vacía: el local ya pintó).
 */
export function useOperationalDemoSync(
  apply: (snapshot: OperationalDemoSnapshot) => void,
  options: Options = {},
) {
  const { resyncActive = false, onEvidenceSync } = options;
  const [hydrated, setHydrated] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
    setSyncing(true);
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
      await Promise.all([
        flushCatalogMirrorQueues(),
        flushOpsMirrorQueues(),
        flushUserMirrorQueues(),
        flushBankAccountMirrorQueues(),
      ]);
      await reconcileLocalOpsToRemote();
      await reconcileLocalBankAccountsToRemote();
      await Promise.all([
        pullRemotePaymentsIntoDemo(),
        pullRemoteCatalogIntoDemo(),
        pullRemoteOpsIntoDemo(),
        pullRemoteUsersIntoDemo(),
        pullRemoteBankAccountsIntoDemo(),
      ]);
      const localClients = readDemoJson(DEMO_CLIENTS_KEY, [] as unknown[]);
      if (!Array.isArray(localClients) || localClients.length === 0) {
        await pullRemoteCatalogIntoDemo();
      }
      const localBanks = readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []);
      if (!Array.isArray(localBanks) || localBanks.length === 0) {
        await pullRemoteBankAccountsIntoDemo();
      }
      commitHydrate();
    } finally {
      pullInFlightRef.current = false;
      setSyncing(false);
      setHydrated(true);
    }
  }, [commitHydrate]);

  useEffect(() => {
    // 1) Pintar local al instante (sistema madre: local primero).
    commitHydrate();
    // 2) Sync nube en segundo plano.
    void runHydrateWithRemotePull();
  }, [commitHydrate, runHydrateWithRemotePull]);

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
      commitHydrate();
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisiblePullAtRef.current < 15_000) return;
      lastVisiblePullAtRef.current = now;
      void (async () => {
        try {
          await flushPaymentMirrorQueue();
          await flushCatalogMirrorQueues();
          await flushOpsMirrorQueues();
          await flushUserMirrorQueues();
          await flushBankAccountMirrorQueues();
        } catch {
          /* offline */
        }
      })();
    }
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [commitHydrate]);

  return { hydrated, syncing, epoch, reload: runHydrateWithRemotePull };
}
