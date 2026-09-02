"use client";

import { useEffect, useState } from "react";
import { PhoneMiniIcon } from "@/components/icons";
import { Pill } from "@/components/ui";
import { PermissionChecklist } from "@/components/PermissionChecklist";
import { defaultPermissionsForRole, userAccessLabel } from "@/lib/access-preview";
import type { DeleteGuard } from "@/lib/collector-preview";
import { ROLES, type RoleRow, type UserRow } from "@/lib/mock-data";

type UserTab = "ficha" | "acceso";

type Props = {
  user: UserRow;
  role: RoleRow | null;
  tab: UserTab;
  deleteGuard: DeleteGuard;
  confirmDelete: boolean;
  onTab: (tab: UserTab) => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onConfirmDelete: (value: boolean) => void;
  onDelete: () => void;
  onConvertToCollector?: () => void;
  onSavePermissions: (permissions: string[]) => void;
};

const TABS: { id: UserTab; label: string }[] = [
  { id: "ficha", label: "Ficha" },
  { id: "acceso", label: "Acceso" },
];

export function UserFicha({
  user,
  role,
  tab,
  deleteGuard,
  confirmDelete,
  onTab,
  onEdit,
  onToggleActive,
  onConfirmDelete,
  onDelete,
  onConvertToCollector,
  onSavePermissions,
}: Props) {
  const { canDelete } = deleteGuard;
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  const tabTitle = TABS.find((entry) => entry.id === tab)?.label ?? "Ficha";

  const [permissions, setPermissions] = useState<string[]>(
    user.permissions?.length ? [...user.permissions] : defaultPermissionsForRole(role),
  );
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setPermissions(user.permissions?.length ? [...user.permissions] : defaultPermissionsForRole(role));
    setDirty(false);
  }, [user.ref, role?.ref, user.permissions?.join("|")]);

  function changePermissions(next: string[]) {
    setPermissions(next);
    setDirty(true);
  }

  return (
    <section className="panel">
      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? "tab on" : "tab"}
            onClick={() => onTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="file-title">
        <h1>{tabTitle}</h1>
        <span className="sheet-code">{user.ref}</span>
      </div>

      <div className="ficha">
        <aside className="ficha-side">
          <div className="photo">{initials}</div>
          <h2>{user.name}</h2>
          <p>{userAccessLabel(user, ROLES)}</p>
          <div className="meta">
            <div>
              <span>Teléfono</span>
              {user.phone ? (
                <span className="cell-with-ico">
                  <PhoneMiniIcon />
                  {user.phone}
                </span>
              ) : (
                "—"
              )}
            </div>
            <div>
              <span>Estado</span>
              <Pill label={user.active ? "Activo" : "Inactivo"} kind={user.active ? "ok" : "paid"} />
            </div>
            <div>
              <span>Último acceso</span>
              {user.lastAccess ?? "—"}
            </div>
          </div>
        </aside>

        <div className="ficha-main">
          {tab === "ficha" ? (
            <div className="file-toolbar">
              <div className="file-toolbar-actions">
                {confirmDelete ? (
                  <>
                    <p className="ficha-warn">¿Eliminar este usuario? Saldrá del listado.</p>
                    <button type="button" className="btn-bar" onClick={() => onConfirmDelete(false)}>
                      Cancelar
                    </button>
                    <button type="button" className="btn-bar" onClick={onDelete}>
                      Sí, eliminar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn-bar" onClick={onEdit}>
                      Modificar
                    </button>
                    {user.active ? (
                      <button type="button" className="btn-bar" onClick={onToggleActive}>
                        Desactivar
                      </button>
                    ) : (
                      <button type="button" className="btn-bar" onClick={onToggleActive}>
                        Activar
                      </button>
                    )}
                    {onConvertToCollector ? (
                      <button type="button" className="btn-bar" onClick={onConvertToCollector}>
                        Asignar cobrador
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-bar"
                      disabled={!canDelete}
                      onClick={() => canDelete && onConfirmDelete(true)}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {tab === "ficha" ? (
            <div className="meta ficha-details">
              <div>
                <span>Correo</span>
                {user.email ?? "—"}
              </div>
              <div>
                <span>Usuario de acceso</span>
                {user.login}
              </div>
              <div>
                <span>Documento</span>
                {user.document || "—"}
              </div>
              <div>
                <span>Rol</span>
                {role?.name ?? "—"}
              </div>
              <div>
                <span>Canal</span>
                {user.channels.includes("mobile") && user.channels.includes("admin")
                  ? "Panel web y app móvil"
                  : user.channels.includes("mobile")
                    ? "App móvil"
                    : "Panel web"}
              </div>
              <div>
                <span>Perfil cobrador</span>
                {user.collectorRef ?? "Sin asignar"}
              </div>
            </div>
          ) : null}

          {tab === "acceso" ? (
            <div className="access-panel">
              <div className="mini-block loan-detail-compact">
                <div className="mini-head loan-detail-head">
                  <h2>Cuenta de acceso</h2>
                  <Pill label={user.active ? "Activo" : "Inactivo"} kind={user.active ? "ok" : "paid"} />
                </div>
                <div className="table-wrap">
                  <table className="data mini-grid loan-spec-table compact quad">
                    <colgroup>
                      <col className="loan-col-label" />
                      <col className="loan-col-val" />
                      <col className="loan-col-label" />
                      <col className="loan-col-val" />
                    </colgroup>
                    <thead>
                      <tr className="col-titles">
                        <th className="loan-label-col">Concepto</th>
                        <th className="loan-val-col">Detalle</th>
                        <th className="loan-label-col">Concepto</th>
                        <th className="loan-val-col">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="loan-label-col">Código usuario</td>
                        <td className="loan-val-col ref">{user.ref}</td>
                        <td className="loan-label-col">Correo</td>
                        <td className="loan-val-col">{user.email ?? "—"}</td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Usuario de acceso</td>
                        <td className="loan-val-col">{user.login}</td>
                        <td className="loan-label-col">Rol</td>
                        <td className="loan-val-col">{role?.name ?? "—"}</td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Canal</td>
                        <td className="loan-val-col">
                          {user.channels.includes("mobile") && user.channels.includes("admin")
                            ? "Panel web y app móvil"
                            : user.channels.includes("mobile")
                              ? "App móvil"
                              : "Panel web"}
                        </td>
                        <td className="loan-label-col">Perfil cobrador</td>
                        <td className="loan-val-col">{user.collectorRef ?? "Sin asignar"}</td>
                      </tr>
                      <tr>
                        <td className="loan-label-col">Último acceso</td>
                        <td className="loan-val-col">{user.lastAccess ?? "—"}</td>
                        <td className="loan-label-col" />
                        <td className="loan-val-col" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mini-block access-perms-block">
                <div className="mini-head">
                  <h2>Permisos del usuario</h2>
                  <span className="mini-badge">{permissions.length}</span>
                </div>
                <PermissionChecklist
                  role={role}
                  selected={permissions}
                  onChange={changePermissions}
                />
                <div className="perm-checklist-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!dirty}
                    onClick={() => {
                      onSavePermissions(permissions);
                      setDirty(false);
                    }}
                  >
                    Guardar permisos
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export type { UserTab };
