"use client";

import { Pill } from "@/components/ui";
import { permissionsByGroup, rolePermissions } from "@/lib/access-preview";
import { ROLES, type RoleRow } from "@/lib/mock-data";

type Props = {
  roles?: RoleRow[];
};

export function RolePanel({ roles = ROLES }: Props) {
  return (
    <section className="panel">
      <div className="head">
        <h1>Roles</h1>
        <span className="count">{roles.length}</span>
      </div>
      <div className="role-cards">
        {roles.map((role) => (
          <article className="role-card" key={role.ref}>
            <header>
              <h2>{role.name}</h2>
              <div className="role-channels">
                {role.channels.map((channel) => (
                  <Pill
                    key={channel}
                    label={channel === "mobile" ? "App móvil" : "Panel web"}
                    kind={channel === "mobile" ? "ok" : "partial"}
                  />
                ))}
              </div>
            </header>
            <ul className="role-perms">
              {rolePermissions(role).map((entry) => (
                <li key={entry.id}>{entry.label}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PermissionsPanel() {
  const groups = permissionsByGroup();

  return (
    <section className="panel">
      <div className="head">
        <h1>Permisos</h1>
        <span className="count">{groups.reduce((sum, group) => sum + group.items.length, 0)}</span>
      </div>
      <div className="perm-groups">
        {groups.map((group) => (
          <article className="perm-group" key={group.group}>
            <h2>{group.group}</h2>
            <ul>
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <code>{entry.id}</code>
                  <span>{entry.label}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
