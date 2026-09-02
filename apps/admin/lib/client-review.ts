import { roleByRef, type ClientRow, type RoleRow, type UserRow } from "@/lib/mock-data";

export const CLIENT_STATUS_REVIEW = "Pte. revisión";
export const CLIENT_STATUS_ACTIVE = "Activo";
export const CLIENT_STATUS_CLOSED = "Cerrado";

const LEGACY_ACTIVE_STATUSES = new Set([
  "Pagada",
  "Pte. pago",
  "Pago parcial",
  "Vencida",
  "Inactivo",
]);

export function clientStatusKind(status: string): ClientRow["kind"] {
  if (status === CLIENT_STATUS_REVIEW) return "warn";
  if (status === CLIENT_STATUS_CLOSED) return "paid";
  return "ok";
}

export function normalizeClientLifecycle(client: ClientRow): ClientRow {
  if (client.status === "Prospecto") {
    return { ...client, status: CLIENT_STATUS_REVIEW, kind: clientStatusKind(CLIENT_STATUS_REVIEW) };
  }
  if (client.status === CLIENT_STATUS_REVIEW) {
    return { ...client, kind: clientStatusKind(client.status) };
  }
  if (client.status === CLIENT_STATUS_CLOSED) {
    return { ...client, status: CLIENT_STATUS_CLOSED, kind: "paid" };
  }
  if (client.status === CLIENT_STATUS_ACTIVE) {
    return { ...client, status: CLIENT_STATUS_ACTIVE, kind: "ok" };
  }
  if (LEGACY_ACTIVE_STATUSES.has(client.status)) {
    const closed = client.status === "Inactivo";
    return {
      ...client,
      status: closed ? CLIENT_STATUS_CLOSED : CLIENT_STATUS_ACTIVE,
      kind: closed ? "paid" : "ok",
    };
  }
  return { ...client, status: CLIENT_STATUS_ACTIVE, kind: "ok" };
}

export const PERM_CLIENTS_CREATE = "clientes.crear";
export const PERM_CLIENTS_APPROVE = "clientes.aprobar";

export function canCreateClient(role: RoleRow | null | undefined) {
  if (!role) return false;
  return (
    role.permissions.includes(PERM_CLIENTS_CREATE) ||
    role.permissions.includes("clientes.editar") ||
    role.permissions.includes("sistema.usuarios")
  );
}

export function canApproveClients(role: RoleRow | null | undefined) {
  if (!role) return false;
  return role.permissions.includes(PERM_CLIENTS_APPROVE) || role.permissions.includes("sistema.usuarios");
}

export function isPendingReview(client: ClientRow) {
  return client.status === CLIENT_STATUS_REVIEW;
}

export function pendingReviewClients(rows: ClientRow[]) {
  return rows.filter(isPendingReview);
}

export function clientsForView(view: string, rows: ClientRow[]): ClientRow[] {
  if (view === "revision") return pendingReviewClients(rows);
  if (view === "activos") {
    return rows.filter((row) => row.status === CLIENT_STATUS_ACTIVE);
  }
  if (view === "inactivos") {
    return rows.filter((row) => row.status === CLIENT_STATUS_CLOSED);
  }
  if (view === "listado") {
    return rows.filter((row) => !isPendingReview(row));
  }
  return rows;
}

export function clientNavBadges(clients: ClientRow[]) {
  const pending = pendingReviewClients(clients).length;
  return {
    "clientes:revision": pending > 0 ? String(pending) : undefined,
  };
}

export function newClientReviewState(role: RoleRow | null | undefined) {
  if (canApproveClients(role)) {
    return { status: CLIENT_STATUS_ACTIVE, kind: clientStatusKind(CLIENT_STATUS_ACTIVE) };
  }
  return { status: CLIENT_STATUS_REVIEW, kind: clientStatusKind(CLIENT_STATUS_REVIEW) };
}

export const DEMO_SESSION_USER_REF = "USR-0";

export function sessionRole(user: UserRow | null | undefined, roles: RoleRow[] = []) {
  if (!user) return null;
  return roleByRef(user.roleRef, roles);
}
