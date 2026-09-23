"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  hydrateOperationalDemo,
  OPERATIONAL_DEMO_STORAGE_PREFIX,
  type OperationalDemoSnapshot,
} from "@/lib/hydrate-operational-demo";
import { DEMO_CLIENTS_KEY, DEMO_BANK_ACCOUNTS_KEY, readDemoJson } from "@/lib/demo-persist";
import { loadPaymentEvidenceStore } from "@/lib/payment-evidence-store";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { bindMoneyRealtime } from "@/lib/realtime-money";
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
  const evidenceOnceRef = useRef(false);
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
  }, []);

  const runHydrateWithRemotePull = useCallback(async () => {
    if (pullInFlightRef.current) return;
    pullInFlightRef.current = true;
    try {
      // Primero bajar cobros y planilla, y pintar. Si el flush va antes y falla,
      // el panel se queda con los gastos y nunca muestra el cobro del cobrador.
      const payments = await pullRemotePaymentsIntoDemo();
      const [catalog, ops, users, banks] = await Promise.all([
        pullRemoteCatalogIntoDemo(),
        pullRemoteOpsIntoDemo(),
        pullRemoteUsersIntoDemo(),
        pullRemoteBankAccountsIntoDemo(),
      ]);
      let changed = Boolean(payments.changed || catalog.changed || ops.changed || users.changed || banks.changed);
      const localClients = readDemoJson(DEMO_CLIENTS_KEY, [] as unknown[]);
      if (!Array.isArray(localClients) || localClients.length === 0) {
        const again = await pullRemoteCatalogIntoDemo();
        changed = changed || again.changed;
      }
      const localBanks = readDemoJson<BankAccount[]>(DEMO_BANK_ACCOUNTS_KEY, []);
      if (!Array.isArray(localBanks) || localBanks.length === 0) {
        const again = await pullRemoteBankAccountsIntoDemo();
        changed = changed || again.changed;
      }
      // Sin cambios no se rehace toda la pantalla. Eso era la lentitud en reposo.
      if (changed) commitHydrate();
      try {
        await flushPaymentMirrorQueue();
        await reconcileLocalPaymentsToRemote(payments.remoteRefs);
        if (!evidenceOnceRef.current) {
          evidenceOnceRef.current = true;
          const evidenceSync = await reconcilePaymentEvidenceToRemote();
          if (evidenceSync.pushed > 0 || evidenceSync.failed > 0) {
            onEvidenceSyncRef.current?.({
              pushed: evidenceSync.pushed,
              failed: evidenceSync.failed,
            });
          }
        }
        await Promise.all([
          flushCatalogMirrorQueues(),
          flushOpsMirrorQueues(),
          flushUserMirrorQueues(),
          flushBankAccountMirrorQueues(),
        ]);
        await reconcileLocalOpsToRemote();
        await reconcileLocalBankAccountsToRemote();
      } catch {
        /* la pantalla ya tiene el dato; la nube reintenta en el siguiente ciclo */
      }
    } catch (error) {
      console.error("ops-sync", error);
    } finally {
      pullInFlightRef.current = false;
      setHydrated(true);
    }
  }, [commitHydrate]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        await loadPaymentEvidenceStore();
      } catch (error) {
        console.error("evidence-store", error);
      }
      if (cancel) return;
      // 1) Pintar local al instante (sistema madre: local primero).
      commitHydrate();
      // 2) Sync nube en segundo plano.
      void runHydrateWithRemotePull();
    })();
    return () => {
      cancel = true;
    };
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
    function refreshFromCloud() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisiblePullAtRef.current < 15_000) return;
      lastVisiblePullAtRef.current = now;
      void runHydrateWithRemotePull();
    }
    const poll = window.setInterval(refreshFromCloud, 15_000);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refreshFromCloud);
    window.addEventListener("focus", refreshFromCloud);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refreshFromCloud);
      window.removeEventListener("focus", refreshFromCloud);
    };
  }, [commitHydrate, runHydrateWithRemotePull]);

  useEffect(() => {
    if (!hydrated || !getSupabasePublicEnv().configured) return;
    let client: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      client = createSupabaseBrowserClient();
    } catch {
      return;
    }
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void runHydrateWithRemotePull();
      }, 500);
    };
    const tables = ["clients", "loans", "routes", "collectors"] as const;
    const channel = client.channel("nexo-catalog-live");
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }
    // payments, day_expenses y day_closes: INSERT, UPDATE y DELETE explícitos.
    // Este canal no se filtra por rol: admin y supervisor no pierden el global.
    bindMoneyRealtime(channel, schedule);
    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        void runHydrateWithRemotePull();
      }
    });
    return () => {
      window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [hydrated, runHydrateWithRemotePull]);

  return { hydrated, reload: runHydrateWithRemotePull };
}
