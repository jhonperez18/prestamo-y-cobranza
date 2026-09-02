import type { AppSession } from "@/lib/auth";
import {
  DEFAULT_VIEW,
  MODULES,
  type AppModule,
  type ModuleId,
} from "@/lib/navigation";

export function hasPermission(session: AppSession | null | undefined, perm: string) {
  if (!session) return false;
  return session.permissions.includes(perm);
}

export function canAccessAdminPanel(session: AppSession) {
  return session.channels.includes("admin");
}

type ViewPerm = string | string[] | null;

const VIEW_PERMISSIONS: Partial<Record<ModuleId, Record<string, ViewPerm>>> = {
  inicio: {
    resumen: null,
    alertas: "reportes.ver",
    hoy: null,
    "nuevo-usuario": "sistema.usuarios",
    listado: "sistema.usuarios",
    zonas: "sistema.usuarios",
    actividad: "sistema.usuarios",
    roles: "sistema.roles",
    permisos: "sistema.roles",
    "vista-movil": "sistema.usuarios",
    "nueva-ruta": "sistema.usuarios",
    lista: "ruta.ver",
    "asignar-clientes": "ruta.clientes",
    auditoria: "sistema.usuarios",
    config: "sistema.usuarios",
    perfil: null,
    "ficha-usuario": "sistema.usuarios",
    "editar-usuario": "sistema.usuarios",
    "editar-ruta": "ruta.ver",
    "pagos-varios-nuevo": null,
    "pagos-varios-listado": null,
    "pagos-varios-ficha": null,
    "pagos-varios-editar": null,
  },
  clientes: {
    nuevo: "clientes.crear",
    listado: "clientes.ver",
    revision: "clientes.aprobar",
    activos: "clientes.ver",
    inactivos: "clientes.ver",
    ficha: "clientes.ver",
    editar: "clientes.editar",
  },
  prestamos: {
    nuevo: "prestamos.crear",
    listado: "prestamos.ver",
    activos: "prestamos.ver",
    finalizados: "prestamos.ver",
    cuenta: "prestamos.ver",
    editar: "prestamos.editar",
    informe: "prestamos.ver",
  },
  cartera: {
    resumen: "reportes.ver",
    mora: "reportes.ver",
    cobrador: "reportes.ver",
    ruta: "reportes.ver",
  },
  cobranza: {
    hoy: "reportes.ver",
    pagos: "reportes.ver",
    abonos: "reportes.ver",
    anulaciones: "reportes.ver",
    "ficha-pago": "reportes.ver",
  },
  reportes: {
    diarios: "reportes.ver",
    "por-cobrador": "reportes.ver",
    cartera: "reportes.ver",
    mora: "reportes.ver",
  },
  banco: {
    listado: "banco.ver",
    extractos: "banco.ver",
    "nueva-cuenta": "banco.ver",
    registros: "banco.ver",
    extracto: "banco.ver",
    "extracto-pendiente": "banco.ver",
    "informe-resultado": "banco.ver",
    "informe-ingresos": "banco.ver",
    "informe-gastos": "banco.ver",
    "registro-gasto": "banco.ver",
    informe: "banco.ver",
  },
};

function matchesPermission(session: AppSession, req: ViewPerm) {
  if (req === null) return true;
  if (Array.isArray(req)) return req.some((perm) => hasPermission(session, perm));
  return hasPermission(session, req);
}

export function canAccessView(session: AppSession, moduleId: ModuleId, viewId: string) {
  const moduleRules = VIEW_PERMISSIONS[moduleId];
  if (!moduleRules) return false;
  const req = moduleRules[viewId];
  if (req === undefined) return false;
  return matchesPermission(session, req);
}

export function filterModulesForSession(session: AppSession): AppModule[] {
  return MODULES.map((module) => ({
    ...module,
    groups: module.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canAccessView(session, module.id, item.id)),
      }))
      .filter((group) => group.items.length > 0),
  })).filter((module) => module.groups.some((group) => group.items.length > 0));
}

export function defaultLandingForSession(session: AppSession): { moduleId: ModuleId; viewId: string } {
  const filtered = filterModulesForSession(session);
  const first = filtered[0];
  if (!first) return { moduleId: "inicio", viewId: "resumen" };
  const firstView = first.groups[0]?.items[0]?.id ?? DEFAULT_VIEW[first.id];
  return { moduleId: first.id, viewId: firstView };
}

export function permissionAllows(permissions: string[], perm: string) {
  return permissions.includes(perm);
}

export function canApproveFromPermissions(permissions: string[]) {
  return (
    permissionAllows(permissions, "clientes.aprobar") ||
    permissionAllows(permissions, "sistema.usuarios")
  );
}

export function canCreateClientFromPermissions(permissions: string[]) {
  return (
    permissionAllows(permissions, "clientes.crear") ||
    permissionAllows(permissions, "clientes.editar") ||
    permissionAllows(permissions, "sistema.usuarios")
  );
}
