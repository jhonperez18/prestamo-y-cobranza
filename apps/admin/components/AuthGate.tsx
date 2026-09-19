"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CollectorShell } from "@/components/CollectorShell";
import { LoginScreen } from "@/components/LoginScreen";
import { SupervisorShell } from "@/components/SupervisorShell";
import {
  clearSession,
  writeSession,
  type AppSession,
} from "@/lib/auth";
import { bootstrapProtectedDemoData } from "@/lib/bootstrap-demo-data";
import { syncDemoStorageToServedBuild } from "@/lib/demo-build-sync";
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

export function AuthGate({ channel = "sistema" }: Props) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [usersEpoch, setUsersEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let mq: MediaQueryList | null = null;
    const syncPhone = () => {
      if (mq) setIsPhone(mq.matches);
    };

    async function boot() {
      try {
        syncDemoStorageToServedBuild();
        bootstrapProtectedDemoData();
      } catch {
        /* ignore */
      }

      try {
        await flushUserMirrorQueues();
        await pullRemoteUsersIntoDemo();
      } catch {
        /* offline: sigue con caché local */
      }

      if (cancelled) return;

      const users = loadDemoUsers();
      writeDemoJson(DEMO_USERS_KEY, users);
      clearSession();
      setSession(null);
      setUsersEpoch((n) => n + 1);
      mq = window.matchMedia("(max-width: 900px)");
      syncPhone();
      mq.addEventListener("change", syncPhone);
      setReady(true);
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

  if (!ready) {
    return <div className="login-screen login-loading" aria-hidden />;
  }

  if (!session || !sessionAllowedOnChannel(session, channel)) {
    return (
      <LoginScreen
        key={`login-${channel}-${usersEpoch}`}
        channel={channel}
        onSuccess={(next) => {
          if (!sessionAllowedOnChannel(next, channel)) return;
          writeSession(next);
          setSession(next);
        }}
      />
    );
  }

  const logout = () => {
    void signOutSupabaseAuth();
    clearSession();
    setSession(null);
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
