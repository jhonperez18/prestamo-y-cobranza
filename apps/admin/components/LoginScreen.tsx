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
 * Los usuarios se administran únicamente en Usuario → Listado.
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
      if (shouldTrySupabaseLogin(username)) {
        const result = await loginWithSupabaseAuth(username, password);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        acceptSession(result.session);
        return;
      }

      const mappedEmail = authEmailFromLoginHint(username);
      if (mappedEmail && mappedEmail.includes("@")) {
        const result = await loginWithSupabaseAuth(mappedEmail, password);
        if (result.ok) {
          acceptSession(result.session);
          return;
        }
      }

      // Misma fuente que Usuario → Listado (sin segunda lista en pantalla).
      const session = validateLogin(username, password, readUsersCatalog());
      if (!session) {
        setError("Usuario o contraseña incorrectos.");
        return;
      }
      acceptSession(session);
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
