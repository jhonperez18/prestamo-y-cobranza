"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CollectorShell } from "@/components/CollectorShell";
import { LoginScreen } from "@/components/LoginScreen";
import { SupervisorShell } from "@/components/SupervisorShell";
import {
  clearSession,
  readSession,
  writeSession,
  type AppSession,
} from "@/lib/auth";
import { bootstrapProtectedDemoData } from "@/lib/bootstrap-demo-data";
import { COLLECTOR_ROLE_REF, SUPERVISOR_ROLE_REF } from "@/lib/mock-data";
import { canAccessAdminPanel } from "@/lib/session-access";

const PHONE_MQ = "(max-width: 900px)";

function isCollectorSession(session: AppSession) {
  return (
    session.roleRef === COLLECTOR_ROLE_REF ||
    Boolean(session.collectorRef) ||
    (session.channels.includes("mobile") && !session.channels.includes("admin"))
  );
}

function isSupervisorSession(session: AppSession) {
  return session.roleRef === SUPERVISOR_ROLE_REF;
}

export function AuthGate() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    setSession(readSession());
    const mq = window.matchMedia(PHONE_MQ);
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    setReady(true);

    // No bloquear el login: restaura/retención en segundo plano.
    const t = window.setTimeout(() => {
      try {
        bootstrapProtectedDemoData();
      } catch {
        /* ignore bootstrap errors */
      }
    }, 0);

    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", sync);
    };
  }, []);

  if (!ready) {
    return <div className="login-screen login-loading" aria-hidden />;
  }

  if (!session) {
    return (
      <LoginScreen
        onSuccess={(next) => {
          writeSession(next);
          setSession(next);
        }}
      />
    );
  }

  const logout = () => {
    clearSession();
    setSession(null);
  };

  // Cobradores: siempre app móvil (PC o celular).
  if (isCollectorSession(session) && !canAccessAdminPanel(session)) {
    return <CollectorShell session={session} onLogout={logout} />;
  }

  // Celular: apps móviles / vista móvil del sistema.
  if (isPhone) {
    if (isSupervisorSession(session)) {
      return <SupervisorShell session={session} onLogout={logout} />;
    }
    if (isCollectorSession(session)) {
      return <CollectorShell session={session} onLogout={logout} />;
    }
    // Admin u otros con panel: vista móvil del sistema completo.
    return (
      <AppShell
        session={session}
        onSessionChange={setSession}
        onLogout={logout}
        phoneLayout
      />
    );
  }

  // PC: panel web si tiene canal admin; si no, app cobrador.
  if (!canAccessAdminPanel(session)) {
    return <CollectorShell session={session} onLogout={logout} />;
  }

  return (
    <AppShell
      session={session}
      onSessionChange={setSession}
      onLogout={logout}
    />
  );
}
