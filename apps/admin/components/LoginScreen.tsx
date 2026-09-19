"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import {
  COLLECTOR_ROLE_REF,
  DEMO_USER_PASSWORD,
  roleByRef,
  ROLES,
  SUPERVISOR_ROLE_REF,
  type UserRow,
} from "@/lib/mock-data";
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
import {
  readUsersCatalog,
  USERS_CATALOG_EVENT,
} from "@/lib/users-catalog";

type Props = {
  onSuccess: (session: AppSession) => void;
  /** Link independiente: filtra usuarios y rechaza roles ajenos. */
  channel?: PwaChannelId;
};

type LoginHint = {
  login: string;
  role: string;
  channel: PwaChannelId;
};

function channelForUser(user: UserRow): PwaChannelId {
  if (user.roleRef === SUPERVISOR_ROLE_REF) return "supervisor";
  if (user.roleRef === COLLECTOR_ROLE_REF || user.collectorRef) return "cobrador";
  return "sistema";
}

function hintLabel(user: UserRow): string {
  const roleName = roleByRef(user.roleRef, ROLES)?.name ?? "Usuario";
  const channel = channelForUser(user);
  if (channel === "supervisor") return `${user.name} · solo app supervisor`;
  if (channel === "cobrador") {
    const femenino = /a$/i.test(user.name.trim().split(/\s+/)[0] ?? "");
    return `${user.name} · ${femenino ? "Cobradora" : "Cobrador"} · solo app`;
  }
  return `${user.name} · ${roleName}`;
}

/** Exactamente el Listado (activos), mismo orden USR-. */
function loginHintsFromCatalog(channel: PwaChannelId): LoginHint[] {
  const hints = readUsersCatalog()
    .filter((row) => row.active !== false)
    .map((row) => ({
      login: row.login,
      role: hintLabel(row),
      channel: channelForUser(row),
    }));
  if (channel === "sistema") return hints;
  return hints.filter((entry) => entry.channel === channel);
}

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
  const [hints, setHints] = useState(() => loginHintsFromCatalog(channel));
  const passwordRef = useRef<HTMLInputElement>(null);
  const supabaseReady = getSupabasePublicEnv().configured;
  const channelMeta = PWA_CHANNELS[channel];

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  useEffect(() => {
    function refresh() {
      setHints(loginHintsFromCatalog(channel));
    }
    refresh();
    window.addEventListener(USERS_CATALOG_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(USERS_CATALOG_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [channel]);

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
          <p>Usuarios del sistema (mismo listado)</p>
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
