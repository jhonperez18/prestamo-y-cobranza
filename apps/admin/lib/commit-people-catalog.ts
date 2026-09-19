/**
 * Commit atómico de personas (misma lógica que cobro PG-):
 * Listado → catálogo local → cola nube → proyecciones (cobrador, rutas, pagos).
 * Una sola puerta para crear / editar / borrar / activar / convertir.
 */
import { userDeleteGuard } from "@/lib/collector-preview";
import {
  DEMO_COLLECTORS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  writeDemoJson,
} from "@/lib/demo-persist";
import {
  ADMIN_ROLE_REF,
  COLLECTOR_ROLE_REF,
  COLLECTOR_UNASSIGNED_ZONE,
  DEMO_USER_PASSWORD,
  collectorViewForUser,
  ensureCollectorsForUsers,
  nextCollectorCode,
  nextUserCode,
  normalizeUserPermissions,
  roleByRef,
  ROLES,
  type ActivityRow,
  type CollectorRow,
  type PaymentRow,
  type RouteRow,
  type UserRow,
} from "@/lib/mock-data";
import {
  flushOpsMirrorQueues,
  queueCollectorDeleteMirror,
  queueCollectorMirror,
  queueCollectorsMirror,
  queueRouteMirror,
} from "@/lib/supabase/ops-mirror";
import {
  flushUsersCatalogToCloud,
  removeUserFromCatalog,
  replaceUsersCatalog,
  upsertUserInCatalog,
} from "@/lib/users-catalog";

export type PeopleUserDraft = {
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

export type PeopleUserEditDraft = {
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

export type PeopleCatalogState = {
  users: UserRow[];
  collectors: CollectorRow[];
  routes: RouteRow[];
  payments: PaymentRow[];
};

export type PeopleCommitResult =
  | { ok: false; error: string }
  | { ok: true; state: PeopleCatalogState; message: string; focusUserRef?: string };

function persistPeopleSide(state: PeopleCatalogState) {
  writeDemoJson(DEMO_COLLECTORS_KEY, state.collectors);
  writeDemoJson(DEMO_ROUTES_KEY, state.routes);
  writeDemoJson(DEMO_PAYMENTS_KEY, state.payments);
}

/** Nombre/login del cobrador + denormalizados en rutas y pagos. */
function projectCollectorIdentity(
  state: PeopleCatalogState,
  collectorRef: string,
  identity: { name: string; login: string; phone?: string; document?: string; active?: boolean },
): PeopleCatalogState {
  const collectors = state.collectors.map((row) =>
    row.ref === collectorRef
      ? {
          ...row,
          name: identity.name,
          login: identity.login,
          phone: identity.phone ?? row.phone,
          document: identity.document ?? row.document,
          active: identity.active ?? row.active,
        }
      : row,
  );
  const routes = state.routes.map((row) =>
    row.collectorRef === collectorRef ? { ...row, collector: identity.name } : row,
  );
  const payments = state.payments.map((row) =>
    row.collectorRef === collectorRef
      ? { ...row, collector: identity.name, collectorRef }
      : row,
  );
  return { ...state, collectors, routes, payments };
}

function queueProjectedRoutes(routes: RouteRow[], collectorRef: string) {
  for (const row of routes) {
    if (row.collectorRef === collectorRef) queueRouteMirror(row);
  }
}

export async function flushPeopleCatalogToCloud() {
  await flushUsersCatalogToCloud();
  await flushOpsMirrorQueues();
}

export function commitCreateUser(
  draft: PeopleUserDraft,
  state: PeopleCatalogState,
): PeopleCommitResult {
  if (!draft.name || !draft.phone || !draft.email || !draft.login) {
    return { ok: false, error: "Completa nombre, teléfono, correo y usuario." };
  }
  if (state.users.some((row) => row.login.toLowerCase() === draft.login.toLowerCase())) {
    return { ok: false, error: "Ese usuario de acceso ya está en uso." };
  }
  if (state.users.some((row) => row.email?.toLowerCase() === draft.email.toLowerCase())) {
    return { ok: false, error: "Ese correo ya está registrado." };
  }
  const role = roleByRef(draft.roleRef, ROLES);
  if (!role) return { ok: false, error: "Rol no válido." };

  const userRef = nextUserCode(state.users);
  let collectors = state.collectors;
  let collectorRef: string | undefined;

  if (draft.roleRef === COLLECTOR_ROLE_REF) {
    const cobRef = nextCollectorCode(collectors);
    collectorRef = cobRef;
    const collector: CollectorRow = {
      ref: cobRef,
      name: draft.name,
      zone: COLLECTOR_UNASSIGNED_ZONE,
      phone: draft.phone,
      document: draft.document || undefined,
      active: draft.active,
      userRef,
      login: draft.login,
      mobileAccess: true,
    };
    collectors = [...collectors, collector];
    queueCollectorMirror(collector);
  }

  const userRow = normalizeUserPermissions({
    ref: userRef,
    login: draft.login,
    email: draft.email,
    password: draft.password || DEMO_USER_PASSWORD,
    name: draft.name,
    phone: draft.phone,
    document: draft.document || undefined,
    roleRef: draft.roleRef,
    collectorRef,
    channels: [...role.channels],
    permissions: draft.permissions.length ? [...draft.permissions] : [...role.permissions],
    active: draft.active,
  });

  const users = upsertUserInCatalog(userRow);
  const next: PeopleCatalogState = {
    users,
    collectors,
    routes: state.routes,
    payments: state.payments,
  };
  persistPeopleSide(next);

  return {
    ok: true,
    state: next,
    focusUserRef: userRef,
    message: collectorRef
      ? `Usuario ${userRef} creado. Acceso móvil = cobrador ${collectorRef}.`
      : `Usuario ${userRef} (${role.name}) creado.`,
  };
}

export function commitUpdateUser(
  userRef: string,
  draft: PeopleUserEditDraft,
  state: PeopleCatalogState,
): PeopleCommitResult {
  const openUser = state.users.find((row) => row.ref === userRef);
  if (!openUser) return { ok: false, error: "Usuario no encontrado." };

  if (
    state.users.some(
      (row) => row.login.toLowerCase() === draft.login.toLowerCase() && row.ref !== userRef,
    )
  ) {
    return { ok: false, error: "Ese usuario de acceso ya está en uso." };
  }
  if (
    state.users.some(
      (row) =>
        row.email?.toLowerCase() === draft.email.toLowerCase() && row.ref !== userRef,
    )
  ) {
    return { ok: false, error: "Ese correo ya está registrado." };
  }
  const role = roleByRef(draft.roleRef, ROLES);
  if (!role) return { ok: false, error: "Rol no válido." };

  const nextUser = normalizeUserPermissions({
    ...openUser,
    name: draft.name,
    login: draft.login,
    email: draft.email,
    password: draft.password?.trim()
      ? draft.password.trim()
      : openUser.password?.trim() || DEMO_USER_PASSWORD,
    phone: draft.phone,
    document: draft.document || undefined,
    roleRef: draft.roleRef,
    active: draft.active,
    channels: [...role.channels],
    permissions: draft.permissions.length ? [...draft.permissions] : [...role.permissions],
  });

  let next: PeopleCatalogState = {
    ...state,
    users: upsertUserInCatalog(nextUser),
  };

  if (openUser.collectorRef) {
    next = projectCollectorIdentity(next, openUser.collectorRef, {
      name: draft.name,
      login: draft.login,
      phone: draft.phone,
      document: draft.document || undefined,
      active: draft.active,
    });
    const cob = next.collectors.find((row) => row.ref === openUser.collectorRef);
    if (cob) {
      const withNotes = { ...cob, notes: draft.collectorNotes || cob.notes };
      queueCollectorMirror(withNotes);
      next = {
        ...next,
        collectors: next.collectors.map((row) =>
          row.ref === cob.ref ? withNotes : row,
        ),
      };
    }
    queueProjectedRoutes(next.routes, openUser.collectorRef);
  }

  persistPeopleSide(next);
  return { ok: true, state: next, message: "Usuario actualizado.", focusUserRef: userRef };
}

export function commitToggleUserActive(
  userRef: string,
  state: PeopleCatalogState,
): PeopleCommitResult {
  const openUser = state.users.find((row) => row.ref === userRef);
  if (!openUser) return { ok: false, error: "Usuario no encontrado." };
  const nextActive = !openUser.active;
  const nextUser = normalizeUserPermissions({ ...openUser, active: nextActive });
  let next: PeopleCatalogState = {
    ...state,
    users: upsertUserInCatalog(nextUser),
  };
  if (openUser.collectorRef) {
    next = {
      ...next,
      collectors: next.collectors.map((row) =>
        row.ref === openUser.collectorRef
          ? { ...row, active: nextActive, name: nextUser.name, login: nextUser.login }
          : row,
      ),
    };
    const cob = next.collectors.find((row) => row.ref === openUser.collectorRef);
    if (cob) queueCollectorMirror(cob);
  }
  persistPeopleSide(next);
  return {
    ok: true,
    state: next,
    focusUserRef: userRef,
    message: nextActive ? "Cobrador activado." : "Cobrador desactivado.",
  };
}

export function commitDeleteUser(
  userRef: string,
  state: PeopleCatalogState,
  activities: ActivityRow[] = [],
): PeopleCommitResult {
  const openUser = state.users.find((row) => row.ref === userRef);
  if (!openUser) return { ok: false, error: "Usuario no encontrado." };
  const guard = userDeleteGuard(
    openUser,
    state.routes,
    state.payments,
    activities,
    state.collectors,
  );
  if (!guard.canDelete) {
    return { ok: false, error: guard.reason ?? "No se puede eliminar." };
  }

  const collectorRef = openUser.collectorRef;
  const users = removeUserFromCatalog(userRef);
  let collectors = state.collectors;
  let routes = state.routes;

  if (collectorRef) {
    queueCollectorDeleteMirror(collectorRef);
    collectors = collectors.filter((row) => row.ref !== collectorRef);
    routes = routes.map((route) =>
      route.collectorRef === collectorRef
        ? { ...route, collectorRef: "", collector: "—" }
        : route,
    );
    for (const row of state.routes) {
      if (row.collectorRef === collectorRef) {
        queueRouteMirror({ ...row, collectorRef: "", collector: "—" });
      }
    }
  }

  const next: PeopleCatalogState = {
    users,
    collectors,
    routes,
    payments: state.payments,
  };
  persistPeopleSide(next);
  return { ok: true, state: next, message: "Usuario eliminado del listado." };
}

export function commitConvertToCollector(
  userRef: string,
  state: PeopleCatalogState,
): PeopleCommitResult {
  const user = state.users.find((row) => row.ref === userRef);
  if (!user) return { ok: false, error: "Usuario no encontrado." };
  if (user.roleRef === ADMIN_ROLE_REF) {
    return { ok: false, error: "El administrador no se asigna como cobrador." };
  }
  if (!user.active) {
    return { ok: false, error: "Activa el usuario antes de asignarlo como cobrador." };
  }

  const existing = collectorViewForUser(user, state.collectors);
  if (existing) {
    const nextUser = normalizeUserPermissions({
      ...user,
      roleRef: COLLECTOR_ROLE_REF,
      collectorRef: existing.ref,
      channels: user.channels.includes("mobile")
        ? user.channels
        : [...user.channels, "mobile"],
    });
    const next: PeopleCatalogState = {
      ...state,
      users: upsertUserInCatalog(nextUser),
    };
    persistPeopleSide(next);
    return {
      ok: true,
      state: next,
      focusUserRef: userRef,
      message: `Cobrador ${existing.ref} vinculado a ${user.name}.`,
    };
  }

  const repaired = ensureCollectorsForUsers(
    state.users.map((row) =>
      row.ref === userRef
        ? {
            ...row,
            roleRef: COLLECTOR_ROLE_REF,
            channels: row.channels.includes("mobile")
              ? row.channels
              : [...row.channels, "mobile"],
            permissions: row.permissions?.length
              ? row.permissions
              : [...(roleByRef(COLLECTOR_ROLE_REF, ROLES)?.permissions ?? [])],
          }
        : row,
    ),
    state.collectors,
    { inventMissing: true },
  );
  const users = replaceUsersCatalog(repaired.users, { mirror: true });
  queueCollectorsMirror(repaired.collectors);
  const linked = users.find((row) => row.ref === userRef);
  const next: PeopleCatalogState = {
    users,
    collectors: repaired.collectors,
    routes: state.routes,
    payments: state.payments,
  };
  persistPeopleSide(next);
  return {
    ok: true,
    state: next,
    focusUserRef: userRef,
    message: linked?.collectorRef
      ? `${user.name} listo como cobrador ${linked.collectorRef}. Ya puede entrar al celular.`
      : `${user.name} preparado como cobrador.`,
  };
}

export function commitUserPermissions(
  userRef: string,
  permissions: string[],
  state: PeopleCatalogState,
): PeopleCommitResult {
  const current = state.users.find((row) => row.ref === userRef);
  if (!current) return { ok: false, error: "Usuario no encontrado." };
  const nextUser = normalizeUserPermissions({ ...current, permissions: [...permissions] });
  const next: PeopleCatalogState = {
    ...state,
    users: upsertUserInCatalog(nextUser),
  };
  persistPeopleSide(next);
  return {
    ok: true,
    state: next,
    focusUserRef: userRef,
    message: "Permisos actualizados según la confianza asignada.",
  };
}
