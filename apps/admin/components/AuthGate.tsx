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
import { canAccessAdminPanel } from "@/lib/session-access";
import { signOutSupabaseAuth } from "@/lib/supabase/auth-login";
import { resolvePwaChannel, type PwaChannel } from "@/lib/pwa-channels";

/**
 * Acceso:
 * - truqui (admin) → sistema completo (panel PC; en celular chrome compacto + menú cajón)
 * - cobradores → solo app cobrador
 * - supervisor → solo app supervisor
 *
 * Canal PWA (?canal= / futuro subdominio) solo etiqueta el acceso; el rol lo decide el login.
 */
function isCollectorSession(session: AppSession) {
  return session.roleRef === COLLECTOR_ROLE_REF || Boolean(session.collectorRef);
}

function isSupervisorSession(session: AppSession) {
  return session.roleRef === SUPERVISOR_ROLE_REF;
}

export function AuthGate() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [ready, setReady] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [pwaChannel, setPwaChannel] = useState<PwaChannel>(() => resolvePwaChannel({}));

  useEffect(() => {
    // 1) Si el build de Vercel cambió (candado virgen), invalida paquete local.
    // 2) Bootstrap vacío. Sin esto el celular sigue con localStorage viejo aunque el deploy sea nuevo.
    try {
      syncDemoStorageToServedBuild();
      bootstrapProtectedDemoData();
    } catch {
      /* ignore */
    }

    const users = loadDemoUsers();
    writeDemoJson(DEMO_USERS_KEY, users);
    // Cada visita al link (Vercel/local) empieza en login: usuario + contraseña.
    clearSession();
    setSession(null);

    const params = new URLSearchParams(window.location.search);
    setPwaChannel(
      resolvePwaChannel({
        host: window.location.hostname,
        canalParam: params.get("canal"),
      }),
    );

    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    setReady(true);

    return () => {
      mq.removeEventListener("change", sync);
    };
  }, []);

  if (!ready) {
    return <div className="login-screen login-loading" aria-hidden />;
  }

  if (!session) {
    return (
      <LoginScreen
        channelEyebrow={pwaChannel.loginEyebrow}
        onSuccess={(next) => {
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
