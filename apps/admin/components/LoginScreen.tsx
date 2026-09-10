"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import { DEMO_USER_PASSWORD } from "@/lib/mock-data";
import { loadDemoUsers } from "@/lib/demo-persist";
import { APP_BUILD } from "@/lib/app-build";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import {
  loginWithSupabaseAuth,
  shouldTrySupabaseLogin,
} from "@/lib/supabase/auth-login";

type Props = {
  onSuccess: (session: AppSession) => void;
};

const DEMO_HINTS = [
  { login: "truqui", role: "Admin · demo local" },
  { login: "supervisor", role: "Carlos · solo app supervisor" },
  { login: "juan.rios", role: "Cobrador · solo app" },
  { login: "lina.soto", role: "Cobradora · solo app" },
  { login: "diego.mora", role: "Cobrador · solo app" },
];

export function LoginScreen({ onSuccess }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabaseReady = getSupabasePublicEnv().configured;

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

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
        onSuccess(result.session);
        return;
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
            src="/logo-ca-prestamo.png"
            alt="CA préstamo"
            className="login-logo"
            tabIndex={-1}
            draggable={false}
          />
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
          {supabaseReady ? (
            <p>
              Acceso seguro: email de Supabase. Debajo siguen usuarios demo locales.
            </p>
          ) : (
            <p>Usuarios de prueba (contraseña: {DEMO_USER_PASSWORD})</p>
          )}
          <ul>
            {DEMO_HINTS.map((entry) => (
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
