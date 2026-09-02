export type { PaymentMethod } from "@/lib/payment-method";
export type { PaymentEvidenceRef } from "@/lib/payment-evidence";
import type { PaymentMethod } from "@/lib/payment-method";

export type StatusKind =
  | "paid"
  | "pending"
  | "partial"
  | "overdue"
  | "ok"
  | "draft"
  | "warn";

export type ClientRow = {
  ref: string;
  alta: string;
  name: string;
  lastName: string;
  document: string;
  city: string;
  barrio: string;
  route: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  photo?: string;
  lat?: number;
  lng?: number;
  total: number;
  pending: number;
  status: string;
  kind: StatusKind;
  createdBy?: string;
};

export type LoanRow = {
  ref: string;
  clientRef: string;
  client: string;
  date: string;
  due: string;
  capital: number;
  paid: number;
  balance: number;
  status: string;
  kind: StatusKind;
  notes?: string;
  rate?: number;
  frequency?: "diario" | "semanal" | "quincenal" | "mensual";
  mode?: "interes" | "cuota_fija";
  pact?: "tasa" | "valor";
  days?: number;
  interest?: number;
  total?: number;
  installment?: number;
  schedule?: { date: string; amount: number; kind?: "interes" | "capital" | "cuota"; paid?: number }[];
};

export type PaymentRow = {
  ref: string;
  loanRef?: string;
  when: string;
  paidDate?: string;
  paidTime?: string;
  dueDate?: string;
  chargeLabel?: string;
  client: string;
  collector: string;
  collectorRef?: string;
  routeRef?: string;
  idempotencyKey?: string;
  amount: number;
  type: string;
  kind: StatusKind;
  /** Efectivo en mano o transferencia Nequi. */
  method?: PaymentMethod;
  /** Comprobantes, firmas u otras evidencias (referencias ligeras). */
  evidence?: import("@/lib/payment-evidence").PaymentEvidenceRef[];
  source?: "pwa" | "caja";
  gps?: boolean;
};

export type ActivityRow = {
  ref: string;
  collectorRef: string;
  when: string;
  label: string;
  detail: string;
  kind: StatusKind;
  gps?: boolean;
};

export const CLIENTS: ClientRow[] = [
  { ref: "COD-0", alta: "27/08/2026", name: "Carlos", lastName: "Pérez", document: "80.123.456", city: "Soacha", barrio: "San Mateo", route: "Norte", email: "carlos.perez@mail.com", phone: "300 555 0182", address: "Cra 12 # 8-40", notes: "Prefiere visita en la tarde", total: 2570000, pending: 2160000, status: "Activo", kind: "ok" },
  { ref: "COD-1", alta: "27/08/2026", name: "María", lastName: "Gómez", document: "52.881.102", city: "Bosa", barrio: "El Recreo", route: "Sur", email: "mari.gomez@mail.com", phone: "310 441 2290", address: "Cl 65 sur # 18-22", notes: "", total: 994000, pending: 570000, status: "Activo", kind: "ok" },
  { ref: "COD-2", alta: "26/08/2026", name: "Pedro", lastName: "Rodríguez", document: "79.440.218", city: "Kennedy", barrio: "Castilla", route: "Centro", email: "", phone: "301 882 1044", address: "Av. 1 de Mayo # 40-10", notes: "Negocio de abarrotes", total: 800000, pending: 0, status: "Cerrado", kind: "paid" },
  { ref: "COD-3", alta: "26/08/2026", name: "Ana", lastName: "López", document: "41.902.773", city: "Suba", barrio: "Tibabuyes", route: "Norte", email: "ana.lopez@mail.com", phone: "315 220 7781", address: "Cll 147 # 91-15", notes: "", total: 610000, pending: 450000, status: "Activo", kind: "ok" },
  { ref: "COD-4", alta: "25/08/2026", name: "Julián", lastName: "Castro", document: "1.014.882.331", city: "Engativá", barrio: "Bonanza", route: "Sur", email: "julian.c@mail.com", phone: "320 109 3345", address: "Cra 90 # 75-08", notes: "No contesta en la mañana", total: 800000, pending: 800000, status: "Activo", kind: "ok" },
  { ref: "COD-5", alta: "25/08/2026", name: "Laura", lastName: "Méndez", document: "53.220.119", city: "Usaquén", barrio: "Santa Bárbara", route: "Norte", email: "", phone: "300 918 2267", address: "Cll 116 # 7-40", notes: "", total: 250000, pending: 0, status: "Cerrado", kind: "paid" },
  { ref: "COD-6", alta: "24/08/2026", name: "Andrés", lastName: "Gil", document: "80.331.904", city: "Fontibón", barrio: "Modelia", route: "Centro", email: "andres.gil@mail.com", phone: "312 667 0911", address: "Cra 22 # 22-18", notes: "Dejar aviso al portero", total: 1330000, pending: 210000, status: "Activo", kind: "ok" },
  { ref: "COD-7", alta: "24/08/2026", name: "Diana", lastName: "Ruiz", document: "1.026.441.880", city: "Chapinero", barrio: "Marly", route: "Centro", email: "diana.ruiz@mail.com", phone: "318 450 8822", address: "Cll 53 # 10-12", notes: "", total: 1400000, pending: 1400000, status: "Activo", kind: "ok" },
  { ref: "COD-8", alta: "28/08/2026", name: "Roberto", lastName: "Vargas", document: "91.220.441", city: "Kennedy", barrio: "Timiza", route: "Sur", email: "", phone: "301 555 9012", address: "Cra 78 # 38-20", notes: "Referido por cobrador", total: 0, pending: 0, status: "Pte. revisión", kind: "warn", createdBy: "Lina Soto" },
  { ref: "COD-9", alta: "28/08/2026", name: "Sandra", lastName: "Mejía", document: "52.110.902", city: "Suba", barrio: "El Prado", route: "Norte", email: "sandra.m@mail.com", phone: "320 441 2288", address: "Cll 127 # 52-10", notes: "", total: 0, pending: 0, status: "Pte. revisión", kind: "warn", createdBy: "Juan Ríos" },
];

import { normalizeLoan, type LoanTermsRow } from "@/lib/loan-preview";

const LOAN_SEEDS: LoanTermsRow[] = [
  {
    ref: "P-0",
    clientRef: "COD-0",
    client: "Carlos Pérez",
    date: "27/02/2026",
    due: "27/08/2026",
    capital: 500000,
    paid: 150000,
    balance: 2160000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "tasa",
    frequency: "diario",
    rate: 2,
    notes: "",
  },
  {
    ref: "P-1",
    clientRef: "COD-0",
    client: "Carlos Pérez",
    date: "10/08/2025",
    due: "10/02/2026",
    capital: 200000,
    paid: 0,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "tasa",
    frequency: "mensual",
    rate: 5,
    notes: "",
  },
  {
    ref: "P-2",
    clientRef: "COD-0",
    client: "Carlos Pérez",
    date: "04/03/2025",
    due: "04/09/2025",
    capital: 150000,
    paid: 0,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "tasa",
    frequency: "mensual",
    rate: 5,
    notes: "",
  },
  {
    ref: "P-3",
    clientRef: "COD-1",
    client: "María Gómez",
    date: "12/08/2026",
    due: "12/09/2026",
    capital: 450000,
    paid: 190000,
    balance: 570000,
    status: "Activo",
    kind: "pending",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 10000,
    notes: "",
  },
  {
    ref: "P-4",
    clientRef: "COD-1",
    client: "María Gómez",
    date: "22/06/2025",
    due: "22/12/2025",
    capital: 180000,
    paid: 0,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "tasa",
    frequency: "mensual",
    rate: 5,
    notes: "",
  },
  {
    ref: "P-5",
    clientRef: "COD-2",
    client: "Pedro Rodríguez",
    date: "04/01/2026",
    due: "04/07/2026",
    capital: 800000,
    paid: 0,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "tasa",
    frequency: "mensual",
    rate: 5,
    notes: "",
  },
  {
    ref: "P-6",
    clientRef: "COD-3",
    client: "Ana López",
    date: "18/08/2026",
    due: "18/09/2026",
    capital: 300000,
    paid: 160000,
    balance: 450000,
    status: "Activo",
    kind: "partial",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 10000,
    notes: "",
  },
  {
    ref: "P-7",
    clientRef: "COD-4",
    client: "Julián Castro",
    date: "08/08/2026",
    due: "07/09/2026",
    capital: 500000,
    paid: 0,
    balance: 800000,
    status: "Mora",
    kind: "overdue",
    mode: "interes",
    pact: "tasa",
    frequency: "diario",
    rate: 2,
    notes: "",
  },
  {
    ref: "P-8",
    clientRef: "COD-7",
    client: "Diana Ruiz",
    date: "27/08/2026",
    due: "26/09/2026",
    capital: 1000000,
    paid: 0,
    balance: 1400000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "tasa",
    frequency: "quincenal",
    rate: 20,
    notes: "",
  },
  {
    ref: "P-9",
    clientRef: "COD-6",
    client: "Andrés Gil",
    date: "01/08/2026",
    due: "31/08/2026",
    capital: 700000,
    paid: 0,
    status: "Mora",
    kind: "overdue",
    mode: "interes",
    pact: "tasa",
    frequency: "diario",
    rate: 3,
    notes: "",
  },
];

export type RouteStop = {
  clientRef: string;
  visitOrder: number;
  loanRef?: string;
  amountDue: number;
  visitStatus: "pendiente" | "cobrado" | "parcial" | "omitido";
  paymentRef?: string;
  lat?: number;
  lng?: number;
};

export type CollectorRow = {
  ref: string;
  name: string;
  zone: string;
  phone: string;
  document?: string;
  notes?: string;
  active: boolean;
  userRef?: string;
  login?: string;
  mobileAccess: boolean;
};

export type AccessChannel = "admin" | "mobile";

export type PermissionDef = {
  id: string;
  label: string;
  group: string;
};

export type RoleRow = {
  ref: string;
  id: string;
  name: string;
  description: string;
  channels: AccessChannel[];
  permissions: string[];
};

export type UserRow = {
  ref: string;
  /** Usuario de acceso (app móvil o panel). */
  login: string;
  /** Correo de contacto / registro en el sistema. */
  email?: string;
  /** Contraseña de demo (solo entorno local). */
  password?: string;
  name: string;
  phone: string;
  document?: string;
  roleRef: string;
  collectorRef?: string;
  channels: AccessChannel[];
  /** Permisos activos de este usuario (confianza). Subconjunto del rol. */
  permissions: string[];
  active: boolean;
  lastAccess?: string;
};

export type RouteRow = {
  ref: string;
  id: string;
  name: string;
  collectorRef: string;
  collector: string;
  zone: string;
  frequency: string;
  notes?: string;
  stops: RouteStop[];
  clients: number;
  status: string;
  kind: StatusKind;
  scheduledDate?: string;
};

export const COLLECTOR_ROLE_REF = "ROL-1";
export const ADMIN_ROLE_REF = "ROL-0";
export const COLLECTOR_UNASSIGNED_ZONE = "Sin asignar";

export const PERMISSIONS: PermissionDef[] = [
  { id: "sistema.usuarios", label: "Gestionar usuarios", group: "Sistema" },
  { id: "sistema.roles", label: "Gestionar roles", group: "Sistema" },
  { id: "clientes.ver", label: "Ver clientes", group: "Clientes" },
  { id: "clientes.crear", label: "Crear clientes", group: "Clientes" },
  { id: "clientes.aprobar", label: "Aprobar clientes", group: "Clientes" },
  { id: "clientes.editar", label: "Editar clientes", group: "Clientes" },
  { id: "prestamos.ver", label: "Ver préstamos", group: "Préstamos" },
  { id: "prestamos.crear", label: "Crear préstamos", group: "Préstamos" },
  { id: "cobros.registrar", label: "Registrar cobros en campo", group: "Cobranza móvil" },
  { id: "cobros.ver_propios", label: "Ver cobros propios", group: "Cobranza móvil" },
  { id: "ruta.ver", label: "Ver ruta asignada", group: "Cobranza móvil" },
  { id: "ruta.clientes", label: "Ver clientes de la ruta", group: "Cobranza móvil" },
  { id: "gps.enviar", label: "Enviar ubicación GPS", group: "Cobranza móvil" },
  { id: "evidencias.subir", label: "Subir evidencias de visita", group: "Cobranza móvil" },
  { id: "reportes.ver", label: "Ver reportes", group: "Reportes" },
  { id: "banco.ver", label: "Ver banco y conciliación", group: "Banco" },
];

export const ROLES: RoleRow[] = [
  {
    ref: "ROL-0",
    id: "admin",
    name: "Administrador",
    description: "Acceso total al panel. Tú defines usuarios, roles y permisos del sistema.",
    channels: ["admin"],
    permissions: PERMISSIONS.map((entry) => entry.id),
  },
  {
    ref: COLLECTOR_ROLE_REF,
    id: "cobrador",
    name: "Cobrador",
    description: "Usuario con acceso móvil. Al crearlo queda vinculado como Cobrador N (rutas, GPS, cobros).",
    channels: ["mobile"],
    permissions: [
      "clientes.ver",
      "clientes.crear",
      "cobros.registrar",
      "cobros.ver_propios",
      "ruta.ver",
      "ruta.clientes",
      "gps.enviar",
      "evidencias.subir",
    ],
  },
  {
    ref: "ROL-2",
    id: "supervisor",
    name: "Supervisor",
    description: "Usuario con acceso web y móvil para supervisar cobradores en campo.",
    channels: ["admin", "mobile"],
    permissions: [
      "clientes.ver",
      "clientes.crear",
      "clientes.aprobar",
      "clientes.editar",
      "prestamos.ver",
      "cobros.registrar",
      "cobros.ver_propios",
      "ruta.ver",
      "ruta.clientes",
      "gps.enviar",
      "evidencias.subir",
      "reportes.ver",
      "banco.ver",
    ],
  },
];

/** Roles que el administrador puede asignar al crear usuarios (por ahora). */
export const ASSIGNABLE_ROLES = ROLES.filter(
  (entry) => entry.ref === ADMIN_ROLE_REF || entry.ref === COLLECTOR_ROLE_REF,
);

export const COLLECTORS: CollectorRow[] = [
  {
    ref: "COB-0",
    name: "Juan Ríos",
    zone: COLLECTOR_UNASSIGNED_ZONE,
    phone: "310 100 2201",
    document: "80.111.001",
    active: true,
    userRef: "USR-0",
    login: "juan.rios",
    mobileAccess: true,
  },
  {
    ref: "COB-1",
    name: "Lina Soto",
    zone: COLLECTOR_UNASSIGNED_ZONE,
    phone: "311 200 3302",
    document: "52.222.002",
    active: true,
    userRef: "USR-1",
    login: "lina.soto",
    mobileAccess: true,
  },
  {
    ref: "COB-2",
    name: "Diego Mora",
    zone: COLLECTOR_UNASSIGNED_ZONE,
    phone: "312 300 4403",
    document: "79.333.003",
    active: true,
    userRef: "USR-2",
    login: "diego.mora",
    mobileAccess: true,
  },
];

const COLLECTOR_DEFAULT_PERMS =
  ROLES.find((row) => row.ref === COLLECTOR_ROLE_REF)?.permissions ?? [];
const ADMIN_DEFAULT_PERMS = ROLES.find((row) => row.ref === ADMIN_ROLE_REF)?.permissions ?? [];
const SUPERVISOR_DEFAULT_PERMS =
  ROLES.find((row) => row.ref === "ROL-2")?.permissions ?? [];
export const DEMO_USER_PASSWORD = "123";

export const USERS: UserRow[] = [
  {
    ref: "USR-0",
    login: "juan.rios",
    email: "juan.rios@nexo.com",
    password: DEMO_USER_PASSWORD,
    name: "Juan Ríos",
    phone: "310 100 2201",
    document: "80.111.001",
    roleRef: COLLECTOR_ROLE_REF,
    collectorRef: "COB-0",
    channels: ["mobile"],
    permissions: [...COLLECTOR_DEFAULT_PERMS],
    active: true,
    lastAccess: "27/08 · 10:35",
  },
  {
    ref: "USR-1",
    login: "lina.soto",
    email: "lina.soto@nexo.com",
    password: DEMO_USER_PASSWORD,
    name: "Lina Soto",
    phone: "311 200 3302",
    document: "52.222.002",
    roleRef: COLLECTOR_ROLE_REF,
    collectorRef: "COB-1",
    channels: ["mobile"],
    // Ejemplo de confianza parcial: sin crear clientes ni evidencias
    permissions: COLLECTOR_DEFAULT_PERMS.filter(
      (id) => id !== "clientes.crear" && id !== "evidencias.subir",
    ),
    active: true,
    lastAccess: "27/08 · 08:40",
  },
  {
    ref: "USR-2",
    login: "diego.mora",
    email: "diego.mora@nexo.com",
    password: DEMO_USER_PASSWORD,
    name: "Diego Mora",
    phone: "312 300 4403",
    document: "79.333.003",
    roleRef: COLLECTOR_ROLE_REF,
    collectorRef: "COB-2",
    channels: ["mobile"],
    permissions: [...COLLECTOR_DEFAULT_PERMS],
    active: true,
    lastAccess: "27/08 · 07:50",
  },
  {
    ref: "USR-3",
    login: "truqui",
    email: "truqui@nexo.com",
    password: DEMO_USER_PASSWORD,
    name: "Truqui",
    phone: "300 000 0000",
    roleRef: "ROL-0",
    channels: ["admin"],
    permissions: [...ADMIN_DEFAULT_PERMS],
    active: true,
    lastAccess: "27/08 · 09:00",
  },
  {
    ref: "USR-4",
    login: "supervisor",
    email: "supervisor@nexo.com",
    password: DEMO_USER_PASSWORD,
    name: "Ana Supervisor",
    phone: "315 400 5504",
    document: "51.444.004",
    roleRef: "ROL-2",
    channels: ["admin", "mobile"],
    permissions: [...SUPERVISOR_DEFAULT_PERMS],
    active: true,
    lastAccess: "27/08 · 11:10",
  },
];

export const ROUTES: RouteRow[] = [
  {
    ref: "RUT-0",
    id: "norte",
    name: "Norte",
    collectorRef: "",
    collector: "—",
    zone: "Norte",
    frequency: "Lun–Sáb",
    clients: 3,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-1",
    id: "sur",
    name: "Sur",
    collectorRef: "",
    collector: "—",
    zone: "Sur",
    frequency: "Lun–Sáb",
    clients: 2,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-2",
    id: "centro",
    name: "Centro",
    collectorRef: "",
    collector: "—",
    zone: "Centro",
    frequency: "Lun–Vie",
    clients: 3,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-3",
    id: "oriente",
    name: "Oriente",
    collectorRef: "",
    collector: "—",
    zone: "Oriente",
    frequency: "Lun–Sáb",
    clients: 0,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-4",
    id: "occidente",
    name: "Occidente",
    collectorRef: "",
    collector: "—",
    zone: "Occidente",
    frequency: "Lun–Sáb",
    clients: 0,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-5",
    id: "playa",
    name: "Playa",
    collectorRef: "",
    collector: "—",
    zone: "Playa",
    frequency: "Lun–Sáb",
    clients: 0,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
];

export function nextRouteCode(rows: RouteRow[] = ROUTES) {
  return `RUT-${rows.length}`;
}

export function nextCollectorCode(rows: CollectorRow[] = COLLECTORS) {
  return `COB-${rows.length}`;
}

export function nextUserCode(rows: UserRow[] = USERS) {
  return `USR-${rows.length}`;
}

export function roleByRef(ref: string, rows: RoleRow[] = ROLES) {
  return rows.find((row) => row.ref === ref) ?? null;
}

export function userForCollector(collectorRef: string, rows: UserRow[] = USERS) {
  return rows.find((row) => row.collectorRef === collectorRef) ?? null;
}

/** Completa permisos faltantes (p. ej. datos viejos en localStorage). */
export function normalizeUserPermissions(user: UserRow, roles: RoleRow[] = ROLES): UserRow {
  const role = roleByRef(user.roleRef, roles);
  if (!role) return user;
  const permissions = [...new Set([...role.permissions, ...(user.permissions ?? [])])];
  return { ...user, permissions };
}

export function collectorLoginSlug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

export function suggestedUserEmail(name: string) {
  const slug = collectorLoginSlug(name);
  return slug ? `${slug}@nexo.com` : "";
}

export function suggestedAccessLogin(name: string) {
  return collectorLoginSlug(name);
}

/** @deprecated use suggestedAccessLogin for usuario y suggestedUserEmail para correo */
export function suggestedCollectorLogin(name: string) {
  return suggestedUserEmail(name);
}

export function routesForCollector(collectorRef: string, rows: RouteRow[] = ROUTES) {
  return rows.filter((row) => row.collectorRef === collectorRef);
}

export function paymentsForCollector(
  collectorRef: string,
  collectors: CollectorRow[] = COLLECTORS,
  rows: PaymentRow[] = PAYMENTS,
) {
  const collector = collectors.find((row) => row.ref === collectorRef);
  return rows.filter(
    (row) => row.collectorRef === collectorRef || (collector && row.collector === collector.name),
  );
}

export function collectedByCollectorRef(
  collectorRef: string,
  collectors: CollectorRow[] = COLLECTORS,
  rows: PaymentRow[] = PAYMENTS,
) {
  return paymentsForCollector(collectorRef, collectors, rows).reduce((sum, row) => sum + row.amount, 0);
}

/** @deprecated Prefer collectedByCollectorRef */
export function collectedByCollector(name: string, rows: PaymentRow[] = PAYMENTS) {
  return rows.filter((row) => row.collector === name).reduce((sum, row) => sum + row.amount, 0);
}

export function collectorFieldStatus(collector: CollectorRow, routes: RouteRow[] = ROUTES) {
  if (!collector.active) return { label: "Inactivo", kind: "paid" as StatusKind };
  const assigned = routesForCollector(collector.ref, routes);
  const route = assigned[0];
  if (!route) return { label: "Disponible", kind: "partial" as StatusKind };
  if (route.status === "Cerrada") return { label: "Cerrada", kind: "paid" as StatusKind };
  return { label: "En campo", kind: "ok" as StatusKind };
}

export const ZONES = ["Norte", "Sur", "Centro", "Oriente", "Occidente", "Playa"] as const;

export function catalogRoutes(rows: RouteRow[] = ROUTES) {
  return rows.filter((row) => !row.ref.startsWith("RUT-D-"));
}

export function routeIsActive(row: RouteRow) {
  return row.status !== "Inactiva";
}

export function routeStatusMeta(active: boolean): Pick<RouteRow, "status" | "kind"> {
  return active ? { status: "Activa", kind: "ok" } : { status: "Inactiva", kind: "draft" };
}

export function routeSlug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function clientsOnRoute(routeName: string, rows: ClientRow[] = CLIENTS) {
  return rows.filter((row) => row.route === routeName);
}

export function nextClientCode(count = CLIENTS.length) {
  return `COD-${count}`;
}

/** Fecha de alta del cliente (DD/MM/AAAA), asignada por el sistema al crear. */
export function clientCreationDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function nextLoanCode(rows: LoanRow[] = LOANS) {
  return `P-${rows.length}`;
}

function whenLabel(isoDate: string, time: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year} · ${time}`;
}

/** Cuotas de interés diario P-0 (12–25 ago) — suman $140.000 junto con PG-9182 = $150.000 */
function p0PaymentHistory(): PaymentRow[] {
  return Array.from({ length: 14 }, (_, i) => {
    const dueDay = 12 + i;
    const dueDate = `2026-08-${String(dueDay).padStart(2, "0")}`;
    const paidNextDay = i === 3 || i === 10;
    const paidDay = paidNextDay ? dueDay + 1 : dueDay;
    const paidDate = `2026-08-${String(paidDay).padStart(2, "0")}`;
    const hour = 8 + (i % 4);
    const minute = String((i * 11) % 60).padStart(2, "0");
    const paidTime = `${String(hour).padStart(2, "0")}:${minute}`;
    const fromPwa = i !== 3 && i !== 10;
    const method = i % 3 === 0 ? ("nequi" as const) : ("efectivo" as const);
    return {
      ref: `PG-${9153 + i}`,
      loanRef: "P-0",
      when: whenLabel(paidDate, paidTime),
      paidDate,
      paidTime,
      dueDate,
      chargeLabel: "Interés",
      client: "Carlos Pérez",
      collector: fromPwa ? "Juan Ríos" : "Administrador",
      collectorRef: fromPwa ? "COB-0" : undefined,
      routeRef: fromPwa ? `RUT-D-COB-0-${paidDate}` : undefined,
      amount: 10000,
      type: "Cuota",
      kind: "paid" as const,
      method,
      source: fromPwa ? ("pwa" as const) : ("caja" as const),
      gps: fromPwa,
    };
  });
}

export const PAYMENTS: PaymentRow[] = [
  {
    ref: "PG-9182",
    loanRef: "P-0",
    when: "27/08/2026 · 10:35",
    paidDate: "2026-08-27",
    paidTime: "10:35",
    dueDate: "2026-08-26",
    chargeLabel: "Interés",
    client: "Carlos Pérez",
    collector: "Juan Ríos",
    collectorRef: "COB-0",
    routeRef: "RUT-D-COB-0-2026-08-27",
    amount: 10000,
    type: "Cuota",
    kind: "paid",
    method: "efectivo",
    source: "pwa",
    gps: true,
  },
  ...p0PaymentHistory(),
  {
    ref: "PG-9181",
    loanRef: "P-6",
    when: "27/08/2026 · 09:12",
    paidDate: "2026-08-27",
    paidTime: "09:12",
    dueDate: "2026-08-26",
    chargeLabel: "Cuota",
    client: "Ana López",
    collector: "Juan Ríos",
    collectorRef: "COB-0",
    routeRef: "RUT-D-COB-0-2026-08-27",
    amount: 5000,
    type: "Abono",
    kind: "partial",
    method: "nequi",
    source: "pwa",
    gps: true,
    evidence: [
      {
        id: "EV-PG9181",
        kind: "comprobante",
        fileId: "payments/PG-9181/evidence/EV-PG9181",
        mime: "image/jpeg",
        byteSize: 86400,
        capturedAt: "2026-08-27T09:12:00.000Z",
      },
    ],
  },
  {
    ref: "PG-9180",
    loanRef: "P-3",
    when: "27/08/2026 · 08:40",
    paidDate: "2026-08-27",
    paidTime: "08:40",
    dueDate: "2026-08-27",
    chargeLabel: "Cuota",
    client: "María Gómez",
    collector: "Lina Soto",
    collectorRef: "COB-1",
    amount: 10000,
    type: "Cuota",
    kind: "paid",
    method: "nequi",
    source: "pwa",
    gps: true,
  },
  {
    ref: "PG-9179",
    loanRef: "P-9",
    when: "26/08/2026 · 16:02",
    paidDate: "2026-08-26",
    paidTime: "16:02",
    dueDate: "2026-08-26",
    chargeLabel: "Interés",
    client: "Andrés Gil",
    collector: "Lina Soto",
    collectorRef: "COB-1",
    amount: 21000,
    type: "Cuota",
    kind: "paid",
    method: "efectivo",
    source: "pwa",
    gps: true,
  },
];

export const LOANS: LoanRow[] = LOAN_SEEDS.map((loan) => normalizeLoan(loan, PAYMENTS) as LoanRow);

export const ACTIVITY: ActivityRow[] = [
  { ref: "ACT-0", collectorRef: "COB-0", when: "27/08 · 08:05", label: "Ruta iniciada", detail: "Norte · 3 clientes en visita", kind: "ok", gps: true },
  { ref: "ACT-1", collectorRef: "COB-1", when: "27/08 · 08:12", label: "Ruta iniciada", detail: "Sur · 2 clientes en visita", kind: "ok", gps: true },
  { ref: "ACT-2", collectorRef: "COB-2", when: "27/08 · 07:50", label: "Ruta cerrada", detail: "Centro · jornada finalizada", kind: "paid", gps: true },
  { ref: "ACT-3", collectorRef: "COB-0", when: "26/08 · 17:20", label: "Check-in GPS", detail: "Suba · visita programada", kind: "partial", gps: true },
];

export function nextPaymentCode(rows: PaymentRow[] = PAYMENTS) {
  const nums = rows.map((row) => Number(row.ref.replace(/\D/g, ""))).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 9000) + 1;
  return `PG-${next}`;
}

export function money(value: number) {
  const digits = Math.trunc(Math.abs(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$ ${grouped}`;
}

export function loansForClient(clientRef: string, rows: LoanRow[] = LOANS): LoanRow[] {
  return rows.filter((row) => row.clientRef === clientRef);
}

export function activeLoans(rows: LoanRow[]): LoanRow[] {
  return rows.filter((row) => row.status !== "Finalizado");
}

export function clientsForView(view: string, rows: ClientRow[] = CLIENTS): ClientRow[] {
  if (view === "revision") return rows.filter((row) => row.status === "Pte. revisión");
  if (view === "activos") return rows.filter((row) => row.status === "Activo");
  if (view === "inactivos") return rows.filter((row) => row.status === "Cerrado");
  if (view === "listado") {
    return rows.filter((row) => row.status !== "Pte. revisión");
  }
  return rows;
}
