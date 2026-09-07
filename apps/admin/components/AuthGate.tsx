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
import { SUPERVISOR_ROLE_REF } from "@/lib/mock-data";
import { canAccessAdminPanel } from "@/lib/session-access";

const PHONE_MQ = "(max-width: 900px)";

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
    return () => mq.removeEventListener("change", sync);
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

  if (!canAccessAdminPanel(session)) {
    return <CollectorShell session={session} onLogout={logout} />;
  }

  if (isSupervisorSession(session) && isPhone) {
    return <SupervisorShell session={session} onLogout={logout} />;
  }

  return (
    <AppShell
      session={session}
      onSessionChange={setSession}
      onLogout={logout}
    />
  );
}
