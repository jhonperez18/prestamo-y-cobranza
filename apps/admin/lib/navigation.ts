export type ModuleId =
  | "inicio"
  | "clientes"
  | "prestamos"
  | "cartera"
  | "cobranza"
  | "banco"
  | "reportes";

export type IconName =
  | "home"
  | "users"
  | "file"
  | "wallet"
  | "cash"
  | "map"
  | "bike"
  | "chart"
  | "gear"
  | "folder"
  | "bank";

export type NavItem = {
  id: string;
  label: string;
  badge?: string;
  /** Reservado para una fase posterior: se muestra distintivo «próx.» en el menú. */
  soon?: boolean;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
  icon?: IconName;
};

export type AppModule = {
  id: ModuleId;
  label: string;
  icon: IconName;
  groups: NavGroup[];
};

export const MODULES: AppModule[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: "home",
    groups: [
      {
        title: "Panel",
        items: [
          { id: "resumen", label: "Resumen" },
          { id: "hoy", label: "Operación de hoy" },
          { id: "zonas", label: "Cobertura" },
          { id: "alertas", label: "Alertas" },
          { id: "vista-movil", label: "Vista móvil" },
        ],
      },
      {
        title: "Usuario",
        collapsible: true,
        items: [
          { id: "nuevo-usuario", label: "Nuevo usuario" },
          { id: "listado", label: "Listado" },
          { id: "actividad", label: "Actividad" },
          { id: "roles", label: "Roles" },
          { id: "permisos", label: "Permisos" },
        ],
      },
      {
        title: "Rutas",
        collapsible: true,
        items: [
          { id: "nueva-ruta", label: "Nueva ruta" },
          { id: "lista", label: "Lista" },
          { id: "asignar-clientes", label: "Asignar cobrador" },
        ],
      },
      {
        title: "Pagos varios",
        collapsible: true,
        icon: "cash",
        items: [
          { id: "pagos-varios-nuevo", label: "Nuevo" },
          { id: "pagos-varios-listado", label: "Listado" },
        ],
      },
      {
        title: "Control",
        collapsible: true,
        items: [
          { id: "auditoria", label: "Auditoría", soon: true },
          { id: "config", label: "Configuración" },
        ],
      },
    ],
  },
  {
    id: "clientes",
    label: "Clientes",
    icon: "users",
    groups: [
      {
        title: "Clientes",
        items: [
          { id: "nuevo", label: "Nuevo cliente" },
          { id: "listado", label: "Listado" },
          { id: "revision", label: "Pte. revisión" },
          { id: "activos", label: "Activos" },
          { id: "inactivos", label: "Cerrados" },
        ],
      },
    ],
  },
  {
    id: "prestamos",
    label: "Préstamos",
    icon: "file",
    groups: [
      {
        title: "Préstamos",
        items: [
          { id: "nuevo", label: "Nuevo préstamo" },
          { id: "listado", label: "Listado" },
          { id: "activos", label: "Activos" },
          { id: "finalizados", label: "Finalizados" },
        ],
      },
    ],
  },
  {
    id: "cartera",
    label: "Cartera",
    icon: "wallet",
    groups: [
      {
        title: "Cartera",
        items: [
          { id: "resumen", label: "Resumen" },
          { id: "mora", label: "Mora" },
          { id: "cobrador", label: "Por cobrador", soon: true },
          { id: "ruta", label: "Por ruta", soon: true },
        ],
      },
    ],
  },
  {
    id: "cobranza",
    label: "Cobranza",
    icon: "cash",
    groups: [
      {
        title: "Cobranza",
        items: [
          { id: "hoy", label: "Cobros del día" },
          { id: "pagos", label: "Pagos" },
          { id: "abonos", label: "Abonos" },
          { id: "anulaciones", label: "Anulaciones", soon: true },
        ],
      },
    ],
  },
  {
    id: "banco",
    label: "Banco",
    icon: "bank",
    groups: [
      {
        title: "Banco",
        items: [
          { id: "nueva-cuenta", label: "Nueva cuenta" },
          { id: "listado", label: "Listado" },
          { id: "registros", label: "Registros" },
        ],
      },
      {
        title: "Informe",
        collapsible: true,
        items: [
          { id: "informe-resultado", label: "Resultado del ejercicio" },
          { id: "informe-ingresos", label: "Ingresos" },
          { id: "informe-gastos", label: "Gastos" },
        ],
      },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    icon: "chart",
    groups: [
      {
        title: "Informes",
        items: [
          { id: "diarios", label: "Cobros diarios", soon: true },
          { id: "por-cobrador", label: "Por cobrador", soon: true },
          { id: "cartera", label: "Cartera", soon: true },
          { id: "mora", label: "Mora", soon: true },
        ],
      },
    ],
  },
];

export const DEFAULT_VIEW: Record<ModuleId, string> = {
  inicio: "resumen",
  clientes: "listado",
  prestamos: "listado",
  cartera: "resumen",
  cobranza: "hoy",
  banco: "listado",
  reportes: "diarios",
};

export function groupForView(moduleId: ModuleId, viewId: string) {
  const current = getModule(moduleId);
  return current.groups.find((group) => group.items.some((item) => item.id === viewId)) ?? null;
}

export function getModule(id: ModuleId) {
  return MODULES.find((entry) => entry.id === id) ?? MODULES[0];
}

export function getViewLabel(moduleId: ModuleId, viewId: string) {
  if (moduleId === "clientes" && viewId === "editar") return "Modificar cliente";
  if (moduleId === "clientes" && viewId === "ficha") return "Ficha";
  if (moduleId === "prestamos" && viewId === "editar") return "Modificar préstamo";
  if (moduleId === "prestamos" && viewId === "informe") return "Informe del préstamo";
  if (moduleId === "inicio" && viewId === "editar-usuario") return "Modificar usuario";
  if (moduleId === "inicio" && viewId === "ficha-usuario") return "Ficha";
  if (moduleId === "inicio" && viewId === "nuevo-usuario") return "Nuevo usuario";
  if (moduleId === "inicio" && viewId === "asignar-clientes") return "Asignar cobrador";
  if (moduleId === "inicio" && viewId === "zonas") return "Cobertura";
  if (moduleId === "inicio" && viewId === "nueva-ruta") return "Nueva ruta";
  if (moduleId === "inicio" && viewId === "ruta-clientes") return "Listado de ruta";
  if (moduleId === "inicio" && viewId === "editar-ruta") return "Modificar ruta";
  if (moduleId === "inicio" && viewId === "vista-movil") return "Vista móvil";
  if (moduleId === "inicio" && viewId === "perfil") return "Perfil";
  if (moduleId === "inicio" && viewId === "pagos-varios-editar") return "Modificar pago varios";
  if (moduleId === "inicio" && viewId === "pagos-varios-ficha") return "Pago varios";
  if (moduleId === "banco" && viewId === "registro-gasto") return "Registro bancario";
  if (moduleId === "cobranza" && viewId === "ficha-pago") return "Ficha de pago";
  if (moduleId === "banco" && viewId === "extracto") return "Extracto bancario";
  if (moduleId === "banco" && viewId === "extracto-pendiente") return "Registro bancario";
  if (moduleId === "banco" && viewId === "extractos") return "Extractos";
  if (moduleId === "banco" && viewId === "listado") return "Cuentas bancarias";
  if (moduleId === "banco" && viewId === "informe-resultado") return "Resultado del ejercicio";
  if (moduleId === "banco" && viewId === "informe-ingresos") return "Ingresos";
  if (moduleId === "banco" && viewId === "informe-gastos") return "Gastos";
  const current = getModule(moduleId);
  for (const group of current.groups) {
    const item = group.items.find((entry) => entry.id === viewId);
    if (item) return item.label;
  }
  return viewId;
}
