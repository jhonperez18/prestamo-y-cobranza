"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CollectorShell } from "@/components/CollectorShell";
import { LoginScreen } from "@/components/LoginScreen";
import { SupervisorShell } from "@/components/SupervisorShell";
import {
  clearSession,
  markSessionActive,
  resumeSession,
  sessionIdleExpired,
  sessionStillValid,
  stampSession,
  writeSession,
  type AppSession,
} from "@/lib/auth";
import { businessTodayIso } from "@/lib/business-timezone";
import { bootstrapProtectedDemoData } from "@/lib/bootstrap-demo-data";
import { parkLocalBlobs } from "@/lib/evidence-idb";
import { hydrateBigDemoStore } from "@/lib/big-demo-store";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
import { refreshServedBuildOrReload } from "@/lib/bust-client-cache";
import {
  DEMO_USERS_KEY,
  loadDemoUsers,
  writeDemoJson,
} from "@/lib/demo-persist";
import { COLLECTOR_ROLE_REF, SUPERVISOR_ROLE_REF } from "@/lib/mock-data";
import {
  sessionAllowedOnChannel,
  type PwaChannelId,
} from "@/lib/pwa-channels";
import { canAccessAdminPanel } from "@/lib/session-access";
import { signOutSupabaseAuth } from "@/lib/supabase/auth-login";
import {
  flushUserMirrorQueues,
  pullRemoteUsersIntoDemo,
} from "@/lib/supabase/user-mirror";

/**
 * Acceso:
 * - / → sistema (admin + demos)
 * - /supervisor → solo app supervisor
 * - /cobrador → solo app cobrador
 */
function isCollectorSession(session: AppSession) {
  return session.roleRef === COLLECTOR_ROLE_REF || Boolean(session.collectorRef);
}

function isSupervisorSession(session: AppSession) {
  return session.roleRef === SUPERVISOR_ROLE_REF;
}

type Props = {
  channel?: PwaChannelId;
};

type SessionShell = "supervisor" | "cobrador" | "sistema";

function shellFor(session: AppSession, channel: PwaChannelId): SessionShell {
  if (channel === "supervisor") return "supervisor";
  if (channel === "cobrador") return "cobrador";
  if (isCollectorSession(session) && !canAccessAdminPanel(session)) return "cobrador";
  if (isSupervisorSession(session)) return "supervisor";
  if (!canAccessAdminPanel(session)) return "cobrador";
  return "sistema";
}

/** Apps del celular (cobrador / supervisor): 20 min sin uso → usuario y contraseña. */
function idleLimited(session: AppSession, channel: PwaChannelId): boolean {
  return shellFor(session, channel) !== "sistema";
}

/** Sesión viva: si el Listado la invalidó (clave, rol, baja), ya es otro día o venció la inactividad → login. */
function keepIfValid(session: AppSession | null, channel: PwaChannelId): AppSession | null {
  if (!session) return null;
  const idle = idleLimited(session, channel) && sessionIdleExpired();
  if (!idle && sessionStillValid(session, loadDemoUsers(), businessTodayIso())) return session;
  clearSession();
  return null;
}

const ACTIVITY_MARK_EVERY_MS = 15_000;
const IDLE_CHECK_EVERY_MS = 60_000;

export function AuthGate({ channel = "sistema" }: Props) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let mq: MediaQueryList | null = null;
    const syncPhone = () => {
      if (mq) setIsPhone(mq.matches);
    };

    async function boot() {
      try {
        await parkLocalBlobs();
        await hydrateBigDemoStore();
        const liveBuild = await refreshServedBuildOrReload();
        syncDemoStorageToServedBuild(liveBuild || undefined);
        bootstrapProtectedDemoData();
      } catch {
        /* ignore */
      }

      if (cancelled) return;

      // Local primero: login listo sin esperar la nube.
      const users = loadDemoUsers();
      writeDemoJson(DEMO_USERS_KEY, users);
      // Volver de WhatsApp / banco (o una recarga) retoma la sesión del día si sigue valiendo.
      const resumed = resumeSession(users, businessTodayIso());
      const idle = resumed != null && idleLimited(resumed, channel) && sessionIdleExpired();
      if (resumed && !idle && sessionAllowedOnChannel(resumed, channel)) {
        writeSession(resumed);
        markSessionActive();
        setSession(resumed);
      } else {
        clearSession();
        setSession(null);
      }
      mq = window.matchMedia("(max-width: 900px)");
      syncPhone();
      mq.addEventListener("change", syncPhone);
      setReady(true);

      // Sync personas en fondo (otro PC/celular). Con el Listado nuevo se revisa la sesión.
      void (async () => {
        try {
          await flushUserMirrorQueues();
          await pullRemoteUsersIntoDemo();
          if (cancelled) return;
          writeDemoJson(DEMO_USERS_KEY, loadDemoUsers());
          setSession((prev) => keepIfValid(prev, channel));
        } catch (error) {
          console.error("auth-users-sync", error);
        }
      })();
    }

    void boot();

    return () => {
      cancelled = true;
      mq?.removeEventListener("change", syncPhone);
    };
  }, [channel]);

  useEffect(() => {
    if (!session) return;
    if (sessionAllowedOnChannel(session, channel)) return;
    clearSession();
    setSession(null);
  }, [session, channel]);

  const loggedIn = session != null;
  useEffect(() => {
    if (!loggedIn) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") setSession((prev) => keepIfValid(prev, channel));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loggedIn, channel]);

  const idleWatch = session != null && idleLimited(session, channel);
  useEffect(() => {
    if (!idleWatch) return;
    let lastMark = 0;
    const onActivity = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastMark < ACTIVITY_MARK_EVERY_MS) return;
      lastMark = now;
      markSessionActive(now);
    };
    const check = () => {
      if (document.visibilityState === "visible") setSession((prev) => keepIfValid(prev, channel));
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    events.forEach((name) =>
      window.addEventListener(name, onActivity, { capture: true, passive: true }),
    );
    const timer = window.setInterval(check, IDLE_CHECK_EVERY_MS);
    return () => {
      events.forEach((name) => window.removeEventListener(name, onActivity, { capture: true }));
      window.clearInterval(timer);
    };
  }, [idleWatch, channel]);

  if (!ready) {
    return <div className="login-screen login-loading" aria-hidden />;
  }

  if (!session || !sessionAllowedOnChannel(session, channel)) {
    return (
      <LoginScreen
        key={`login-${channel}`}
        channel={channel}
        onSuccess={(next) => {
          if (!sessionAllowedOnChannel(next, channel)) return;
          const stamped = stampSession(next, loadDemoUsers(), businessTodayIso());
          writeSession(stamped);
          markSessionActive();
          setSession(stamped);
        }}
      />
    );
  }

  const logout = () => {
    void (async () => {
      try {
        // Solo sube colas: un pull aquí rebobinaba el Listado antes de entrar.
        await flushUserMirrorQueues();
      } catch {
        /* offline */
      }
      void signOutSupabaseAuth();
      clearSession();
      setSession(null);
    })();
  };

  // Canal supervisor / cobrador y sus roles: solo su app móvil. Solo admin (truqui) entra al sistema.
  const shell = shellFor(session, channel);
  if (shell === "supervisor") {
    return <SupervisorShell session={session} onLogout={logout} />;
  }
  if (shell === "cobrador") {
    return <CollectorShell session={session} onLogout={logout} />;
  }

  return (
    <AppShell
      session={session}
      onSessionChange={setSession}
      onLogout={logout}
      phoneLayout={isPhone}
    />
  );
}
