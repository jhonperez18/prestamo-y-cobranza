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
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { mergeRouteCashAdjustments } from "@/lib/cash-adjustment";
import {
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
  type RouteCashAdjustment,
} from "@/lib/collector-day-close";
import { pesos } from "@/lib/finance";
import {
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
import { paymentMethodForRoute } from "@/lib/payment-method";
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
  for (const loan of src.loans) {
    if (!loanFundedByNequi(loan) && !loanFundedByBanco(loan)) continue;
    const capital = Number(loan.capital) || 0;
    if (capital <= 0) continue;
    const route = loan.clientRef ? routeByClient.get(loan.clientRef) : undefined;
    const pool: DigitalPool = paymentMethodForRoute("nequi", route) === "banco" ? "banco" : "nequi";
    if (counts(pool, loanDisbursementIsoDate(loan))) totals[pool] -= capital;
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
