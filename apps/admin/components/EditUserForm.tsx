"use client";

import { useState, type FormEvent } from "react";
import {
  ADMIN_ROLE_REF,
  ASSIGNABLE_ROLES,
  COLLECTOR_ROLE_REF,
  type CollectorRow,
  type RoleRow,
  type UserRow,
} from "@/lib/mock-data";
import { defaultPermissionsForRole } from "@/lib/access-preview";
import { PermissionChecklist } from "@/components/PermissionChecklist";

export type UserEditDraft = {
  name: string;
  email: string;
  login: string;
  password?: string;
  phone: string;
  document: string;
  roleRef: string;
  permissions: string[];
  active: boolean;
  collectorNotes?: string;
};

type Props = {
  user: UserRow;
  collector?: CollectorRow | null;
  roles?: RoleRow[];
  onCancel: () => void;
  onSave: (draft: UserEditDraft) => void;
};

function userEmail(user: UserRow) {
  if (user.email?.trim()) return user.email.trim();
  if (user.login.includes("@")) return user.login;
  return "";
}

export function EditUserForm({ user, collector, roles = ASSIGNABLE_ROLES, onCancel, onSave }: Props) {
  const [roleRef, setRoleRef] = useState(user.roleRef);
  const [permissions, setPermissions] = useState<string[]>(
    user.permissions?.length
      ? [...user.permissions]
      : defaultPermissionsForRole(roles.find((row) => row.ref === user.roleRef) ?? null),
  );
  const role = roles.find((row) => row.ref === roleRef) ?? roles[0];
  const isAdmin = user.roleRef === ADMIN_ROLE_REF;
  const isCollector = Boolean(user.collectorRef && roleRef === COLLECTOR_ROLE_REF);
  const hasMobile = Boolean(role?.channels.includes("mobile"));
  const hasAdmin = Boolean(role?.channels.includes("admin"));

  function changeRole(nextRef: string) {
    setRoleRef(nextRef);
    const nextRole = roles.find((row) => row.ref === nextRef) ?? null;
    if (nextRef === user.roleRef && user.permissions?.length) {
      setPermissions([...user.permissions]);
      return;
    }
    setPermissions(defaultPermissionsForRole(nextRole));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "").trim();
    onSave({
      name: String(form.get("nombre") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      login: String(form.get("login") ?? "").trim(),
      password: password || undefined,
      phone: String(form.get("telefono") ?? "").trim(),
      document: String(form.get("documento") ?? "").trim(),
      roleRef: String(form.get("rol") ?? roleRef),
      permissions,
      active: form.get("activo") === "on",
      collectorNotes: collector
        ? String(form.get("notas_cobrador") ?? "").trim()
        : undefined,
    });
  }

  return (
    <>
      <div className="head">
        <h1>Modificar usuario</h1>
        <span className="sheet-code">{user.ref}</span>
      </div>

      <form className="sheet collector-create" onSubmit={onSubmit}>
        <div className="sheet-body">
          <div className="sheet-fields">
            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="edit-nombre">
                Nombre
              </label>
              <input id="edit-nombre" name="nombre" required defaultValue={user.name} />
              <label className="sheet-label" htmlFor="edit-documento">
                Documento
              </label>
              <input id="edit-documento" name="documento" defaultValue={user.document ?? ""} />
            </div>

            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="edit-telefono">
                Teléfono
              </label>
              <input id="edit-telefono" name="telefono" required type="tel" defaultValue={user.phone} />
              <label className="sheet-label" htmlFor="edit-email">
                Correo
              </label>
              <input
                id="edit-email"
                name="email"
                required
                type="email"
                autoComplete="email"
                defaultValue={userEmail(user)}
              />
            </div>

            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="edit-rol">
                Acceso (rol)
              </label>
              <select
                id="edit-rol"
                name="rol"
                required
                value={roleRef}
                disabled={isAdmin}
                onChange={(event) => changeRole(event.target.value)}
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

            <label className="collector-active">
              <input type="checkbox" name="activo" defaultChecked={user.active} />
              Usuario activo
            </label>

            {isCollector && collector ? (
              <>
                <div className="sheet-row split">
                  <span className="sheet-label">Código cobrador</span>
                  <input readOnly tabIndex={-1} value={collector.ref} />
                  <span className="sheet-label">Cobertura</span>
                  <input readOnly tabIndex={-1} value="Todas las zonas · según cobros del día" />
                </div>
                <div className="sheet-row">
                  <label className="sheet-label" htmlFor="edit-notas-cobrador">
                    Notas
                  </label>
                  <textarea
                    id="edit-notas-cobrador"
                    name="notas_cobrador"
                    placeholder="Vehículo, horario, observaciones…"
                    defaultValue={collector.notes ?? ""}
                  />
                </div>
              </>
            ) : null}

            <div className="sheet-row split">
              <label className="sheet-label" htmlFor="edit-login">
                Usuario
              </label>
              <input
                id="edit-login"
                name="login"
                required
                autoComplete="username"
                defaultValue={user.login}
              />
              <label className="sheet-label" htmlFor="edit-password">
                Contraseña
              </label>
              <input
                id="edit-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Dejar en blanco para mantener la actual"
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
            Guardar cambios
          </button>
        </div>
      </form>
    </>
  );
}
