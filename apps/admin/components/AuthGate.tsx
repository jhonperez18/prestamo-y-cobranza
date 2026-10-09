"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CollectorShell } from "@/components/CollectorShell";
import { LoginScreen } from "@/components/LoginScreen";
import { SupervisorShell } from "@/components/SupervisorShell";
import {
  clearSession,
  resumeSession,
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

/** Sesión viva: si el Listado la invalidó (clave, rol, baja) o ya es otro día → login. */
function keepIfValid(session: AppSession | null): AppSession | null {
  if (!session) return null;
  if (sessionStillValid(session, loadDemoUsers(), businessTodayIso())) return session;
  clearSession();
  return null;
}

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
      if (resumed && sessionAllowedOnChannel(resumed, channel)) {
        writeSession(resumed);
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
          setSession((prev) => keepIfValid(prev));
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
      if (document.visibilityState === "visible") setSession((prev) => keepIfValid(prev));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loggedIn]);

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

  // Canal supervisor: solo shell supervisor (nunca admin ni cobrador).
  if (channel === "supervisor") {
    return <SupervisorShell session={session} onLogout={logout} />;
  }

  // Canal cobrador: solo shell cobrador.
  if (channel === "cobrador") {
    return <CollectorShell session={session} onLogout={logout} />;
  }

  // Cobradores: únicamente app móvil (PC o celular).
  if (isCollectorSession(session) && !canAccessAdminPanel(session)) {
    return <CollectorShell session={session} onLogout={logout} />;
  }

  // Supervisor: únicamente app móvil (PC o celular).
  if (isSupervisorSession(session)) {
    return <SupervisorShell session={session} onLogout={logout} />;
  }

  // Solo admin (truqui) entra al sistema.
  if (!canAccessAdminPanel(session)) {
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
