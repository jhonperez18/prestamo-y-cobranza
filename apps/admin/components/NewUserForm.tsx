"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ASSIGNABLE_ROLES,
  COLLECTOR_ROLE_REF,
  DEMO_USER_PASSWORD,
  suggestedAccessLogin,
  suggestedUserEmail,
  type RoleRow,
} from "@/lib/mock-data";
import { defaultPermissionsForRole } from "@/lib/access-preview";
import { PermissionChecklist } from "@/components/PermissionChecklist";

export type UserDraft = {
  name: string;
  email: string;
  login: string;
  password: string;
  phone: string;
  document: string;
  roleRef: string;
  permissions: string[];
  active: boolean;
};

type Props = {
  roles?: RoleRow[];
  onCancel: () => void;
  onSave: (draft: UserDraft) => void;
};

export function NewUserForm({ roles = ASSIGNABLE_ROLES, onCancel, onSave }: Props) {
  const [roleRef, setRoleRef] = useState(COLLECTOR_ROLE_REF);
  const [email, setEmail] = useState("");
  const [login, setLogin] = useState("");
  const [permissions, setPermissions] = useState<string[]>(() =>
    defaultPermissionsForRole(roles.find((row) => row.ref === COLLECTOR_ROLE_REF) ?? null),
  );

  const role = roles.find((row) => row.ref === roleRef) ?? roles[0];
  const isCollector = roleRef === COLLECTOR_ROLE_REF;
  const hasMobile = Boolean(role?.channels.includes("mobile"));
  const hasAdmin = Boolean(role?.channels.includes("admin"));

  useEffect(() => {
    setPermissions(defaultPermissionsForRole(roles.find((row) => row.ref === roleRef) ?? null));
  }, [roleRef, roles]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: String(form.get("nombre") ?? "").trim(),
      email: String(form.get("email") ?? email).trim(),
      login: String(form.get("login") ?? login).trim(),
      password: String(form.get("password") ?? DEMO_USER_PASSWORD).trim() || DEMO_USER_PASSWORD,
      phone: String(form.get("telefono") ?? "").trim(),
      document: String(form.get("documento") ?? "").trim(),
      roleRef: String(form.get("rol") ?? roleRef),
      permissions,
      active: form.get("activo") === "on",
    });
  }

  function suggestFromName(name: string) {
    const nextEmail = suggestedUserEmail(name);
    const nextLogin = suggestedAccessLogin(name);
    if (nextEmail) setEmail(nextEmail);
    if (nextLogin) setLogin(nextLogin);
  }

  return (
    <>
      <div className="head">
        <h1>Nuevo usuario</h1>
      </div>

      <form className="sheet collector-create" onSubmit={onSubmit}>
        <div className="sheet-body">
          <div className="sheet-fields">
            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="usr-nombre">
                Nombre
              </label>
              <input
                id="usr-nombre"
                name="nombre"
                required
                autoComplete="name"
                placeholder="Nombre completo"
                onBlur={(event) => suggestFromName(event.target.value)}
              />
              <label className="sheet-label" htmlFor="usr-documento">
                Documento
              </label>
              <input id="usr-documento" name="documento" placeholder="Cédula o ID" />
            </div>

            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="usr-telefono">
                Teléfono
              </label>
              <input
                id="usr-telefono"
                name="telefono"
                required
                type="tel"
                placeholder="300 000 0000"
              />
              <label className="sheet-label" htmlFor="usr-email">
                Correo
              </label>
              <input
                id="usr-email"
                name="email"
                required
                type="email"
                autoComplete="email"
                placeholder="nombre@nexo.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="usr-rol">
                Acceso (rol)
              </label>
              <select
                id="usr-rol"
                name="rol"
                required
                value={roleRef}
                onChange={(event) => setRoleRef(event.target.value)}
              >
                {roles.map((entry) => (
                  <option key={entry.ref} value={entry.ref}>
                    {entry.name}
                    {entry.channels.includes("mobile") && entry.channels.includes("admin")
                      ? " · Web + móvil"
                      : entry.channels.includes("mobile")
                        ? " · App móvil"
                        : " · Panel web"}
                  </option>
                ))}
              </select>
              <span className="sheet-label">Canal</span>
              <input
                readOnly
                tabIndex={-1}
                value={
                  hasMobile && hasAdmin
                    ? "Panel web y app móvil"
                    : hasMobile
                      ? "App móvil"
                      : "Panel web"
                }
              />
            </div>

            {isCollector ? (
              <div className="sheet-row">
                <span className="sheet-label">Vínculo cobrador</span>
                <input
                  readOnly
                  tabIndex={-1}
                  value="Al guardar se crea el perfil de cobrador vinculado a este usuario"
                />
              </div>
            ) : null}

            <label className="collector-active">
              <input type="checkbox" name="activo" defaultChecked />
              Usuario activo
            </label>

            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="usr-login">
                Usuario
              </label>
              <input
                id="usr-login"
                name="login"
                required
                autoComplete="username"
                placeholder="nombre.apellido"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
              />
              <label className="sheet-label" htmlFor="usr-password">
                Contraseña
              </label>
              <input
                id="usr-password"
                name="password"
                type="password"
                autoComplete="new-password"
                defaultValue={DEMO_USER_PASSWORD}
                placeholder="Contraseña de acceso"
              />
            </div>

            <div className="access-perms">
              <PermissionChecklist
                role={role ?? null}
                selected={permissions}
                onChange={setPermissions}
              />
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primary">
            Crear usuario
          </button>
        </div>
      </form>
    </>
  );
}
