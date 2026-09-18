"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import { DEMO_USER_PASSWORD } from "@/lib/mock-data";
import { loadDemoUsers } from "@/lib/demo-persist";
import { APP_BUILD } from "@/lib/app-build";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import {
  authEmailFromLoginHint,
  loginWithSupabaseAuth,
  shouldTrySupabaseLogin,
} from "@/lib/supabase/auth-login";
import type { PwaChannelId } from "@/lib/pwa-channels";

type Props = {
  onSuccess: (session: AppSession) => void;
  /** Canal PWA / futuro subdominio (sistema · supervisor · cobrador). */
  channelEyebrow?: string;
};

const DEMO_HINTS: Array<{
  login: string;
  role: string;
  canals: PwaChannelId[];
}> = [
  { login: "truqui", role: "Admin · demo local", canals: ["sistema"] },
  { login: "supervisor", role: "Carlos · solo app supervisor", canals: ["sistema", "supervisor"] },
  { login: "juan.rios", role: "Cobrador · solo app", canals: ["sistema", "cobrador"] },
  { login: "lina.soto", role: "Cobradora · solo app", canals: ["sistema", "cobrador"] },
  { login: "diego.mora", role: "Cobrador · solo app", canals: ["sistema", "cobrador"] },
];

export function LoginScreen({ onSuccess, channelEyebrow }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabaseReady = getSupabasePublicEnv().configured;
  const hints = DEMO_HINTS.filter((entry) => {
    if (!channelEyebrow) return true;
    const key = channelEyebrow.toLowerCase();
    if (key.includes("supervisor")) return entry.canals.includes("supervisor");
    if (key.includes("cobrador")) return entry.canals.includes("cobrador");
    return true;
  });

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

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
        onSuccess(result.session);
        return;
      }

      // 2) Login corto (juan.rios) → intenta Auth con email mapeado
      const mappedEmail = authEmailFromLoginHint(username);
      if (mappedEmail && mappedEmail.includes("@")) {
        const result = await loginWithSupabaseAuth(mappedEmail, password);
        if (result.ok) {
          onSuccess(result.session);
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
      onSuccess(session);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <img
            src="/pwa/icons/icon-192.png"
            alt="CA préstamo"
            className="login-logo"
            tabIndex={-1}
            draggable={false}
          />
          {channelEyebrow ? <p className="login-channel-eyebrow">{channelEyebrow}</p> : null}
          <p>Acceso CA préstamo</p>
        </div>

        <label className="login-field">
          <span>{supabaseReady ? "Email o usuario" : "Usuario"}</span>
          <input
            name="usuario"
            autoComplete="username"
            placeholder={
              supabaseReady
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
