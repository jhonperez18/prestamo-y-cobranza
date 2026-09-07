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
  | "warn"
  | "closed"
  | "efectivo"
  | "nequi";

export type ClientRow = {
  ref: string;
  alta: string;
  name: string;
  lastName: string;
  /** Apodo / alias (opcional). */
  nickname?: string;
  document: string;
  city: string;
  barrio: string;
  route: string;
  /** Posición consecutiva dentro de la ruta (1…N). */
  routeOrder: number;
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
  /** Cliente de calle sin préstamo: aparece en planilla solo para Prestar. */
  awaitingLoan?: boolean;
  /**
   * Alta incompleta (calle): opera normal, pero alerta en oficina para completar ficha.
   * No bloquea cobros ni préstamos.
   */
  profilePending?: boolean;
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
  /**
   * Faltas consecutivas sin pago al cerrar jornada.
   * 1–4 = alerta; al llegar a 5 = mora.
   */
  collectionAlerts?: number;
  /**
   * Préstamo rápido / incompleto: opera normal, alerta en oficina para revisar o completar.
   */
  termsPending?: boolean;
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

export const CLIENT_SEEDS: Omit<ClientRow, "routeOrder">[] = [
  { ref: "COD-0", alta: "27/08/2026", name: "Carlos", lastName: "Pérez", nickname: "Carlitos", document: "80.123.456", city: "Soacha", barrio: "San Mateo", route: "1", email: "carlos.perez@mail.com", phone: "300 555 0182", address: "Cra 12 # 8-40", notes: "Prefiere visita en la tarde", total: 0, pending: 0, status: "Activo", kind: "ok" },
  { ref: "COD-1", alta: "27/08/2026", name: "María", lastName: "Gómez", document: "52.881.102", city: "Bosa", barrio: "El Recreo", route: "2", email: "mari.gomez@mail.com", phone: "310 441 2290", address: "Cl 65 sur # 18-22", notes: "", total: 0, pending: 0, status: "Activo", kind: "ok" },
  { ref: "COD-2", alta: "26/08/2026", name: "Pedro", lastName: "Rodríguez", document: "79.440.218", city: "Kennedy", barrio: "Castilla", route: "3", email: "", phone: "301 882 1044", address: "Av. 1 de Mayo # 40-10", notes: "Negocio de abarrotes", total: 0, pending: 0, status: "Cerrado", kind: "paid" },
  { ref: "COD-3", alta: "26/08/2026", name: "Ana", lastName: "López", document: "41.902.773", city: "Suba", barrio: "Tibabuyes", route: "1", email: "ana.lopez@mail.com", phone: "315 220 7781", address: "Cll 147 # 91-15", notes: "", total: 0, pending: 0, status: "Activo", kind: "ok" },
  { ref: "COD-4", alta: "25/08/2026", name: "Julián", lastName: "Castro", document: "1.014.882.331", city: "Engativá", barrio: "Bonanza", route: "2", email: "julian.c@mail.com", phone: "320 109 3345", address: "Cra 90 # 75-08", notes: "No contesta en la mañana", total: 0, pending: 0, status: "Activo", kind: "ok" },
  { ref: "COD-5", alta: "25/08/2026", name: "Laura", lastName: "Méndez", document: "53.220.119", city: "Usaquén", barrio: "Santa Bárbara", route: "1", email: "", phone: "300 918 2267", address: "Cll 116 # 7-40", notes: "", total: 0, pending: 0, status: "Cerrado", kind: "paid" },
  { ref: "COD-6", alta: "24/08/2026", name: "Andrés", lastName: "Gil", document: "80.331.904", city: "Fontibón", barrio: "Modelia", route: "3", email: "andres.gil@mail.com", phone: "312 667 0911", address: "Cra 22 # 22-18", notes: "Dejar aviso al portero", total: 0, pending: 0, status: "Activo", kind: "ok" },
  { ref: "COD-7", alta: "24/08/2026", name: "Diana", lastName: "Ruiz", document: "1.026.441.880", city: "Chapinero", barrio: "Marly", route: "3", email: "diana.ruiz@mail.com", phone: "318 450 8822", address: "Cll 53 # 10-12", notes: "", total: 0, pending: 0, status: "Activo", kind: "ok" },
  { ref: "COD-8", alta: "28/08/2026", name: "Roberto", lastName: "Vargas", document: "91.220.441", city: "Kennedy", barrio: "Timiza", route: "", email: "", phone: "301 555 9012", address: "Cra 78 # 38-20", notes: "Referido por cobrador", total: 0, pending: 0, status: "Pte. revisión", kind: "warn", createdBy: "Lina Soto" },
  { ref: "COD-9", alta: "28/08/2026", name: "Sandra", lastName: "Mejía", document: "52.110.902", city: "Suba", barrio: "El Prado", route: "", email: "sandra.m@mail.com", phone: "320 441 2288", address: "Cll 127 # 52-10", notes: "", total: 0, pending: 0, status: "Pte. revisión", kind: "warn", createdBy: "Juan Ríos" },
];

function withSeedRouteOrders(rows: Omit<ClientRow, "routeOrder">[]): ClientRow[] {
  const counters = new Map<string, number>();
  return rows.map((row) => {
    if (row.status === "Pte. revisión" || !row.route) {
      return { ...row, route: row.status === "Pte. revisión" ? "" : row.route, routeOrder: 0 };
    }
    const next = (counters.get(row.route) ?? 0) + 1;
    counters.set(row.route, next);
    return { ...row, routeOrder: next };
  });
}

export const CLIENTS: ClientRow[] = withSeedRouteOrders(CLIENT_SEEDS);


import { normalizeLoan, type LoanTermsRow } from "@/lib/loan-preview";

/** Semilla mínima de cartera activa para que Lun–sáb siempre haya cobro del día. */
const LOAN_SEEDS: LoanTermsRow[] = [
  {
    ref: "P-0",
    clientRef: "COD-0",
    client: "Carlos Pérez",
    date: "01/09/2026",
    due: "01/10/2026",
    capital: 500000,
    paid: 50000,
    balance: 550000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 10000,
    notes: "",
  },
  {
    ref: "P-1",
    clientRef: "COD-3",
    client: "Ana López",
    date: "01/09/2026",
    due: "01/10/2026",
    capital: 300000,
    paid: 30000,
    balance: 330000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 8000,
    notes: "",
  },
  {
    ref: "P-2",
    clientRef: "COD-1",
    client: "María Gómez",
    date: "01/09/2026",
    due: "01/10/2026",
    capital: 450000,
    paid: 45000,
    balance: 495000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 10000,
    notes: "",
  },
  {
    ref: "P-3",
    clientRef: "COD-4",
    client: "Julián Castro",
    date: "01/09/2026",
    due: "01/10/2026",
    capital: 200000,
    paid: 20000,
    balance: 220000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 7000,
    notes: "",
  },
  {
    ref: "P-4",
    clientRef: "COD-6",
    client: "Andrés Gil",
    date: "01/09/2026",
    due: "01/10/2026",
    capital: 350000,
    paid: 35000,
    balance: 385000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 9000,
    notes: "",
  },
  {
    ref: "P-5",
    clientRef: "COD-7",
    client: "Diana Ruiz",
    date: "01/09/2026",
    due: "01/10/2026",
    capital: 250000,
    paid: 25000,
    balance: 275000,
    status: "Activo",
    kind: "ok",
    mode: "interes",
    pact: "valor",
    frequency: "diario",
    installment: 8000,
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
  { id: "prestamos.editar", label: "Editar préstamos", group: "Préstamos" },
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
      "prestamos.crear",
      "prestamos.editar",
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
export const SUPERVISOR_ROLE_REF = "ROL-2";
export const ASSIGNABLE_ROLES = ROLES.filter(
  (entry) =>
    entry.ref === ADMIN_ROLE_REF ||
    entry.ref === COLLECTOR_ROLE_REF ||
    entry.ref === SUPERVISOR_ROLE_REF,
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
    name: "Carlos",
    phone: "315 400 5504",
    document: "51.444.004",
    roleRef: "ROL-2",
    // Solo app móvil (nunca panel admin).
    channels: ["mobile"],
    permissions: [...SUPERVISOR_DEFAULT_PERMS],
    active: true,
    lastAccess: "27/08 · 11:10",
  },
];

export const ROUTES: RouteRow[] = [
  {
    ref: "RUT-1",
    id: "1",
    name: "1",
    collectorRef: "COB-0",
    collector: "Juan Ríos",
    zone: "",
    frequency: "Lun–Sáb",
    clients: 4,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-2",
    id: "2",
    name: "2",
    collectorRef: "COB-1",
    collector: "Lina Soto",
    zone: "",
    frequency: "Lun–Sáb",
    clients: 3,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
  {
    ref: "RUT-3",
    id: "3",
    name: "3",
    collectorRef: "COB-2",
    collector: "Diego Mora",
    zone: "",
    frequency: "Lun–Sáb",
    clients: 3,
    status: "Activa",
    kind: "ok",
    stops: [],
  },
];


export function nextRouteCode(rows: RouteRow[] = ROUTES) {
  const nums = rows
    .map((row) => Number(row.ref.replace(/^RUT-/i, "")))
    .filter((value) => Number.isFinite(value));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `RUT-${next}`;
}

/** Nombre de ruta = solo dígitos ("1", "2"). */
export function normalizeRouteNumber(input: string) {
  return String(input ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** Siguiente número libre entre rutas de catálogo. */
export function nextRouteNumber(rows: RouteRow[] = ROUTES) {
  const used = new Set(
    rows
      .map((row) => Number(normalizeRouteNumber(row.name) || row.ref.replace(/\D/g, "")))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return String(n);
}

export function nextCollectorCode(rows: CollectorRow[] = COLLECTORS) {
  const nums = rows
    .map((row) => Number(String(row.ref).replace(/^COB-/i, "")))
    .filter((value) => Number.isFinite(value));
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return `COB-${next}`;
}

export function nextUserCode(rows: UserRow[] = USERS) {
  const nums = rows
    .map((row) => Number(String(row.ref).replace(/^USR-/i, "")))
    .filter((value) => Number.isFinite(value));
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return `USR-${next}`;
}

export function roleByRef(ref: string, rows: RoleRow[] = ROLES) {
  return rows.find((row) => row.ref === ref) ?? null;
}

export function userForCollector(collectorRef: string, rows: UserRow[] = USERS) {
  return rows.find((row) => row.collectorRef === collectorRef) ?? null;
}

/**
 * Cobrador de un usuario sin cruzar con otro.
 * Prioridad: collector.userRef === user.ref → user.collectorRef si ese cobrador
 * no pertenece a otra persona.
 */
export function collectorForUser(
  user: UserRow,
  collectors: CollectorRow[],
): CollectorRow | null {
  const byUserRef = collectors.find((row) => row.userRef === user.ref) ?? null;
  if (byUserRef) return byUserRef;

  if (!user.collectorRef) return null;
  const byCollectorRef = collectors.find((row) => row.ref === user.collectorRef) ?? null;
  if (!byCollectorRef) return null;
  // Si esa fila ya está atada a otro usuario, no usarla (evita ficha de Lina al abrir Diego).
  if (byCollectorRef.userRef && byCollectorRef.userRef !== user.ref) return null;
  return byCollectorRef;
}

/** Vista de cobrador alineada a la identidad del usuario (nombre/login), sin datos ajenos. */
export function collectorViewForUser(
  user: UserRow,
  collectors: CollectorRow[],
): CollectorRow | null {
  const base = collectorForUser(user, collectors);
  if (!base) return null;
  return {
    ...base,
    userRef: user.ref,
    name: user.name,
    phone: user.phone || base.phone,
    document: user.document || base.document,
    login: user.login || base.login,
    active: user.active,
    mobileAccess: user.channels?.includes("mobile") ?? base.mobileAccess,
  };
}

/** Alinea user.collectorRef ↔ collector.userRef (1:1). El usuario manda. */
export function alignUserCollectorLinks(
  users: UserRow[],
  collectors: CollectorRow[],
): { users: UserRow[]; collectors: CollectorRow[] } {
  const claimedCollector = new Set<string>();
  const nextUsers: UserRow[] = users.map((user) => {
    if (!user.collectorRef) return user;
    const owned = collectors.find(
      (row) => row.ref === user.collectorRef && (!row.userRef || row.userRef === user.ref),
    );
    const byUserRef = collectors.find((row) => row.userRef === user.ref);
    const target = byUserRef ?? owned ?? null;
    if (!target) {
      return { ...user, collectorRef: undefined };
    }
    if (claimedCollector.has(target.ref)) {
      return { ...user, collectorRef: undefined };
    }
    claimedCollector.add(target.ref);
    return { ...user, collectorRef: target.ref };
  });

  const userByCollectorRef = new Map<string, UserRow>();
  for (const user of nextUsers) {
    if (user.collectorRef && !userByCollectorRef.has(user.collectorRef)) {
      userByCollectorRef.set(user.collectorRef, user);
    }
  }

  const nextCollectors = collectors.map((collector) => {
    const linked = userByCollectorRef.get(collector.ref);
    if (!linked) {
      return { ...collector, userRef: undefined };
    }
    return {
      ...collector,
      userRef: linked.ref,
      name: linked.name,
      phone: linked.phone || collector.phone,
      document: linked.document || collector.document,
      login: linked.login || collector.login,
      active: linked.active,
      mobileAccess: linked.channels?.includes("mobile") ?? collector.mobileAccess,
    };
  });

  return { users: nextUsers, collectors: nextCollectors };
}

/**
 * Todo usuario con rol cobrador debe tener su fila COB propia.
 * Reclama huérfanos o crea uno nuevo (Diego no debe quedar solo con Ficha/Acceso).
 */
export function ensureCollectorsForUsers(
  users: UserRow[],
  collectors: CollectorRow[],
): { users: UserRow[]; collectors: CollectorRow[] } {
  let nextCollectors = collectors.map((row) => ({ ...row }));
  const nextUsers = users.map((user) => {
    if (user.roleRef !== COLLECTOR_ROLE_REF) return user;

    const linked = collectorForUser(user, nextCollectors);
    if (linked) {
      return { ...user, collectorRef: linked.ref };
    }

    // Reclamar cobrador huérfano que el usuario ya apuntaba.
    if (user.collectorRef) {
      const idx = nextCollectors.findIndex((row) => row.ref === user.collectorRef);
      if (idx >= 0) {
        const row = nextCollectors[idx]!;
        if (!row.userRef || row.userRef === user.ref) {
          nextCollectors[idx] = {
            ...row,
            userRef: user.ref,
            name: user.name,
            phone: user.phone || row.phone,
            document: user.document || row.document,
            login: user.login || row.login,
            active: user.active,
            mobileAccess: true,
          };
          return { ...user, collectorRef: row.ref };
        }
      }
    }

    // Huérfano con el mismo login / nombre.
    const orphanIdx = nextCollectors.findIndex(
      (row) =>
        !row.userRef &&
        ((row.login && row.login.toLowerCase() === user.login.toLowerCase()) ||
          row.name.trim().toLowerCase() === user.name.trim().toLowerCase()),
    );
    if (orphanIdx >= 0) {
      const row = nextCollectors[orphanIdx]!;
      nextCollectors[orphanIdx] = {
        ...row,
        userRef: user.ref,
        name: user.name,
        phone: user.phone || row.phone,
        document: user.document || row.document,
        login: user.login || row.login,
        active: user.active,
        mobileAccess: true,
      };
      return { ...user, collectorRef: row.ref };
    }

    const cobRef = nextCollectorCode(nextCollectors);
    nextCollectors = [
      ...nextCollectors,
      {
        ref: cobRef,
        name: user.name,
        zone: COLLECTOR_UNASSIGNED_ZONE,
        phone: user.phone,
        document: user.document,
        active: user.active,
        userRef: user.ref,
        login: user.login,
        mobileAccess: true,
      },
    ];
    return { ...user, collectorRef: cobRef };
  });

  return alignUserCollectorLinks(nextUsers, nextCollectors);
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
  if (!collectorRef) return [];
  const collector = collectors.find((row) => row.ref === collectorRef);
  const name = collector?.name?.trim().toLowerCase() ?? "";
  // Prefer ref; si el cobro viejo solo tiene nombre, igual cuenta para historial.
  return rows.filter((row) => {
    if (row.collectorRef === collectorRef) return true;
    if (row.collectorRef) return false;
    if (!name) return false;
    return String(row.collector ?? "")
      .trim()
      .toLowerCase() === name;
  });
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

export const ZONES = [] as const; // legacy vacío: la cobertura es por ruta, no por zona geográfica

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
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (row.route !== routeName || row.status === "Pte. revisión") return false;
    if (seen.has(row.ref)) return false;
    seen.add(row.ref);
    return true;
  });
}

/** Clientes de ruta visibles en listado operativo (sin pendientes de revisión). */
export function clientsOnRouteListed(routeName: string, rows: ClientRow[] = CLIENTS) {
  return clientsOnRoute(routeName, rows);
}

export function nextClientCode(rows: ClientRow[] | number = CLIENTS) {
  const list = typeof rows === "number" ? CLIENTS : rows;
  const nums = list
    .map((row) => Number(String(row.ref).replace(/^COD-/i, "")))
    .filter((value) => Number.isFinite(value));
  // Compat: si pasan un número (API vieja), no reutilizar refs existentes.
  const floor = typeof rows === "number" ? rows - 1 : -1;
  const next = Math.max(nums.length ? Math.max(...nums) : -1, floor) + 1;
  return `COD-${next}`;
}

/** Fecha de alta del cliente (DD/MM/AAAA), asignada por el sistema al crear. */
export function clientCreationDate(date = new Date()) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function nextLoanCode(rows: LoanRow[] = LOANS) {
  const nums = rows
    .map((row) => Number(String(row.ref).replace(/^P-/i, "")))
    .filter((value) => Number.isFinite(value));
  const next = nums.length ? Math.max(...nums) + 1 : 0;
  return `P-${next}`;
}

export const PAYMENTS: PaymentRow[] = [];

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

export function money(value: number, opts?: { symbol?: boolean }) {
  const digits = Math.trunc(Math.abs(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const showSymbol = opts?.symbol !== false;
  if (value < 0) return showSymbol ? `$ -${grouped}` : `-${grouped}`;
  return showSymbol ? `$ ${grouped}` : grouped;
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
