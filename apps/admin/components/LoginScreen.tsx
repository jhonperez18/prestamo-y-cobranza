"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import { APP_BUILD } from "@/lib/app-build";
import { refreshServedBuildOrReload } from "@/lib/bust-client-cache";
import {
  PWA_CHANNELS,
  sessionAllowedOnChannel,
  type PwaChannelId,
} from "@/lib/pwa-channels";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import {
  authEmailFromLoginHint,
  loginWithSupabaseAuth,
  shouldTrySupabaseLogin,
} from "@/lib/supabase/auth-login";
import { commitUsersCatalog, readUsersCatalog } from "@/lib/users-catalog";
import {
  flushUserMirrorQueues,
  mirrorToUserRow,
  pullRemoteUsersIntoDemo,
  type UserMirrorRow,
} from "@/lib/supabase/user-mirror";
import type { UserRow } from "@/lib/mock-data";

type Props = {
  onSuccess: (session: AppSession) => void;
  /** Link independiente: filtra y rechaza roles ajenos. */
  channel?: PwaChannelId;
};

function channelRejectMessage(channel: PwaChannelId) {
  if (channel === "supervisor") {
    return "Este enlace es solo para supervisor.";
  }
  if (channel === "cobrador") {
    return "Este enlace es solo para cobrador.";
  }
  return "Usuario no permitido en este acceso.";
}

/**
 * Solo entrada (usuario + contraseña).
 * Fuente de verdad = Usuario → Listado (misma clave/login que Guardar cambios).
 * Supabase Auth es respaldo opcional; nunca bloquea el catálogo del sistema madre.
 *
 * Salir cierra este panel: para volver hay que abrir desde el icono de la app
 * (así el boot vuelve a tirar pull/actualizaciones).
 */
export function LoginScreen({ onSuccess, channel = "sistema" }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exited, setExited] = useState(false);
  /** En local se refresca desde /api/ops/build-health (SHA vivo). */
  const [buildStamp, setBuildStamp] = useState(APP_BUILD);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabaseReady = getSupabasePublicEnv().configured;
  const channelMeta = PWA_CHANNELS[channel];

  useEffect(() => {
    if (exited) return;
    passwordRef.current?.focus();
  }, [exited]);

  useEffect(() => {
    let cancelled = false;
    function onVisible() {
      if (document.visibilityState === "visible") void refreshBuild();
    }
    async function refreshBuild() {
      const build = await refreshServedBuildOrReload();
      if (!cancelled && build) setBuildStamp(build);
    }
    void refreshBuild();
    window.addEventListener("focus", refreshBuild);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshBuild);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!exited) return;
    let leftScreen = false;
    function onVis() {
      if (document.visibilityState === "hidden") {
        leftScreen = true;
        return;
      }
      // Solo al volver desde el icono / otra app (no al pintar Salir).
      if (leftScreen && document.visibilityState === "visible") {
        window.location.reload();
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [exited]);

  function acceptSession(session: AppSession) {
    if (!sessionAllowedOnChannel(session, channel)) {
      setError(channelRejectMessage(channel));
      return false;
    }
    onSuccess(session);
    return true;
  }

  function onExitPanel() {
    setUsername("");
    setPassword("");
    setError("");
    setExited(true);
    try {
      window.close();
    } catch {
      /* PWA / pestaña: el navegador puede bloquear close; queda la pantalla Salir. */
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      // La subida del listado no bloquea la entrada.
      void flushUserMirrorQueues().catch(() => {
        /* offline */
      });

      // 1) Local primero = acceso inmediato tras crear/modificar en este aparato.
      let catalogSession = validateLogin(username, password, readUsersCatalog());
      if (catalogSession) {
        acceptSession(catalogSession);
        return;
      }

      // 2) Si no está en local, trae nube (otro PC/celular) y reintenta.
      try {
        await pullRemoteUsersIntoDemo();
      } catch {
        /* offline */
      }
      catalogSession = validateLogin(username, password, readUsersCatalog());
      if (catalogSession) {
        acceptSession(catalogSession);
        return;
      }

      // 3) Este navegador puede tener otra clave vieja. Si la nube coincide, esa entra.
      try {
        const res = await fetch("/api/users", { cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; users?: UserMirrorRow[] };
        if (res.ok && body.ok) {
          const remote = (body.users ?? [])
            .map(mirrorToUserRow)
            .filter((row): row is UserRow => Boolean(row));
          catalogSession = validateLogin(username, password, remote);
          const match = remote.find((row) => row.ref === catalogSession?.userRef);
          if (catalogSession && match) {
            const current = readUsersCatalog();
            const next = current.some((row) => row.ref === match.ref)
              ? current.map((row) => (row.ref === match.ref ? match : row))
              : [...current, match];
            commitUsersCatalog(next);
            acceptSession(catalogSession);
            return;
          }
        }
      } catch {
        /* offline */
      }

      // 4) Respaldo Auth (email SSO).
      if (supabaseReady) {
        const emailHint = shouldTrySupabaseLogin(username)
          ? username.trim()
          : authEmailFromLoginHint(username);
        if (emailHint && emailHint.includes("@")) {
          const result = await loginWithSupabaseAuth(emailHint, password);
          if (result.ok) {
            acceptSession(result.session);
            return;
          }
        }
      }

      setError("Usuario o contraseña incorrectos.");
    } catch (error) {
      console.error("login", error);
      setError("La clave es correcta, pero el navegador está lleno y no pudo guardar la entrada. Recarga e intenta otra vez.");
    } finally {
      setBusy(false);
    }
  }

  if (exited) {
    return (
      <div className="login-screen login-exited">
        <div className="login-card login-exited-card">
          <img
            src="/logo-ca-prestamo.png"
            alt="CA préstamo"
            className="login-logo"
            draggable={false}
          />
          <p className="login-exited-title">Panel cerrado</p>
          <p className="login-exited-copy">
            Abrí de nuevo desde el icono de la app para entrar con usuario y contraseña (trae la
            versión actualizada).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <img
            src="/logo-ca-prestamo.png"
            alt="CA préstamo"
            className="login-logo"
            tabIndex={-1}
            draggable={false}
          />
          <p>{channelMeta.loginEyebrow}</p>
        </div>

        <label className="login-field">
          <span>{supabaseReady ? "Email o usuario" : "Usuario"}</span>
          <input
            name="usuario"
            autoComplete="username"
            placeholder={
              channel === "supervisor"
                ? "Tu usuario de supervisor"
                : channel === "cobrador"
                  ? "Tu usuario de cobro"
                  : supabaseReady
                    ? "Email o usuario"
                    : "Usuario de acceso"
            }
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            disabled={busy}
          />
        </label>

        <label className="login-field">
          <span>Contraseña</span>
          <input
            ref={passwordRef}
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={busy}
          />
        </label>

        {error ? <p className="login-error">{error}</p> : null}

        <div className="login-actions">
          <button type="submit" className="btn login-action-btn" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          <button
            type="button"
            className="btn login-action-btn"
            onClick={onExitPanel}
            disabled={busy}
          >
            Salir
          </button>
        </div>

        {buildStamp ? (
          <p className="login-build-stamp" title="Commit desplegado en este sitio">
            Código en este sitio: <strong>{buildStamp}</strong>
          </p>
        ) : null}
      </form>
    </div>
  );
}
