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
 * No entra a la caja.
 */
import type { BankMovement } from "@/lib/bank";
import { sameRoute } from "@/lib/client-route-order";
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
  paymentsForCollector,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";
import {
  isOfficePayment,
  loanDisbursementIsoDate,
  loanFundedByBanco,
  loanFundedByNequi,
} from "@/lib/nequi-pool";
import { paymentRecaudoIso } from "@/lib/payment-detail";
import {
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
    return !anchor || (Boolean(iso) && iso > anchor.date);
  };

  const routeByClient = new Map(src.clients.map((row) => [row.ref, row.route]));
  const routeByLoan = new Map(
    src.loans.map((loan) => [
      loan.ref,
      loan.clientRef ? routeByClient.get(loan.clientRef) : undefined,
    ]),
  );
  const seen = new Set<string>();
  const add = (row: PaymentRow) => {
    if (!row.ref || seen.has(row.ref) || row.voidedAt?.trim()) return;
    const amount = Number(row.amount) || 0;
    if (amount <= 0) return;
    const route = row.loanRef ? routeByLoan.get(row.loanRef) : undefined;
    const method = paymentMethodForRoute(row.method, route);
    if (method === "efectivo") return;
    seen.add(row.ref);
    if (counts(method, paymentRecaudoIso(row))) totals[method] += amount;
  };
  for (const ref of new Set([...src.collectorRefs].filter(Boolean))) {
    for (const row of paymentsForCollector(ref, src.collectors, src.payments)) add(row);
  }
  for (const row of src.payments) {
    if (isOfficePayment(row)) add(row);
  }
  const countedOutflow = new Set<string>();
  for (const loan of src.loans) {
    if (!loanFundedByNequi(loan) && !loanFundedByBanco(loan)) continue;
    const capital = Number(loan.capital) || 0;
    if (capital <= 0) continue;
    const route = loan.clientRef ? routeByClient.get(loan.clientRef) : undefined;
    const pool: DigitalPool = paymentMethodForRoute("nequi", route) === "banco" ? "banco" : "nequi";
    const dateIso = loanDisbursementIsoDate(loan);
    const key = `${loan.clientRef || ""}|${dateIso}|${capital}`;
    countedOutflow.add(key);
    if (counts(pool, dateIso)) totals[pool] -= capital;
  }
  if (src.movements?.length) {
    for (const orphan of listOrphanDisbursementOutflows({
      loans: src.loans,
      movements: src.movements,
      clients: src.clients,
    })) {
      const route = routeByClient.get(orphan.clientRef);
      const pool: DigitalPool = paymentMethodForRoute("nequi", route) === "banco" ? "banco" : "nequi";
      const key = `${orphan.clientRef}|${orphan.dateIso}|${orphan.capital}`;
      if (countedOutflow.has(key)) continue;
      countedOutflow.add(key);
      if (counts(pool, orphan.dateIso)) totals[pool] -= orphan.capital;
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

function paymentMatchesPoolRoute(
  row: PaymentRow,
  loans: LoanRow[],
  clients: ClientRow[],
  routeName: string,
): boolean {
  if (sameRoute(paymentClientRoute(row, loans, clients), routeName)) return true;
  const needle = (row.client || "").trim().toLowerCase();
  if (!needle) return false;
  return clients.some((client) => {
    if (!sameRoute(client.route, routeName)) return false;
    const full = `${client.name} ${client.lastName}`.trim().toLowerCase();
    const nick = (client.name || "").trim().toLowerCase();
    return full === needle || nick === needle;
  });
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
  const capital = pesos(Math.trunc(Number(loan.capital) || 0));
  return {
    loanRef: loan.ref,
    clientRef: client.ref,
    clientName: `${client.name} ${client.lastName}`.trim() || (loan.client || "").trim() || loan.ref,
    capital,
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
  const capital = Math.trunc(Number(loan.capital) || 0);
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
  const seen = new Set<string>();
  for (const loan of input.loans) {
    const client = isPoolRegisterLoan(loan, input.clients, input.pool, input.routeName);
    if (!client) continue;
    const date = loanDisbursementIsoDate(loan);
    if (!date) continue;
    if (input.dateIso && date !== input.dateIso) continue;
    if (input.fromIso && date < input.fromIso) continue;
    if (input.toIso && date > input.toIso) continue;
    const capital = pesos(Math.trunc(Number(loan.capital) || 0));
    const key = outflowDedupeKey(client.ref, date, capital);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(toRegisterLoan(loan, client));
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
      const key = outflowDedupeKey(orphan.clientRef, orphan.dateIso, orphan.capital);
      if (seen.has(key)) continue;
      seen.add(key);
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
  return sortPoolRegisterLoans(rows);
}

function sealRegisterDay(
  date: string,
  items: PaymentRow[],
  loans: DigitalPoolRegisterLoan[],
): DigitalPoolRegisterDay {
  const sortedItems = sortPoolRegisterItems(items);
  const sortedLoans = sortPoolRegisterLoans(loans);
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
