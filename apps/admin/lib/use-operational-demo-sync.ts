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
import { bindMoneyRealtime, type RealtimeMoneyTable } from "@/lib/realtime-money";
import {
  pullRemotePaymentsIntoDemo,
  pullRemoteEvidenceIntoIdb,
  reconcileLocalPaymentsToRemote,
  reconcilePaymentEvidenceToRemote,
} from "@/lib/supabase/payment-mirror";
import { pullRemoteCatalogIntoDemo } from "@/lib/supabase/catalog-mirror";
import { pullRemoteOpsIntoDemo, reconcileLocalOpsToRemote } from "@/lib/supabase/ops-mirror";
import { pullRemoteUsersIntoDemo } from "@/lib/supabase/user-mirror";
import {
  pullRemoteBankAccountsIntoDemo,
  reconcileLocalBankAccountsToRemote,
} from "@/lib/supabase/bank-accounts-mirror";
import {
  countPendingMirrorQueues,
  emitMirrorQueueChanged,
  flushAllMirrorQueues,
  MIRROR_QUEUE_CHANGED_EVENT,
  type MirrorPendingBreakdown,
} from "@/lib/supabase/mirror-queue";
import type { BankAccount } from "@/lib/bank";
import { reportDeviceStatus } from "@/lib/device-status";
import { pullRemoteMonthClosesIntoDemo } from "@/lib/supabase/month-close-mirror";
import { useAppAutoUpdate } from "@/lib/app-auto-update";
import {
  compactDeviceForDay,
  deviceTuneupDueDay,
  markDeviceTuneupDone,
} from "@/lib/device-daily-tuneup";
import {
  createSelfHealer,
  type SelfHealer,
  type SelfHealState,
} from "@/lib/system-self-heal";

type Options = {
  /**
   * Cuando pasa a true (ej. admin entra a Vista móvil), relee storage una vez.
   * Así cobros/cierres hechos con login de cobrador se ven igual en el preview.
   */
  resyncActive?: boolean;
  /** Aviso cuando este aparato sube constancias que solo tenía en local. */
  onEvidenceSync?: (result: { pushed: number; failed: number }) => void;
  /** Aviso cuando hay cola pendiente de subir a la nube. */
  onMirrorPending?: (pending: MirrorPendingBreakdown) => void;
};

/** Realtime es la vía viva; el poll solo respalda si el canal se cae. */
const CLOUD_POLL_MS = 45_000;
/** Flush de colas independiente del pull (cobros/CIE no se quedan atrapados). */
const MIRROR_FLUSH_MS = 8_000;
/** Tope del backoff exponencial del flush cuando la nube no responde (8 s → 16 s → … → 5 min). */
const MIRROR_FLUSH_MAX_BACKOFF_MS = 5 * 60_000;
/** Evita doble pull al volver foco + visibility a la vez. */
const VISIBLE_PULL_MIN_MS = 3_000;
/** Agrupa ráfagas de postgres_changes en un solo hydrate. */
const REALTIME_DEBOUNCE_MS = 280;
/** Topic público del timbre de cambios (`nexo_ops_ping` en la base). */
const OPS_PING_TOPIC = "nexo-ops";

/** Qué pull cubre cada tabla del canal. Usuarios, banco y reconcile quedan en el pull completo. */
type PullGroup = "payments" | "catalog" | "ops";
const CATALOG_LIVE_TABLES = ["clients", "loans", "routes", "collectors"] as const;
type LiveTable = (typeof CATALOG_LIVE_TABLES)[number] | RealtimeMoneyTable;
const TABLE_PULL_GROUP: Record<LiveTable, PullGroup> = {
  payments: "payments",
  clients: "catalog",
  loans: "catalog",
  routes: "ops",
  collectors: "ops",
  day_expenses: "ops",
  day_closes: "ops",
  daily_assignments: "ops",
};

/**
 * Sync C5+C6 — local primero (arranque rápido), luego flush/pull en fondo.
 * Rehidrata al terminar el pull (sin dejar UI vacía: el local ya pintó).
 *
 * Invariante: el flush de colas mirror NO depende del pull.
 * Si el pull falla o tarda, igual se sube lo pendiente a Supabase.
 */
export function useOperationalDemoSync(
  apply: (snapshot: OperationalDemoSnapshot) => void,
  options: Options = {},
) {
  const { resyncActive = false, onEvidenceSync, onMirrorPending } = options;
  const [hydrated, setHydrated] = useState(false);
  const [pendingMirror, setPendingMirror] = useState<MirrorPendingBreakdown>(() =>
    countPendingMirrorQueues(),
  );
  useAppAutoUpdate(hydrated);
  const evidenceOnceRef = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const onEvidenceSyncRef = useRef(onEvidenceSync);
  onEvidenceSyncRef.current = onEvidenceSync;
  const onMirrorPendingRef = useRef(onMirrorPending);
  onMirrorPendingRef.current = onMirrorPending;
  const resyncGateRef = useRef(false);
  const pullInFlightRef = useRef(false);
  const flushInFlightRef = useRef(false);
  const lastVisiblePullAtRef = useRef(0);
  /** Grupos avisados por Realtime que aún no bajaron (no se pierden si hay un pull en curso). */
  const pendingGroupsRef = useRef(new Set<PullGroup>());
  const drainTimerRef = useRef(0);
  const scheduleDrainRef = useRef<() => void>(() => {});
  const snapshotRef = useRef<OperationalDemoSnapshot | null>(null);
  const flushFailuresRef = useRef(0);
  const nextFlushAtRef = useRef(0);
  const healthRef = useRef<SelfHealState>({ issues: 0, summary: "", persistent: false });
  const healerRef = useRef<SelfHealer | null>(null);

  const commitHydrate = useCallback(() => {
    const snapshot = hydrateOperationalDemo();
    snapshotRef.current = snapshot;
    applyRef.current(snapshot);
    setHydrated(true);
  }, []);

  const refreshPending = useCallback(() => {
    const pending = emitMirrorQueueChanged();
    setPendingMirror(pending);
    onMirrorPendingRef.current?.(pending);
    return pending;
  }, []);

  const runMirrorFlush = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    let left = 0;
    try {
      left = (await flushAllMirrorQueues({ attempts: 3 })).left;
    } catch (error) {
      console.error("mirror-flush", error);
      left = countPendingMirrorQueues().total;
    } finally {
      flushInFlightRef.current = false;
      // Backoff exponencial: si la nube no recibe, el siguiente intento automático se aleja.
      if (left > 0) {
        flushFailuresRef.current += 1;
        const wait = Math.min(
          MIRROR_FLUSH_MS * 2 ** (flushFailuresRef.current - 1),
          MIRROR_FLUSH_MAX_BACKOFF_MS,
        );
        nextFlushAtRef.current = Date.now() + wait;
      } else {
        flushFailuresRef.current = 0;
        nextFlushAtRef.current = 0;
      }
      refreshPending();
    }
  }, [refreshPending]);

  const repairPlanilla = useCallback(async (): Promise<boolean> => {
    if (pullInFlightRef.current) return false;
    pullInFlightRef.current = true;
    try {
      await runMirrorFlush();
      await Promise.all([pullRemoteCatalogIntoDemo(), pullRemoteOpsIntoDemo({ full: true })]);
      // Rehidratar siempre: rearma la planilla con las reglas aunque la nube no haya cambiado.
      commitHydrate();
      return true;
    } catch (error) {
      console.error("self-heal-planilla", error);
      return false;
    } finally {
      pullInFlightRef.current = false;
    }
  }, [commitHydrate, runMirrorFlush]);

  useEffect(() => {
    healerRef.current = createSelfHealer({
      readSnapshot: () => snapshotRef.current,
      pendingTotal: () => countPendingMirrorQueues().total,
      repairPlanilla,
      repairQueue: async () => {
        nextFlushAtRef.current = 0;
        await runMirrorFlush();
      },
      onState: (state) => {
        healthRef.current = state;
        if (state.issues > 0) console.warn("self-heal", state);
      },
    });
    return () => {
      healerRef.current = null;
    };
  }, [repairPlanilla, runMirrorFlush]);

  /** Auto-evaluar (y reparar) tras cada sync; después reportar al monitor de aparatos. */
  const healthCycleThenReport = useCallback(
    async (pullOk: boolean, pullError: string) => {
      await healerRef.current?.runHealthCycle();
      const pending = refreshPending();
      void reportDeviceStatus({
        pullOk,
        pullError,
        pendingTotal: pending.total,
        health: healthRef.current,
      });
    },
    [refreshPending],
  );
  const runHydrateWithRemotePull = useCallback(async () => {
    if (pullInFlightRef.current) return;
    pullInFlightRef.current = true;
    // El pull completo cubre todo lo avisado hasta ahora.
    pendingGroupsRef.current.clear();
    let pullOk = false;
    let pullError = "";
    const tuneupDay = deviceTuneupDueDay();
    try {
      // Flush primero: lo pendiente en este PC sube aunque el pull tarde o falle.
      await runMirrorFlush();
      // Primera sincronización del día: cupo libre antes de la bajada completa.
      if (tuneupDay) compactDeviceForDay();

      const payments = await pullRemotePaymentsIntoDemo();
      const [catalog, ops, users, banks, months] = await Promise.all([
        pullRemoteCatalogIntoDemo(),
        pullRemoteOpsIntoDemo({ full: Boolean(tuneupDay) }),
        pullRemoteUsersIntoDemo(),
        pullRemoteBankAccountsIntoDemo(),
        pullRemoteMonthClosesIntoDemo(),
      ]);
      const failed = [
        { label: "cobros", ok: payments.ok, reason: payments.reason },
        { label: "catálogo", ok: catalog.ok, reason: catalog.reason },
        { label: "planilla", ok: ops.ok, reason: ops.reason },
        { label: "cierre de mes", ok: months.ok, reason: months.reason },
      ].filter((check) => !check.ok);
      pullOk = failed.length === 0;
      pullError = failed.map((check) => `${check.label}: ${check.reason || "falló"}`).join(" · ");
      let changed = Boolean(
        payments.changed ||
          catalog.changed ||
          ops.changed ||
          users.changed ||
          banks.changed ||
          months.changed,
      );
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
      // La puesta a punto del día rehidrata siempre (planilla del día con todo fresco).
      if (changed || tuneupDay) commitHydrate();
      if (tuneupDay && pullOk && ops.full) markDeviceTuneupDone(tuneupDay);
      try {
        await reconcileLocalPaymentsToRemote(payments.remoteRefs, payments.remoteVoidedRefs);
        if (!evidenceOnceRef.current) {
          evidenceOnceRef.current = true;
          // Primero bajar fotos a IndexedDB (sin meterlas en el poll de cobros).
          const parked = await pullRemoteEvidenceIntoIdb();
          if (parked.parked > 0) commitHydrate();
          const evidenceSync = await reconcilePaymentEvidenceToRemote();
          if (evidenceSync.pushed > 0 || evidenceSync.failed > 0) {
            onEvidenceSyncRef.current?.({
              pushed: evidenceSync.pushed,
              failed: evidenceSync.failed,
            });
          }
        }
        // Huérfanos solo contra la lista completa (una parcial haría ver todo como huérfano).
        // Reusa ese bundle: no bajar /api/ops/bundle otra vez (latencia PC).
        if (ops.full && ops.bundle) await reconcileLocalOpsToRemote(ops.bundle);
        await reconcileLocalBankAccountsToRemote();
        // Tras reconcile, vaciar cola otra vez (huérfanos recién encolados).
        await runMirrorFlush();
      } catch {
        /* la pantalla ya tiene el dato; la nube reintenta en el siguiente ciclo */
        await runMirrorFlush();
      }
    } catch (error) {
      console.error("ops-sync", error);
      pullOk = false;
      pullError = error instanceof Error ? error.message : "sync_failed";
      // Pull falló: igual intentar subir lo pendiente.
      await runMirrorFlush();
    } finally {
      pullInFlightRef.current = false;
      setHydrated(true);
      void healthCycleThenReport(pullOk, pullError);
      if (pendingGroupsRef.current.size > 0) scheduleDrainRef.current();
    }
  }, [commitHydrate, healthCycleThenReport, runMirrorFlush]);

  /** Eco Realtime: baja solo los grupos que cambiaron (un cobro no rebaja clientes ni usuarios). */
  const runTargetedPull = useCallback(async () => {
    if (pullInFlightRef.current) return;
    const groups = new Set(pendingGroupsRef.current);
    pendingGroupsRef.current.clear();
    if (groups.size === 0) return;
    pullInFlightRef.current = true;
    let rehydrated = false;
    try {
      await runMirrorFlush();
      // Cobros primero: la planilla (ops) se sella contra los PG- ya bajados.
      const payments = groups.has("payments") ? await pullRemotePaymentsIntoDemo() : null;
      const [catalog, ops] = await Promise.all([
        groups.has("catalog") ? pullRemoteCatalogIntoDemo() : null,
        groups.has("ops") ? pullRemoteOpsIntoDemo() : null,
      ]);
      if (payments?.changed || catalog?.changed || ops?.changed) {
        commitHydrate();
        rehydrated = true;
      }
    } catch (error) {
      // Sin reintento en bucle (sin red giraría cada 280 ms): lo recoge el poll de 45 s.
      console.error("ops-sync-realtime", error);
    } finally {
      pullInFlightRef.current = false;
      // Cambio recibido → caché rehecha → auto-evaluar (y reparar si algo no cuadra).
      if (rehydrated) void healerRef.current?.runHealthCycle();
      refreshPending();
      if (pendingGroupsRef.current.size > 0) scheduleDrainRef.current();
    }
  }, [commitHydrate, refreshPending, runMirrorFlush]);

  scheduleDrainRef.current = () => {
    window.clearTimeout(drainTimerRef.current);
    drainTimerRef.current = window.setTimeout(() => {
      void runTargetedPull();
    }, REALTIME_DEBOUNCE_MS);
  };

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
      refreshPending();
      // 2) Sync nube en segundo plano.
      void runHydrateWithRemotePull();
    })();
    return () => {
      cancel = true;
    };
  }, [commitHydrate, refreshPending, runHydrateWithRemotePull]);

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
      refreshPending();
    }
    function refreshFromCloud() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      // Cobrador ↔ supervisor: al volver a la app, bajar planilla/cierre sin esperar el poll.
      if (now - lastVisiblePullAtRef.current < VISIBLE_PULL_MIN_MS) {
        void runMirrorFlush();
        return;
      }
      lastVisiblePullAtRef.current = now;
      void runHydrateWithRemotePull();
    }
    function onOnline() {
      // Volvió la red: se acaba el backoff, sube ya y baja lo que pasó mientras tanto.
      flushFailuresRef.current = 0;
      nextFlushAtRef.current = 0;
      void runHydrateWithRemotePull();
    }
    function onQueueEvent(event: Event) {
      const detail = (event as CustomEvent<MirrorPendingBreakdown>).detail;
      if (detail && typeof detail.total === "number") {
        setPendingMirror(detail);
        onMirrorPendingRef.current?.(detail);
      } else {
        refreshPending();
      }
    }
    const poll = window.setInterval(refreshFromCloud, CLOUD_POLL_MS);
    const flushPoll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!navigator.onLine) return;
      if (Date.now() < nextFlushAtRef.current) return;
      if (countPendingMirrorQueues().total === 0) return;
      void runMirrorFlush();
    }, MIRROR_FLUSH_MS);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refreshFromCloud);
    window.addEventListener("focus", refreshFromCloud);
    window.addEventListener("online", onOnline);
    window.addEventListener(MIRROR_QUEUE_CHANGED_EVENT, onQueueEvent);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(flushPoll);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refreshFromCloud);
      window.removeEventListener("focus", refreshFromCloud);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(MIRROR_QUEUE_CHANGED_EVENT, onQueueEvent);
    };
  }, [commitHydrate, refreshPending, runHydrateWithRemotePull, runMirrorFlush]);

  useEffect(() => {
    if (!hydrated || !getSupabasePublicEnv().configured) return;
    let client: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      client = createSupabaseBrowserClient();
    } catch {
      return;
    }
    const schedule = (table: LiveTable) => {
      pendingGroupsRef.current.add(TABLE_PULL_GROUP[table]);
      scheduleDrainRef.current();
    };
    const channel = client.channel("nexo-catalog-live");
    for (const table of CATALOG_LIVE_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () =>
        schedule(table),
      );
    }
    // payments, day_expenses, day_closes, daily_assignments: INSERT/UPDATE/DELETE.
    // Este canal no se filtra por rol: admin y supervisor no pierden el global.
    bindMoneyRealtime(channel, schedule);
    // Canal caído → al volver a SUBSCRIBED se baja lo que pasó mientras no llegaban avisos.
    let disposed = false;
    const watchChannel = () => {
      let down = false;
      return (status: string) => {
        if (disposed) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (!down) void runHydrateWithRemotePull();
          down = true;
          return;
        }
        if (status === "SUBSCRIBED" && down) {
          down = false;
          void runHydrateWithRemotePull();
        }
      };
    };
    channel.subscribe(watchChannel());
    // Timbre de la base (trigger → realtime.send, sin datos): llega también al cobrador,
    // que entra sin sesión de Supabase y por RLS no recibe postgres_changes.
    const ping = client.channel(OPS_PING_TOPIC);
    ping.on("broadcast", { event: "changed" }, (message) => {
      const table = String((message.payload as { table?: string } | undefined)?.table || "");
      if (table in TABLE_PULL_GROUP) schedule(table as LiveTable);
      else void runHydrateWithRemotePull();
    });
    ping.subscribe(watchChannel());
    return () => {
      disposed = true;
      window.clearTimeout(drainTimerRef.current);
      void client.removeChannel(channel);
      void client.removeChannel(ping);
    };
  }, [hydrated, runHydrateWithRemotePull]);

  return {
    hydrated,
    reload: runHydrateWithRemotePull,
    flushPending: runMirrorFlush,
    pendingMirror,
  };
}
