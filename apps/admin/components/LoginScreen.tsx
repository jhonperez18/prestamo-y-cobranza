"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import { APP_BUILD } from "@/lib/app-build";
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
import { readUsersCatalog } from "@/lib/users-catalog";

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
 */
export function LoginScreen({ onSuccess, channel = "sistema" }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabaseReady = getSupabasePublicEnv().configured;
  const channelMeta = PWA_CHANNELS[channel];

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  function acceptSession(session: AppSession) {
    if (!sessionAllowedOnChannel(session, channel)) {
      setError(channelRejectMessage(channel));
      return false;
    }
    onSuccess(session);
    return true;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      // 1) Listado primero: lo que se guarda en Modificar usuario es lo que entra.
      const catalogSession = validateLogin(username, password, readUsersCatalog());
      if (catalogSession) {
        acceptSession(catalogSession);
        return;
      }

      // 2) Respaldo Auth (email SSO). Si falla, no inventar otro mensaje: el catálogo ya dijo no.
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
    } finally {
      setBusy(false);
    }
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

        <button type="submit" className="btn primary login-submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>

        {APP_BUILD ? (
          <p className="login-build-stamp" title="Commit desplegado en este sitio">
            Código en este sitio: <strong>{APP_BUILD}</strong>
          </p>
        ) : null}
      </form>
    </div>
  );
}
