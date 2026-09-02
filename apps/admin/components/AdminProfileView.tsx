"use client";

import { useRef, useState, type FormEvent } from "react";
import { DEFAULT_DEMO_PASSWORD, type AppSession } from "@/lib/auth";
import {
  applyProfileToSession,
  readAdminProfile,
  saveAdminPassword,
  saveAdminProfile,
  syncUserRowFromProfile,
  type AdminProfile,
} from "@/lib/admin-profile";
import { loadDemoUsers } from "@/lib/demo-persist";

type Props = {
  session: AppSession;
  onSessionChange: (session: AppSession) => void;
  onToast: (message?: string) => void;
};

export function AdminProfileView({ session, onSessionChange, onToast }: Props) {
  const [profile, setProfile] = useState<AdminProfile>(() =>
    readAdminProfile(session.userRef, session.name, session.username),
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);

  function saveProfile(event: FormEvent) {
    event.preventDefault();

    const login = profile.login.trim();
    if (!login) {
      onToast("Ingrese el usuario.");
      return;
    }

    const users = loadDemoUsers();
    const taken = users.some(
      (row) => row.ref !== session.userRef && row.login.toLowerCase() === login.toLowerCase(),
    );
    if (taken) {
      onToast("Ese usuario ya está en uso.");
      return;
    }

    const nextProfile = { ...profile, login };
    saveAdminProfile(session.userRef, nextProfile);
    syncUserRowFromProfile(session.userRef, nextProfile);
    setProfile(nextProfile);
    onSessionChange(applyProfileToSession(session, nextProfile));
    onToast("Perfil actualizado.");
  }

  function savePassword(event: FormEvent) {
    event.preventDefault();
    const current = currentPassword.trim();
    const next = password.trim();
    const confirm = passwordConfirm.trim();

    if (!current) {
      onToast("Ingrese su contraseña actual.");
      return;
    }
    if (!next) {
      onToast("Ingrese la nueva contraseña.");
      return;
    }
    if (next.length < 4) {
      onToast("La contraseña debe tener al menos 4 caracteres.");
      return;
    }
    if (next !== confirm) {
      onToast("Las contraseñas no coinciden.");
      return;
    }

    const users = loadDemoUsers();
    const user = users.find((row) => row.ref === session.userRef);
    const expected = user?.password?.trim() || DEFAULT_DEMO_PASSWORD;
    if (current !== expected) {
      onToast("Contraseña actual incorrecta.");
      return;
    }

    saveAdminPassword(session.userRef, profile.login.trim() || session.username, next);
    setCurrentPassword("");
    setPassword("");
    setPasswordConfirm("");
    onToast("Contraseña actualizada.");
  }

  function onPhotoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      onToast("Seleccione una imagen JPG o PNG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setProfile((current) => ({ ...current, photo: String(reader.result) }));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  return (
    <section className="panel settings-panel">
      <div className="head">
        <h1>Perfil</h1>
      </div>

      <div className="settings-main">
        <div className="sheet settings-sheet settings-profile-page">
          <form onSubmit={saveProfile}>
            <div className="sheet-body settings-profile-sheet">
              <div className="sheet-fields settings-profile-fields">
                <div className="sheet-row split">
                  <span className="sheet-label">Nombre</span>
                  <input
                    value={profile.displayName}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, displayName: event.target.value }))
                    }
                    required
                  />
                  <span className="sheet-label">Usuario</span>
                  <input
                    value={profile.login}
                    autoComplete="username"
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, login: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Teléfono</span>
                  <input
                    value={profile.phone}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, phone: event.target.value }))
                    }
                  />
                  <span className="sheet-label">Documento</span>
                  <input
                    value={profile.document}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, document: event.target.value }))
                    }
                  />
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Rol</span>
                  <input value={session.roleName} readOnly tabIndex={-1} />
                  <span className="sheet-label sheet-label-empty" aria-hidden />
                  <span className="sheet-cell-empty" aria-hidden />
                </div>
              </div>

              <div className="settings-photo-block">
                <input
                  ref={photoRef}
                  id="settings-profile-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={onPhotoPick}
                />
                <label
                  htmlFor="settings-profile-photo"
                  className={profile.photo ? "settings-photo-btn has-photo" : "settings-photo-btn"}
                >
                  {profile.photo ? <img src={profile.photo} alt="" /> : <span>Foto</span>}
                </label>
              </div>
            </div>

            <div className="form-actions settings-section-actions">
              <button type="submit" className="btn primary">
                Guardar perfil
              </button>
            </div>
          </form>

          <form onSubmit={savePassword}>
            <div className="sheet-fields settings-profile-fields settings-profile-password">
              <div className="sheet-row settings-sheet-section">
                <span className="sheet-label">Cambiar contraseña</span>
              </div>
              <div className="sheet-row split">
                <span className="sheet-label">Actual</span>
                <input
                  type="password"
                  value={currentPassword}
                  autoComplete="current-password"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
                <span className="sheet-label sheet-label-empty" aria-hidden />
                <span className="sheet-cell-empty" aria-hidden />
              </div>
              <div className="sheet-row split">
                <span className="sheet-label">Nueva</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <span className="sheet-label">Confirmar</span>
                <input
                  type="password"
                  value={passwordConfirm}
                  autoComplete="new-password"
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                />
              </div>
            </div>

            <div className="form-actions settings-section-actions">
              <button type="submit" className="btn primary">
                Cambiar contraseña
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
