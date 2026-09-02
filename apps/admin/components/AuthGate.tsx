"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CollectorShell } from "@/components/CollectorShell";
import { LoginScreen } from "@/components/LoginScreen";
import {
  clearSession,
  readSession,
  writeSession,
  type AppSession,
} from "@/lib/auth";
import { canAccessAdminPanel } from "@/lib/session-access";

export function AuthGate() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setReady(true);
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

  if (!canAccessAdminPanel(session)) {
    return (
      <CollectorShell
        session={session}
        onLogout={() => {
          clearSession();
          setSession(null);
        }}
      />
    );
  }

  return (
    <AppShell
      session={session}
      onSessionChange={setSession}
      onLogout={() => {
        clearSession();
        setSession(null);
      }}
    />
  );
}
