"use client";

import { rolePermissionGroups } from "@/lib/access-preview";
import type { RoleRow } from "@/lib/mock-data";

type Props = {
  role: RoleRow | null;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

export function PermissionChecklist({ role, selected, onChange, disabled }: Props) {
  const groups = rolePermissionGroups(role);
  const selectedSet = new Set(selected);

  function toggle(id: string) {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onChange(selected.filter((entry) => entry !== id));
      return;
    }
    onChange([...selected, id]);
  }

  if (!role || !groups.length) {
    return <p className="ficha-empty">Selecciona un rol para asignar permisos.</p>;
  }

  return (
    <div className="perm-checklist">
      {groups.map((group) => (
        <div className="perm-checklist-group" key={group.group}>
          <h3>{group.group}</h3>
          <ul>
            {group.items.map((entry) => {
              const checked = selectedSet.has(entry.id);
              return (
                <li key={entry.id}>
                  <label className={checked ? "on" : undefined}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(entry.id)}
                    />
                    <span className="perm-check-label">{entry.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
