"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import { DEMO_USER_PASSWORD } from "@/lib/mock-data";
import { loadDemoUsers } from "@/lib/demo-persist";
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

type Props = {
  onSuccess: (session: AppSession) => void;
  /** Link independiente: filtra usuarios y rechaza roles ajenos. */
  channel?: PwaChannelId;
};

const DEMO_HINTS: Array<{ login: string; role: string; channel: PwaChannelId }> = [
  { login: "truqui", role: "Admin · demo local", channel: "sistema" },
  { login: "supervisor", role: "Carlos · solo app supervisor", channel: "supervisor" },
  { login: "juan.rios", role: "Cobrador · solo app", channel: "cobrador" },
  { login: "lina.soto", role: "Cobradora · solo app", channel: "cobrador" },
  { login: "diego.mora", role: "Cobrador · solo app", channel: "cobrador" },
];

function channelRejectMessage(channel: PwaChannelId) {
  if (channel === "supervisor") {
    return "Este enlace es solo para supervisor. Usá el usuario supervisor.";
  }
  if (channel === "cobrador") {
    return "Este enlace es solo para cobrador. Usá tu usuario de cobro.";
  }
  return "Usuario no permitido en este acceso.";
}

export function LoginScreen({ onSuccess, channel = "sistema" }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabaseReady = getSupabasePublicEnv().configured;
  const channelMeta = PWA_CHANNELS[channel];
  const hints =
    channel === "sistema"
      ? DEMO_HINTS
      : DEMO_HINTS.filter((entry) => entry.channel === channel);

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
      // 1) Email directo Auth
      if (shouldTrySupabaseLogin(username)) {
        const result = await loginWithSupabaseAuth(username, password);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        acceptSession(result.session);
        return;
      }

      // 2) Login corto (juan.rios) → intenta Auth con email mapeado
      const mappedEmail = authEmailFromLoginHint(username);
      if (mappedEmail && mappedEmail.includes("@")) {
        const result = await loginWithSupabaseAuth(mappedEmail, password);
        if (result.ok) {
          acceptSession(result.session);
          return;
        }
        // si Auth falla, cae a demo local
      }

      const users = loadDemoUsers();
      const session = validateLogin(username, password, users);
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
                ? "supervisor"
                : channel === "cobrador"
                  ? "juan.rios o tu usuario"
                  : supabaseReady
                    ? "jhonefe18@yahoo.es o truqui"
                    : "truqui o usuario de acceso"
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

        <div className="login-demo-hints">
          {!supabaseReady ? (
            <p>Usuarios de prueba (contraseña: {DEMO_USER_PASSWORD})</p>
          ) : null}
          <ul>
            {hints.map((entry) => (
              <li key={entry.login}>
                <button
                  type="button"
                  className="login-demo-btn"
                  onClick={() => {
                    setUsername(entry.login);
                    setPassword(DEMO_USER_PASSWORD);
                    setError("");
                  }}
                  disabled={busy}
                >
                  <strong>{entry.login}</strong>
                  <span>{entry.role}</span>
                </button>
              </li>
            ))}
          </ul>
          {APP_BUILD ? (
            <p className="login-build-stamp" title="Commit desplegado en este sitio">
              Código en este sitio: <strong>{APP_BUILD}</strong>
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
