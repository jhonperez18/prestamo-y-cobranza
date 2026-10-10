/**
 * Acumulados digitales del dueño — único dueño del saldo de BANCO y NEQUI.
 *
 * Manda la ruta del cliente (no el método guardado): A → Nequi; M / T / N → Banco.
 * Saldo = cobros digitales − préstamos desembolsados desde Nequi o Banco (en el pool de la
 * ruta del cliente que los recibió; lo haga el cobrador o el supervisor).
 *
 * Ajuste (cuadrar el saldo real): supervisor / admin, hoy, con TODAS las rutas cerradas
 * (CIE- de cada cobrador sellado) y antes de medianoche. Vive en los CIE- de hoy como
 * `routeCashAdjustments` con ruta `POOL-BANCO` / `POOL-NEQUI` (nube: `AJUSTE@POOL-…:`).
 * Desde el día siguiente: saldo = real del último ajuste + movimientos posteriores.
 * No toca cobros, préstamos, cajas, CIE `cashFloat` ni la cadena M → T.
 *
 * Regla: el botón Banco / Nequi del Cierre de una ruta = cobros de este historial
 * (`digitalPoolDayPayments`, inflow). Incluye Caja / oficina. T / M / N → Banco;
 * A → solo Nequi. Lo que entra al botón es lo que entra al pool de esa ruta.
 * N: si no hay consignación Banco, el historial y el acumulado quedan en 0
 * (el efectivo no entra; un Nequi del cobrador de N no se inventa como ingreso).
 * No entra a la caja.
 *
 * Un solo libro: `digitalPoolBalances` = real del último ajuste + mismos cobros
 * − mismos capitales que el historial (`isPoolRegisterPayment` /
 * `collectPoolOutflowLoans`). Nunca una suma de cobradores y otra de la ruta.
 *
 * Día en curso: siempre hay renglón de hoy en esa ruta (aunque aún vaya en 0).
 * Un cobro del cobrador, un reporte o un préstamo Banco/Nequi del sistema o del
 * supervisor entra al instante en la ruta del cliente. M, T y N no se mezclan;
 * A es solo Nequi. No toca caja ni INICIO.
 */
import { accountForRole, type BankAccount, type BankMovement } from "@/lib/bank";
import type { MiscPayment } from "@/lib/misc-payments";
import { sameRoute } from "@/lib/client-route-order";
import { addCalendarDaysIso } from "@/lib/colombia-holidays";
import { BUSINESS_TIME_ZONE, businessTodayIso } from "@/lib/business-timezone";
import { listOrphanDisbursementOutflows } from "@/lib/restore-loans-from-bank-disbursements";
import { mergeRouteCashAdjustments } from "@/lib/cash-adjustment";
import {
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
  type RouteCashAdjustment,
} from "@/lib/collector-day-close";
import { pesos } from "@/lib/finance";
import {
  isLoanVoided,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import {
  isOfficePayment,
  loanBankOutflowCapital,
  loanDisbursementIsoDate,
  loanFundedByBanco,
  loanFundedByNequi,
} from "@/lib/nequi-pool";
import { paymentRecaudoIso } from "@/lib/payment-detail";
import {
  normalizePaymentMethod,
  paymentClientRoute,
  paymentDisplayMethod,
  paymentMethodForRoute,
} from "@/lib/payment-method";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";

export type DigitalPool = "banco" | "nequi";
export type DigitalPoolTotals = Record<DigitalPool, number>;

export const DIGITAL_POOL_ROUTE: Record<DigitalPool, string> = {
  banco: "POOL-BANCO",
  nequi: "POOL-NEQUI",
};

export const DIGITAL_POOL_LABEL: Record<DigitalPool, string> = {
  banco: "Banco",
  nequi: "Nequi",
};

/** Banco se muestra por estas rutas. A no entra (Nequi exclusivo). */
export const BANCO_ROUTE_PINS = ["M", "T", "N"] as const;
export type BancoRoutePin = (typeof BANCO_ROUTE_PINS)[number];

/** Nequi es solo la ruta A. */
export const NEQUI_ROUTE_PIN = "A";

export function isBancoRoutePin(name: string | null | undefined): name is BancoRoutePin {
  return Boolean(name && BANCO_ROUTE_PINS.some((pin) => sameRoute(pin, name)));
}

export type BancoRouteCuadre = {
  route: BancoRoutePin;
  date: string;
  /** Saldo de ayer de esa ruta (se fija al pasar el día). */
  inicio: number;
  cobrado: number;
  prestado: number;
  /** Inicio + cobrado − prestado (capital). Es la inicial del día siguiente. */
  saldo: number;
};

export type BancoRouteHistoryDay = BancoRouteCuadre & {
  items: PaymentRow[];
  loans: DigitalPoolRegisterLoan[];
};

/** Historial Nequi: solo ruta A. Mismo libro (cobrado / prestado / saldo). */
export type NequiRouteHistoryDay = {
  route: typeof NEQUI_ROUTE_PIN;
  date: string;
  inicio: number;
  cobrado: number;
  prestado: number;
  saldo: number;
  items: PaymentRow[];
  loans: DigitalPoolRegisterLoan[];
};

/** Renglón del historial Cobrado: no resta préstamos. Final = inicial del día siguiente. */
export type BancoRouteCobradoDay = {
  route: string;
  date: string;
  inicio: number;
  cobrado: number;
  final: number;
  items: PaymentRow[];
};

/** Renglón del historial Prestado: solo capital prestado. El primer día inicial = 0. */
export type BancoRoutePrestadoDay = {
  route: string;
  date: string;
  inicio: number;
  prestado: number;
  final: number;
  loans: DigitalPoolRegisterLoan[];
};

export type DigitalPoolSources = {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  collectors: CollectorRow[];
  collectorRefs: Iterable<string>;
  dayCloses: CollectorDayCloseRecord[];
  /** Haber DSB huérfano: sale del pool aunque la ficha aún no esté (Albornoz). */
  movements?: BankMovement[];
};

type PoolAnchor = { date: string; adjustment: RouteCashAdjustment };

function isoOf(raw: string) {
  return normalizeHistoryDate(raw) || raw;
}

function isPoolAdjustment(adj: RouteCashAdjustment, pool: DigitalPool) {
  return adj.route.trim().toUpperCase() === DIGITAL_POOL_ROUTE[pool];
}

function adjustmentMs(adj: RouteCashAdjustment) {
  const ms = Date.parse(adj.at);
  return Number.isFinite(ms) ? ms : 0;
}

/** Último ajuste del pool (día más reciente; mismo día → el más nuevo). `before` excluye ese día y los siguientes. */
export function latestDigitalPoolAnchor(
  dayCloses: CollectorDayCloseRecord[],
  pool: DigitalPool,
  before?: string,
): PoolAnchor | null {
  let best: PoolAnchor | null = null;
  for (const row of dayCloses) {
    const adj = row.routeCashAdjustments?.find((entry) => isPoolAdjustment(entry, pool));
    if (!adj) continue;
    const date = isoOf(row.date);
    if (before && date >= before) continue;
    if (
      !best ||
      date > best.date ||
      (date === best.date && adjustmentMs(adj) > adjustmentMs(best.adjustment))
    ) {
      best = { date, adjustment: adj };
    }
  }
  return best;
}

/**
 * Saldo de cada pool. Con ajuste previo: real del ajuste + movimientos de los días
 * siguientes. `before` = calcular sin los ajustes de ese día (saldo «calculado»).
 */
export function digitalPoolBalances(src: DigitalPoolSources, before?: string): DigitalPoolTotals {
  const anchors: Record<DigitalPool, PoolAnchor | null> = {
    banco: latestDigitalPoolAnchor(src.dayCloses, "banco", before),
    nequi: latestDigitalPoolAnchor(src.dayCloses, "nequi", before),
  };
  const totals: DigitalPoolTotals = {
    banco: anchors.banco ? pesos(anchors.banco.adjustment.real) : 0,
    nequi: anchors.nequi ? pesos(anchors.nequi.adjustment.real) : 0,
  };
  const counts = (pool: DigitalPool, iso: string) => {
    const anchor = anchors[pool];
    const day = isoOf(iso);
    return !anchor || (Boolean(day) && day > anchor.date);
  };

  const seenIn = new Set<string>();
  for (const row of src.payments) {
    if (!row.ref || seenIn.has(row.ref)) continue;
    for (const pool of ["banco", "nequi"] as const) {
      if (!isPoolRegisterPayment(row, src.loans, src.clients, pool)) continue;
      seenIn.add(row.ref);
      if (counts(pool, paymentRecaudoIso(row))) {
        totals[pool] += Number(row.amount) || 0;
      }
      break;
    }
  }
  for (const pool of ["banco", "nequi"] as const) {
    for (const loan of collectPoolOutflowLoans({
      loans: src.loans,
      clients: src.clients,
      pool,
      movements: src.movements,
    })) {
      if (counts(pool, loan.dateIso)) totals[pool] -= loan.capital;
    }
  }
  return { banco: pesos(totals.banco), nequi: pesos(totals.nequi) };
}

/** Ajuste hecho hoy en el pool (si lo hubo). */
export function todayDigitalPoolAdjustment(
  dayCloses: CollectorDayCloseRecord[],
  pool: DigitalPool,
  now = new Date(),
): RouteCashAdjustment | null {
  const anchor = latestDigitalPoolAnchor(dayCloses, pool);
  return anchor && anchor.date === businessTodayIso(now) ? anchor.adjustment : null;
}

export type DigitalPoolAdjustWindow =
  | { open: true; date: string; cies: CollectorDayCloseRecord[] }
  | { open: false; reason: string };

/** Ventana: todas las rutas cerradas hoy (CIE- de cada cobrador), antes de medianoche. */
export function digitalPoolAdjustWindow(
  collectors: Array<{ ref: string; name?: string }>,
  dayCloses: CollectorDayCloseRecord[],
  now = new Date(),
): DigitalPoolAdjustWindow {
  const date = businessTodayIso(now);
  const unique = [...new Map(collectors.filter((row) => row.ref).map((row) => [row.ref, row])).values()];
  if (!unique.length) return { open: false, reason: "No hay rutas con cobrador." };
  const cies: CollectorDayCloseRecord[] = [];
  const pending: string[] = [];
  for (const collector of unique) {
    const cie = findFullDayCieClose(dayCloses, collector.ref, date);
    if (cie) cies.push(cie);
    else pending.push(collector.name || collector.ref);
  }
  if (pending.length) {
    return {
      open: false,
      reason: `Faltan rutas por cerrar hoy (${pending.join(", ")}). El ajuste se hace con todas cerradas y antes de medianoche.`,
    };
  }
  return { open: true, date, cies };
}

export type DigitalPoolAdjustInput = {
  pool: DigitalPool;
  real: number;
  reason: string;
  by: string;
  /** Saldo del pool sin los ajustes de hoy (`digitalPoolBalances(src, hoy)`). */
  calculated: number;
  collectors: Array<{ ref: string; name?: string }>;
  dayCloses: CollectorDayCloseRecord[];
  now?: Date;
};

export type DigitalPoolAdjustResult =
  | { ok: true; records: CollectorDayCloseRecord[]; dayCloses: CollectorDayCloseRecord[] }
  | { ok: false; error: string };

export function commitDigitalPoolAdjustment(input: DigitalPoolAdjustInput): DigitalPoolAdjustResult {
  const now = input.now ?? new Date();
  const adjustWindow = digitalPoolAdjustWindow(input.collectors, input.dayCloses, now);
  if (!adjustWindow.open) return { ok: false, error: adjustWindow.reason };

  const real = Number(input.real);
  if (!Number.isFinite(real) || real < 0 || !Number.isInteger(real)) {
    return { ok: false, error: "Escriba el saldo real (pesos, sin decimales)." };
  }
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 3) return { ok: false, error: "Escriba el motivo del ajuste." };
  const by = input.by.trim();
  if (!by) return { ok: false, error: "Falta quién hace el ajuste." };

  const prev = todayDigitalPoolAdjustment(input.dayCloses, input.pool, now);
  const calculated = pesos(prev?.calculated ?? input.calculated);
  if (!prev && pesos(real) === calculated) {
    return { ok: false, error: "El saldo real es igual al calculado: no hay nada que ajustar." };
  }

  const adjustment: RouteCashAdjustment = {
    route: DIGITAL_POOL_ROUTE[input.pool],
    calculated,
    real: pesos(real),
    by,
    at: now.toISOString(),
    reason,
  };
  const records = adjustWindow.cies.map((cie) => ({
    ...cie,
    routeCashAdjustments: mergeRouteCashAdjustments(cie.routeCashAdjustments, [adjustment]),
  }));
  const byRef = new Map(records.map((row) => [row.ref, row]));
  const dayCloses = input.dayCloses.map((row) => byRef.get(row.ref) ?? row);
  return { ok: true, records, dayCloses };
}

/** Préstamo que sale del pool (solo capital). No es cuota: la cuota entra al día siguiente en la ruta. */
export type DigitalPoolRegisterLoan = {
  loanRef: string;
  clientRef: string;
  clientName: string;
  capital: number;
  time: string;
  dateIso: string;
};

export type DigitalPoolRegisterDay = {
  date: string;
  items: PaymentRow[];
  loans: DigitalPoolRegisterLoan[];
  /** Cobros del día (suman al pool). */
  inflow: number;
  /** Capitales prestados desde el pool (restan). */
  outflow: number;
  /** Neto del día: cobros − préstamos. Positivo suma al saldo; negativo lo resta. */
  total: number;
};

/** Banco / Nequi de una ruta = préstamo → ficha → ruta del Listado. Nunca por nombre. */
function paymentMatchesPoolRoute(
  row: PaymentRow,
  loans: LoanRow[],
  clients: ClientRow[],
  routeName: string,
): boolean {
  return sameRoute(paymentClientRoute(row, loans, clients), routeName);
}

function isPoolRegisterPayment(
  row: PaymentRow,
  loans: LoanRow[],
  clients: ClientRow[],
  pool: DigitalPool,
  routeName?: string | null,
): boolean {
  if (row.voidedAt?.trim()) return false;
  if (!((row.amount ?? 0) > 0)) return false;
  const catalogRoute = paymentClientRoute(row, loans, clients);
  const stored = normalizePaymentMethod(row.method);
  if (
    pool === "banco" &&
    sameRoute(catalogRoute, "N") &&
    stored !== "banco" &&
    !isOfficePayment(row)
  ) {
    return false;
  }
  if (paymentDisplayMethod(row, loans, clients) !== pool) return false;
  const route = routeName?.trim();
  if (route && !paymentMatchesPoolRoute(row, loans, clients, route)) return false;
  return true;
}

function sortPoolRegisterItems(items: PaymentRow[]): PaymentRow[] {
  return items
    .slice()
    .sort((a, b) => (b.paidTime || "").localeCompare(a.paidTime || ""));
}

function poolOfClientRoute(route: string | undefined): DigitalPool {
  return paymentMethodForRoute("nequi", route) === "banco" ? "banco" : "nequi";
}

function loanRegisterTime(loan: LoanRow): string {
  const ms = Date.parse(String(loan.updatedAt || "").trim());
  if (!Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleTimeString("es-CO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: BUSINESS_TIME_ZONE,
    });
  } catch (err) {
    console.error("loanRegisterTime", err);
    return "";
  }
}

function toRegisterLoan(loan: LoanRow, client: ClientRow): DigitalPoolRegisterLoan {
  return {
    loanRef: loan.ref,
    clientRef: client.ref,
    clientName: `${client.name} ${client.lastName}`.trim() || (loan.client || "").trim() || loan.ref,
    capital: loanBankOutflowCapital(loan),
    time: loanRegisterTime(loan),
    dateIso: loanDisbursementIsoDate(loan),
  };
}

function isPoolRegisterLoan(
  loan: LoanRow,
  clients: ClientRow[],
  pool: DigitalPool,
  routeName?: string | null,
): ClientRow | null {
  if (isLoanVoided(loan)) return null;
  if (!loanFundedByBanco(loan) && !loanFundedByNequi(loan)) return null;
  const capital = loanBankOutflowCapital(loan);
  if (capital <= 0 || !loan.ref) return null;
  const client = clients.find((row) => row.ref === loan.clientRef);
  if (!client) return null;
  if (poolOfClientRoute(client.route) !== pool) return null;
  const route = routeName?.trim();
  if (route && !sameRoute(client.route, route)) return null;
  return client;
}

function sortPoolRegisterLoans(rows: DigitalPoolRegisterLoan[]): DigitalPoolRegisterLoan[] {
  return rows.slice().sort((a, b) => {
    const byTime = (b.time || "").localeCompare(a.time || "");
    if (byTime !== 0) return byTime;
    return a.clientName.localeCompare(b.clientName, "es");
  });
}

function emptyRegisterDay(date: string): DigitalPoolRegisterDay {
  return { date, items: [], loans: [], inflow: 0, outflow: 0, total: 0 };
}

function outflowDedupeKey(clientRef: string, dateIso: string, capital: number) {
  return `${clientRef}|${dateIso}|${capital}`;
}

function isLoanCodeRef(ref: string) {
  return /^P-\d+/i.test(ref.trim());
}

function loanCodeNumber(ref: string): number {
  const matched = /^P-(\d+)/i.exec((ref || "").trim());
  return matched ? Number(matched[1]) : Number.POSITIVE_INFINITY;
}

/** Un cliente + un día + un capital = un solo renglón. El original es el P- más viejo. */
function preferPoolOutflowRow(
  current: DigitalPoolRegisterLoan | undefined,
  next: DigitalPoolRegisterLoan,
): DigitalPoolRegisterLoan {
  if (!current) return next;
  const currentP = isLoanCodeRef(current.loanRef);
  const nextP = isLoanCodeRef(next.loanRef);
  if (nextP && !currentP) return next;
  if (currentP && !nextP) return current;
  if (nextP && currentP && loanCodeNumber(next.loanRef) < loanCodeNumber(current.loanRef)) {
    return next;
  }
  return current;
}

function uniquePoolRegisterLoans(rows: DigitalPoolRegisterLoan[]): DigitalPoolRegisterLoan[] {
  const byKey = new Map<string, DigitalPoolRegisterLoan>();
  for (const row of rows) {
    const key = outflowDedupeKey(row.clientRef, row.dateIso, row.capital);
    byKey.set(key, preferPoolOutflowRow(byKey.get(key), row));
  }
  return sortPoolRegisterLoans([...byKey.values()]);
}

function collectPoolOutflowLoans(input: {
  loans: LoanRow[];
  clients: ClientRow[];
  pool: DigitalPool;
  routeName?: string | null;
  dateIso?: string;
  fromIso?: string;
  toIso?: string;
  movements?: BankMovement[];
}): DigitalPoolRegisterLoan[] {
  const rows: DigitalPoolRegisterLoan[] = [];
  const seenRefs = new Set<string>();
  const coveredTwins = new Set<string>();
  for (const loan of input.loans) {
    const client = isPoolRegisterLoan(loan, input.clients, input.pool, input.routeName);
    if (!client) continue;
    const date = loanDisbursementIsoDate(loan);
    if (!date) continue;
    if (input.dateIso && date !== input.dateIso) continue;
    if (input.fromIso && date < input.fromIso) continue;
    if (input.toIso && date > input.toIso) continue;
    if (!loan.ref || seenRefs.has(loan.ref)) continue;
    seenRefs.add(loan.ref);
    const capital = loanBankOutflowCapital(loan);
    const twin = outflowDedupeKey(client.ref, date, capital);
    const nextRow = toRegisterLoan(loan, client);
    if (coveredTwins.has(twin)) {
      const idx = rows.findIndex(
        (row) => outflowDedupeKey(row.clientRef, row.dateIso, row.capital) === twin,
      );
      if (idx >= 0) rows[idx] = preferPoolOutflowRow(rows[idx], nextRow);
      continue;
    }
    coveredTwins.add(twin);
    rows.push(nextRow);
  }
  if (input.movements?.length) {
    for (const orphan of listOrphanDisbursementOutflows({
      loans: input.loans,
      movements: input.movements,
      clients: input.clients,
    })) {
      const client = input.clients.find((row) => row.ref === orphan.clientRef);
      if (!client) continue;
      if (poolOfClientRoute(client.route) !== input.pool) continue;
      const route = input.routeName?.trim();
      if (route && !sameRoute(client.route, route)) continue;
      if (input.dateIso && orphan.dateIso !== input.dateIso) continue;
      if (input.fromIso && orphan.dateIso < input.fromIso) continue;
      if (input.toIso && orphan.dateIso > input.toIso) continue;
      if (seenRefs.has(orphan.movementRef)) continue;
      if (coveredTwins.has(outflowDedupeKey(orphan.clientRef, orphan.dateIso, orphan.capital))) {
        continue;
      }
      seenRefs.add(orphan.movementRef);
      rows.push({
        loanRef: orphan.movementRef,
        clientRef: orphan.clientRef,
        clientName: orphan.clientName,
        capital: pesos(orphan.capital),
        time: orphan.time,
        dateIso: orphan.dateIso,
      });
    }
  }
  return uniquePoolRegisterLoans(rows);
}

function sealRegisterDay(
  date: string,
  items: PaymentRow[],
  loans: DigitalPoolRegisterLoan[],
): DigitalPoolRegisterDay {
  const sortedItems = sortPoolRegisterItems(items);
  const sortedLoans = uniquePoolRegisterLoans(loans);
  const inflow = pesos(sortedItems.reduce((sum, row) => sum + (row.amount ?? 0), 0));
  const outflow = pesos(sortedLoans.reduce((sum, row) => sum + row.capital, 0));
  return {
    date,
    items: sortedItems,
    loans: sortedLoans,
    inflow,
    outflow,
    total: pesos(inflow - outflow),
  };
}

/**
 * Cobros del pool en un día (ruta del cliente). Incluye Caja / oficina.
 * Misma lista que el botón Banco T / Banco M / Nequi A (`routeDigitalPayments`).
 * No toca la caja.
 */
export function digitalPoolDayPayments(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  pool: DigitalPool;
  dateIso: string;
  routeName?: string | null;
}): PaymentRow[] {
  const date = isoOf(input.dateIso);
  if (!date) return [];
  return sortPoolRegisterItems(
    input.payments.filter((row) => {
      if (!isPoolRegisterPayment(row, input.loans, input.clients, input.pool, input.routeName)) {
        return false;
      }
      return isoOf(paymentRecaudoIso(row)) === date;
    }),
  );
}

/** Préstamos del pool en un día (capital). Ruta del cliente. Incluye Haber huérfano. */
export function digitalPoolDayLoans(input: {
  loans: LoanRow[];
  clients: ClientRow[];
  pool: DigitalPool;
  dateIso: string;
  routeName?: string | null;
  movements?: BankMovement[];
}): DigitalPoolRegisterLoan[] {
  const date = isoOf(input.dateIso);
  if (!date) return [];
  return collectPoolOutflowLoans({ ...input, dateIso: date });
}

/**
 * Registro Banco / Nequi por día: cobros (`paidDate`) − préstamos (capital del desembolso).
 * Incluye abonos del sistema (Caja / oficina). No mezcla rutas ni mueve caja.
 * Un día solo con préstamo también sale: así el supervisor ve lo que salió del saldo.
 */
export function digitalPoolRegisterDays(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  pool: DigitalPool;
  fromIso: string;
  toIso: string;
  routeName?: string | null;
  movements?: BankMovement[];
}): DigitalPoolRegisterDay[] {
  const from = isoOf(input.fromIso);
  const to = isoOf(input.toIso);
  const byDate = new Map<string, { items: PaymentRow[]; loans: DigitalPoolRegisterLoan[] }>();
  const bucket = (date: string) => {
    const current = byDate.get(date);
    if (current) return current;
    const next = { items: [] as PaymentRow[], loans: [] as DigitalPoolRegisterLoan[] };
    byDate.set(date, next);
    return next;
  };
  for (const row of input.payments) {
    if (!isPoolRegisterPayment(row, input.loans, input.clients, input.pool, input.routeName)) {
      continue;
    }
    const date = isoOf(paymentRecaudoIso(row));
    if (!date || (from && date < from) || (to && date > to)) continue;
    bucket(date).items.push(row);
  }
  for (const loan of collectPoolOutflowLoans({
    loans: input.loans,
    clients: input.clients,
    pool: input.pool,
    routeName: input.routeName,
    fromIso: from,
    toIso: to,
    movements: input.movements,
  })) {
    if (!loan.dateIso) continue;
    bucket(loan.dateIso).loans.push(loan);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, row]) => sealRegisterDay(date, row.items, row.loans));
}

/** Un día del registro (cobros + préstamos + neto). */
export function digitalPoolDayLedger(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  pool: DigitalPool;
  dateIso: string;
  routeName?: string | null;
  movements?: BankMovement[];
}): DigitalPoolRegisterDay {
  const date = isoOf(input.dateIso);
  if (!date) return emptyRegisterDay("");
  return (
    digitalPoolRegisterDays({
      payments: input.payments,
      loans: input.loans,
      clients: input.clients,
      pool: input.pool,
      fromIso: date,
      toIso: date,
      routeName: input.routeName,
      movements: input.movements,
    })[0] ?? emptyRegisterDay(date)
  );
}

function poolRouteWindowStart(
  dayCloses: CollectorDayCloseRecord[],
  pool: DigitalPool,
  fromIso: string,
) {
  const from = isoOf(fromIso);
  const anchor = latestDigitalPoolAnchor(dayCloses, pool);
  if (!anchor) return from;
  const next = addCalendarDaysIso(anchor.date, 1);
  if (!from) return next;
  return next > from ? next : from;
}

function bancoRouteWindowStart(dayCloses: CollectorDayCloseRecord[], fromIso: string) {
  return poolRouteWindowStart(dayCloses, "banco", fromIso);
}

/**
 * Cuadre Banco de una ruta en un día: Inicio (saldo de ayer, fijo) + cobrado − capital prestado.
 * No mezcla rutas. N sin consignación Banco queda en 0. No toca caja ni INICIO.
 */
export function bancoRouteCuadre(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  dayCloses: CollectorDayCloseRecord[];
  dateIso: string;
  routeName: string;
  fromIso: string;
  movements?: BankMovement[];
}): BancoRouteCuadre {
  const date = isoOf(input.dateIso);
  const route: BancoRoutePin =
    BANCO_ROUTE_PINS.find((pin) => sameRoute(pin, input.routeName)) ?? "M";
  if (!date) {
    return { route, date: "", inicio: 0, cobrado: 0, prestado: 0, saldo: 0 };
  }
  const start = bancoRouteWindowStart(input.dayCloses, input.fromIso);
  const prior = addCalendarDaysIso(date, -1);
  let inicio = 0;
  if (start && prior && prior >= start) {
    const past = digitalPoolRegisterDays({
      payments: input.payments,
      loans: input.loans,
      clients: input.clients,
      pool: "banco",
      fromIso: start,
      toIso: prior,
      routeName: route,
      movements: input.movements,
    });
    inicio = pesos(past.reduce((sum, day) => sum + day.total, 0));
  }
  const day = digitalPoolDayLedger({
    payments: input.payments,
    loans: input.loans,
    clients: input.clients,
    pool: "banco",
    dateIso: date,
    routeName: route,
    movements: input.movements,
  });
  const cobrado = pesos(day.inflow);
  const prestado = pesos(day.outflow);
  return {
    route,
    date,
    inicio,
    cobrado,
    prestado,
    saldo: pesos(inicio + cobrado - prestado),
  };
}

/** Acumulado Banco = suma de los saldos M + T + N. */
export function bancoAcumuladoRutas(cuadres: readonly BancoRouteCuadre[]): number {
  return pesos(cuadres.reduce((sum, row) => sum + row.saldo, 0));
}

export type DigitalPoolGasto = {
  ref: string;
  date: string;
  label: string;
  amount: number;
};

/**
 * Gastos pagados desde la cuenta del pool (pagos varios `PV-` con la cuenta de uso `banco`
 * o `nequi`), en la misma ventana que el historial de sus rutas: desde `fromIso` y después
 * del último cuadre de ese pool. Manda la cuenta, no la forma de pago. Más nuevo primero.
 */
export function digitalPoolGastos(input: {
  pool: DigitalPool;
  miscPayments: readonly MiscPayment[];
  accounts: BankAccount[];
  dayCloses: CollectorDayCloseRecord[];
  fromIso: string;
  toIso: string;
}): DigitalPoolGasto[] {
  const accountRef = accountForRole(input.accounts, input.pool)?.ref;
  const start = poolRouteWindowStart(input.dayCloses, input.pool, input.fromIso);
  const to = isoOf(input.toIso);
  if (!accountRef || !to) return [];
  return input.miscPayments
    .filter((row) => row.bankAccountRef === accountRef)
    .map((row) => ({
      ref: row.ref,
      date: isoOf(row.paidDate),
      label: row.label,
      amount: pesos(Number(row.amount) || 0),
    }))
    .filter((row) => row.amount > 0 && (!start || row.date >= start) && row.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref, "es", { numeric: true }));
}

export function digitalPoolGastosTotal(gastos: readonly DigitalPoolGasto[]): number {
  return pesos(gastos.reduce((sum, row) => sum + row.amount, 0));
}

/**
 * Historial Banco de una ruta: cada día con su inicial (= final de ayer) y su final.
 * Solo esa ruta. No mezcla M/T/N ni toca caja.
 */
export function bancoRouteHistoryDays(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  dayCloses: CollectorDayCloseRecord[];
  fromIso: string;
  toIso: string;
  routeName: string;
  movements?: BankMovement[];
}): BancoRouteHistoryDay[] {
  const route: BancoRoutePin =
    BANCO_ROUTE_PINS.find((pin) => sameRoute(pin, input.routeName)) ?? "M";
  const start = bancoRouteWindowStart(input.dayCloses, input.fromIso);
  const to = isoOf(input.toIso);
  if (!start || !to || start > to) return [];
  const days = digitalPoolRegisterDays({
    payments: input.payments,
    loans: input.loans,
    clients: input.clients,
    pool: "banco",
    fromIso: start,
    toIso: to,
    routeName: route,
    movements: input.movements,
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  const chronological = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
  let running = 0;
  const rows: BancoRouteHistoryDay[] = [];
  for (const date of chronological) {
    const day = byDate.get(date);
    if (!day) continue;
    const inicio = pesos(running);
    const cobrado = pesos(day.inflow);
    const prestado = pesos(day.outflow);
    const saldo = pesos(inicio + cobrado - prestado);
    running = saldo;
    rows.push({
      route,
      date,
      inicio,
      cobrado,
      prestado,
      saldo,
      items: day.items,
      loans: day.loans,
    });
  }
  if (to && !byDate.has(to)) {
    const inicio = pesos(running);
    rows.push({
      route,
      date: to,
      inicio,
      cobrado: 0,
      prestado: 0,
      saldo: inicio,
      items: [],
      loans: [],
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Historial Nequi de la ruta A: cada día con su inicial (= final de ayer) y su final.
 * Solo A. No mezcla M/T/N ni toca caja.
 */
export function nequiRouteHistoryDays(input: {
  payments: PaymentRow[];
  loans: LoanRow[];
  clients: ClientRow[];
  dayCloses: CollectorDayCloseRecord[];
  fromIso: string;
  toIso: string;
  movements?: BankMovement[];
}): NequiRouteHistoryDay[] {
  const route = NEQUI_ROUTE_PIN;
  const start = poolRouteWindowStart(input.dayCloses, "nequi", input.fromIso);
  const to = isoOf(input.toIso);
  if (!start || !to || start > to) return [];
  const days = digitalPoolRegisterDays({
    payments: input.payments,
    loans: input.loans,
    clients: input.clients,
    pool: "nequi",
    fromIso: start,
    toIso: to,
    routeName: route,
    movements: input.movements,
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  const chronological = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
  let running = 0;
  const rows: NequiRouteHistoryDay[] = [];
  for (const date of chronological) {
    const day = byDate.get(date);
    if (!day) continue;
    const inicio = pesos(running);
    const cobrado = pesos(day.inflow);
    const prestado = pesos(day.outflow);
    const saldo = pesos(inicio + cobrado - prestado);
    running = saldo;
    rows.push({
      route,
      date,
      inicio,
      cobrado,
      prestado,
      saldo,
      items: day.items,
      loans: day.loans,
    });
  }
  if (to && !byDate.has(to)) {
    const inicio = pesos(running);
    rows.push({
      route,
      date: to,
      inicio,
      cobrado: 0,
      prestado: 0,
      saldo: inicio,
      items: [],
      loans: [],
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** Suma a la fecha de una ruta: cobrado de todos los días y capital prestado de todos los días. */
export function bancoRouteHistoryTotals(
  days: readonly Pick<BancoRouteHistoryDay, "cobrado" | "prestado">[],
) {
  return {
    cobrado: pesos(days.reduce((sum, day) => sum + day.cobrado, 0)),
    prestado: pesos(days.reduce((sum, day) => sum + day.prestado, 0)),
  };
}

/**
 * Historial del botón Cobrado: inicial · cobrado · final.
 * Final = inicial + cobrado (no resta préstamos). Ese final es la inicial del día siguiente.
 * `liveDate` (hoy): el renglón queda habilitado aunque aún vaya en 0; se llena al instante.
 */
export function bancoRouteCobradoHistoryDays(
  days: readonly {
    route: string;
    date: string;
    cobrado: number;
    items: PaymentRow[];
  }[],
  liveDate = "",
): BancoRouteCobradoDay[] {
  const live = isoOf(liveDate);
  const chrono = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const rows: BancoRouteCobradoDay[] = [];
  for (const day of chrono) {
    const cobrado = pesos(day.cobrado);
    const isLive = Boolean(live && day.date === live);
    if (cobrado <= 0 && day.items.length === 0 && !isLive) continue;
    const inicio = pesos(running);
    const final = pesos(inicio + cobrado);
    running = final;
    rows.push({
      route: day.route,
      date: day.date,
      inicio,
      cobrado,
      final,
      items: day.items,
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Historial del botón Prestado: inicial · prestado · final.
 * El primer día inicial = 0. Final = inicial + capital prestado (no mezcla cobrado).
 * Ese final es la inicial del día siguiente, solo de esa ruta.
 * `liveDate` (hoy): el renglón queda habilitado aunque aún vaya en 0; un préstamo
 * del sistema o del supervisor entra al instante en esa ruta.
 */
export function bancoRoutePrestadoHistoryDays(
  days: readonly {
    route: string;
    date: string;
    prestado: number;
    loans: DigitalPoolRegisterLoan[];
  }[],
  liveDate = "",
): BancoRoutePrestadoDay[] {
  const live = isoOf(liveDate);
  const chrono = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const rows: BancoRoutePrestadoDay[] = [];
  for (const day of chrono) {
    const prestado = pesos(day.prestado);
    const isLive = Boolean(live && day.date === live);
    if (prestado <= 0 && day.loans.length === 0 && !isLive) continue;
    const inicio = pesos(running);
    const final = pesos(inicio + prestado);
    running = final;
    rows.push({
      route: day.route,
      date: day.date,
      inicio,
      prestado,
      final,
      loans: day.loans,
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}
