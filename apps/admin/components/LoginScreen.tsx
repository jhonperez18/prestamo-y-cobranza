"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateLogin, type AppSession } from "@/lib/auth";
import { DEMO_USER_PASSWORD } from "@/lib/mock-data";
import { loadDemoUsers } from "@/lib/demo-persist";

type Props = {
  onSuccess: (session: AppSession) => void;
};

const DEMO_HINTS = [
  { login: "truqui", role: "Administrador · panel web" },
  { login: "supervisor", role: "Supervisor · app móvil en celular" },
  { login: "juan.rios", role: "Cobrador · app móvil" },
];

export function LoginScreen({ onSuccess }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const users = loadDemoUsers();
    const session = validateLogin(username, password, users);
    if (!session) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }
    setError("");
    onSuccess(session);
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
          <p>Panel de administración</p>
        </div>

        <label className="login-field">
          <span>Usuario</span>
          <input
            name="usuario"
            autoComplete="username"
            placeholder="truqui o usuario de acceso"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
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
          />
        </label>

        {error ? <p className="login-error">{error}</p> : null}

        <button type="submit" className="btn primary login-submit">
          Entrar
        </button>

        <div className="login-demo-hints">
          <p>Usuarios de prueba (contraseña: {DEMO_USER_PASSWORD})</p>
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
                >
                  <strong>{entry.login}</strong>
                  <span>{entry.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </form>
    </div>
  );
}
