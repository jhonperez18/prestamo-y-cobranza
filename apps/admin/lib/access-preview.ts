import {
  PERMISSIONS,
  roleByRef,
  type PermissionDef,
  type RoleRow,
  type UserRow,
} from "@/lib/mock-data";

export function permissionLabel(id: string, defs: PermissionDef[] = PERMISSIONS) {
  return defs.find((entry) => entry.id === id)?.label ?? id;
}

export function permissionsByGroup(defs: PermissionDef[] = PERMISSIONS) {
  const groups = new Map<string, PermissionDef[]>();
  for (const entry of defs) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

export function rolePermissions(role: RoleRow | null) {
  if (!role) return [];
  return role.permissions.map((id) => ({
    id,
    label: permissionLabel(id),
  }));
}

/** Permisos activos del usuario (confianza). Si no hay lista, usa los del rol. */
export function userPermissions(user: UserRow | null | undefined, role: RoleRow | null) {
  if (user?.permissions?.length) {
    return user.permissions.map((id) => ({
      id,
      label: permissionLabel(id),
    }));
  }
  return rolePermissions(role);
}

export function defaultPermissionsForRole(role: RoleRow | null) {
  return role ? [...role.permissions] : [];
}

/** Catálogo editable: permisos del rol (techo) agrupados. */
export function rolePermissionGroups(role: RoleRow | null) {
  if (!role) return [];
  const allowed = new Set(role.permissions);
  return permissionsByGroup().map((group) => ({
    group: group.group,
    items: group.items.filter((entry) => allowed.has(entry.id)),
  })).filter((group) => group.items.length > 0);
}

export function usersForView(viewId: string, rows: UserRow[]) {
  if (viewId === "activos") return rows.filter((row) => row.active);
  if (viewId === "inactivos") return rows.filter((row) => !row.active);
  if (viewId === "movil") return rows.filter((row) => row.channels.includes("mobile"));
  if (viewId === "admin") return rows.filter((row) => row.channels.includes("admin"));
  return rows;
}

export function userAccessLabel(user: UserRow, roles: RoleRow[]) {
  const role = roleByRef(user.roleRef, roles);
  const channels = user.channels.includes("mobile") ? "App móvil" : "Panel web";
  return role ? `${role.name} · ${channels}` : channels;
}

export function mobileAccessLabel(collector: { mobileAccess: boolean; login?: string; active: boolean }) {
  if (!collector.mobileAccess || !collector.login) return "Sin acceso";
  if (!collector.active) return "Suspendido";
  return collector.login;
}
