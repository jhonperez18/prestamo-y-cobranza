/**
 * Informe semanal (corte sábado). Dos hojas: M · T · N y A aparte.
 * Solo lee a los dueños de cada cifra; aquí no hay fórmula de caja propia:
 *   Cartera   = saldo de cada préstamo al corte (`computeLoanFinancials` con pagos ≤ corte).
 *   Caja M·T  = libro del día (`buildDayCashLedger`); saldo final = CIE- del último día.
 *   Caja A/N  = `independentRouteDay` / `independentRouteMovement`.
 *   Cobros    = `routeCollectedByMethod` (ruta del cliente).
 *   Préstamos = renglones del libro (efectivo) + `dayDigitalLoanRows` (Banco / Nequi).
 *   Banco/Nequi = `digitalPoolBalances` con lo conocido al corte.
 *   Movimiento por día = `informeRouteHistory` / `informeOwnRouteHistory` (Informe del supervisor).
 */
import {
  addCalendarDaysIso,
  isColombiaHoliday,
  isDailyCollectionDay,
  utcWeekdayIndex,
} from "@/lib/colombia-holidays";
import { clientsOnRouteSorted, sameRoute } from "@/lib/client-route-order";
import { normalizeHistoryDate, type RouteCashAdjustment, type RouteExpenseLine } from "@/lib/collector-day-close";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";
import { buildDayCashLedger, routeCollectedByMethod, type DayCashSources } from "@/lib/day-cash-ledger";
import { dayDigitalLoanRows } from "@/lib/day-digital-loans";
import { digitalPoolBalances, type DigitalPool } from "@/lib/digital-pools";
import { pesos } from "@/lib/finance";
import { independentRouteDay, independentRouteMovement } from "@/lib/independent-route-cash";
import {
  informeOwnRouteHistory,
  informeRouteHistory,
  type InformeHistoryKind,
  type InformeHistorySources,
} from "@/lib/informe-route-days";
import { isLatePayment } from "@/lib/late-payment";
import { livePayments } from "@/lib/live-payments";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { isoToDisplay, syncLoan } from "@/lib/loan-preview";
import { isLoanVoided, money, type LoanRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";
import { loanDisbursementIsoDate } from "@/lib/nequi-pool";
import { paymentRecaudoIso } from "@/lib/payment-detail";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";
import { isClientDeletedStatus } from "@/lib/supabase/catalog-mirror";

export type WeeklyReportScope = "mtn" | "a";

export const WEEKLY_SCOPE_ROUTES: Record<WeeklyReportScope, string[]> = {
  mtn: ["M", "T", "N"],
  a: ["A"],
};

export type WeeklyRange = {
  /** Sábado del corte. */
  saturday: string;
  /** Primer día de cobro de la semana (lunes, o martes si el lunes es festivo). */
  start: string;
  /** Último día de cobro hasta el corte (o hasta hoy si la semana sigue abierta). */
  end: string;
  days: string[];
  holidays: string[];
  /** La semana aún no llega al sábado. */
  partial: boolean;
};

export type WeeklyMark = "N" | "R" | "F" | "A" | "NP";

export type WeeklyClientRow = {
  ref: string;
  order: number;
  name: string;
  /** Lo que debe al corte. `null` = sin préstamo con saldo («–»). */
  debt: number | null;
  paidWeek: number;
  marks: WeeklyMark[];
};

export type WeeklyRouteCartera = {
  route: string;
  collectorName: string;
  rows: WeeklyClientRow[];
  total: number;
  owing: number;
};

export type WeeklyCajaRow = {
  label: string;
  opening: number | null;
  efectivo: number;
  prestamos: number;
  gastos: number;
  /** Saldo final − (Inicial + cobró − prestó − gastó): ajustes de saldo real de la semana. */
  ajustes: number;
  closing: number | null;
  sub?: boolean;
};

function cajaRow(row: Omit<WeeklyCajaRow, "ajustes">): WeeklyCajaRow {
  const ajustes =
    row.opening == null || row.closing == null
      ? 0
      : pesos(row.closing - (row.opening + row.efectivo - row.prestamos - row.gastos));
  return { ...row, ajustes };
}

export type WeeklyCobroRow = { route: string; efectivo: number; digital: number; total: number };
export type WeeklyLoanRow = { route: string; count: number; capital: number; efectivo: number; digital: number };
export type WeeklyGastoRow = { label: string; byRoute: Record<string, number>; total: number };

export type WeeklyPool = {
  label: string;
  opening: number;
  entro: number;
  salio: number;
  ajustes: number;
  closing: number;
};

export type WeeklyResumenLine = { label: string; value: number; tone?: "sub" | "total" | "grand" };
export type WeeklyResumenRow = { kind: "section"; label: string } | ({ kind: "line" } & WeeklyResumenLine);

export type WeeklyMovementDay = { date: string; values: Record<string, number>; total: number };
export type WeeklyMovement = { kind: InformeHistoryKind; label: string; days: WeeklyMovementDay[]; total: number };

export type WeeklyReport = {
  scope: WeeklyReportScope;
  range: WeeklyRange;
  routes: string[];
  cartera: WeeklyRouteCartera[];
  carteraTotal: number;
  caja: WeeklyCajaRow[];
  cobros: WeeklyCobroRow[];
  prestamos: WeeklyLoanRow[];
  gastos: WeeklyGastoRow[];
  pool: WeeklyPool;
  novedades: string[];
  resumen: WeeklyResumenRow[];
  movimiento: WeeklyMovement[];
};

export type WeeklyReportSources = InformeHistorySources & { routes: RouteRow[] };

const MOVEMENT_LABELS: Record<InformeHistoryKind, string> = {
  cobrado: "Cobrado",
  prestamo: "Préstamo",
  gasto: "Gasto",
};

/** Sábados de corte, del más reciente (semana en curso) al más viejo. */
export function recentWeeklyCortes(today: string, count = 8): string[] {
  const weekday = utcWeekdayIndex(today);
  const current = weekday === 0 ? addCalendarDaysIso(today, -1) : addCalendarDaysIso(today, 6 - weekday);
  return Array.from({ length: count }, (_, index) => addCalendarDaysIso(current, -7 * index));
}

export function weeklyRangeForSaturday(saturday: string, today: string): WeeklyRange {
  const monday = addCalendarDaysIso(saturday, -5);
  const days: string[] = [];
  const holidays: string[] = [];
  for (let day = monday; day <= saturday; day = addCalendarDaysIso(day, 1)) {
    if (isColombiaHoliday(day)) holidays.push(day);
    if (isDailyCollectionDay(day) && day <= today) days.push(day);
  }
  const start = days[0] ?? monday;
  return {
    saturday,
    start,
    end: days[days.length - 1] ?? start,
    days,
    holidays,
    partial: saturday > today,
  };
}

function isoOf(raw: string) {
  return normalizeHistoryDate(raw) || raw;
}

function ownerOf(routes: RouteRow[], route: string) {
  return routes.find((row) => sameRoute(row.name, route))?.collectorRef || "";
}

function daySource(src: WeeklyReportSources, collectorRef: string, date: string): DayCashSources {
  const collector = src.collectors.find((row) => row.ref === collectorRef);
  return {
    ...src,
    collectors: collector ? [collector] : [],
    collectorRef,
    collectorName: collector?.name,
    date,
  };
}

function groupPaymentsByLoan(payments: PaymentRow[]) {
  const byLoan = new Map<string, PaymentRow[]>();
  for (const row of payments) {
    if (!row.loanRef) continue;
    const list = byLoan.get(row.loanRef);
    if (list) list.push(row);
    else byLoan.set(row.loanRef, [row]);
  }
  return byLoan;
}

function loanBalanceAt(loan: LoanRow, loanPayments: PaymentRow[], date: string) {
  const known = loanPayments.filter((row) => {
    const iso = paymentRecaudoIso(row);
    return Boolean(iso) && iso <= date;
  });
  return computeLoanFinancials(syncLoan(loan, known) as LoanRow, known).balancePending;
}

type CarteraInput = {
  src: WeeklyReportSources;
  range: WeeklyRange;
  route: string;
  topUpLoanRefs: ReadonlySet<string>;
  paymentsByLoan: Map<string, PaymentRow[]>;
};

function routeCartera({ src, range, route, topUpLoanRefs, paymentsByLoan }: CarteraInput): WeeklyRouteCartera {
  const before = addCalendarDaysIso(range.start, -1);
  const loansByClient = new Map<string, LoanRow[]>();
  for (const loan of src.loans) {
    if (!loan.clientRef || isLoanVoided(loan)) continue;
    const iso = loanDisbursementIsoDate(loan);
    if (!iso || iso > range.end) continue;
    const list = loansByClient.get(loan.clientRef);
    if (list) list.push(loan);
    else loansByClient.set(loan.clientRef, [loan]);
  }
  const rows = clientsOnRouteSorted(src.clients, route)
    .filter((client) => !isClientDeletedStatus(client))
    .map((client): WeeklyClientRow => {
      const loans = loansByClient.get(client.ref) ?? [];
      let debt = 0;
      let prevDebt = 0;
      let paidWeek = 0;
      const marks = new Set<WeeklyMark>();
      for (const loan of loans) {
        const loanPayments = paymentsByLoan.get(loan.ref) ?? [];
        const iso = loanDisbursementIsoDate(loan);
        const atEnd = Math.max(0, loanBalanceAt(loan, loanPayments, range.end));
        const atStart = iso <= before ? Math.max(0, loanBalanceAt(loan, loanPayments, before)) : 0;
        debt += atEnd;
        prevDebt += atStart;
        for (const pay of loanPayments) {
          const paid = paymentRecaudoIso(pay);
          if (paid >= range.start && paid <= range.end) paidWeek += Number(pay.amount) || 0;
        }
        if (iso >= range.start) {
          const renewed = loans.some((other) => other !== loan && loanDisbursementIsoDate(other) < iso);
          marks.add(renewed ? "R" : "N");
        }
        if (atStart > 0 && atEnd === 0) marks.add("F");
        if (topUpLoanRefs.has(loan.ref)) marks.add("A");
      }
      if (prevDebt > 0 && paidWeek === 0) marks.add("NP");
      return {
        ref: client.ref,
        order: client.routeOrder || 0,
        name: `${client.name} ${client.lastName}`.trim() || client.ref,
        debt: debt > 0 ? pesos(debt) : null,
        paidWeek: pesos(paidWeek),
        marks: [...marks],
      };
    });
  const owner = ownerOf(src.routes, route);
  return {
    route,
    collectorName: src.collectors.find((row) => row.ref === owner)?.name ?? "",
    rows,
    total: pesos(rows.reduce((sum, row) => sum + (row.debt ?? 0), 0)),
    owing: rows.filter((row) => row.debt != null).length,
  };
}

type Acc = {
  efectivo: Record<string, number>;
  prestamos: Record<string, number>;
  gastos: Record<string, number>;
  cobroEfectivo: Record<string, number>;
  cobroDigital: Record<string, number>;
  loanCount: Record<string, number>;
  loanEfectivo: Record<string, number>;
  loanDigital: Record<string, number>;
  gastoByLabel: Map<string, Record<string, number>>;
};

function emptyAcc(routes: string[]): Acc {
  const zero = () => Object.fromEntries(routes.map((route) => [route, 0])) as Record<string, number>;
  return {
    efectivo: zero(),
    prestamos: zero(),
    gastos: zero(),
    cobroEfectivo: zero(),
    cobroDigital: zero(),
    loanCount: zero(),
    loanEfectivo: zero(),
    loanDigital: zero(),
    gastoByLabel: new Map(),
  };
}

function gastoLabel(raw: string) {
  const clean = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Otros";
}

function addGastoLines(acc: Acc, routes: string[], route: string, lines: RouteExpenseLine[]) {
  for (const line of lines) {
    const label = gastoLabel(line.label);
    const row = acc.gastoByLabel.get(label) ?? Object.fromEntries(routes.map((name) => [name, 0]));
    row[route] = (row[route] ?? 0) + (Number(line.amount) || 0);
    acc.gastoByLabel.set(label, row);
  }
}

function addCashLoans(acc: Acc, route: string, rows: DayLoanDisbursementRow[], topUps: DayLoanDisbursementRow[]) {
  for (const row of rows) {
    acc.loanEfectivo[route] += row.capital;
    if (row.topUp) topUps.push(row);
    else acc.loanCount[route] += 1;
  }
}

type RouteMove = { efectivo: number; prestamos: number; gastos: number; gastoLines: RouteExpenseLine[]; loanRows: DayLoanDisbursementRow[] };

function addMove(acc: Acc, routes: string[], route: string, move: RouteMove, topUps: DayLoanDisbursementRow[]) {
  acc.efectivo[route] += move.efectivo;
  acc.prestamos[route] += move.prestamos;
  acc.gastos[route] += move.gastos;
  addGastoLines(acc, routes, route, move.gastoLines);
  addCashLoans(acc, route, move.loanRows, topUps);
}

function poolAt(src: WeeklyReportSources, pool: DigitalPool, date: string) {
  return digitalPoolBalances({
    payments: src.payments.filter((row) => {
      const iso = paymentRecaudoIso(row);
      return Boolean(iso) && iso <= date;
    }),
    loans: src.loans.filter((loan) => {
      const iso = loanDisbursementIsoDate(loan);
      return Boolean(iso) && iso <= date;
    }),
    clients: src.clients,
    collectors: src.collectors,
    collectorRefs: src.collectors.map((row) => row.ref),
    dayCloses: src.dayCloses.filter((row) => isoOf(row.date) <= date),
  })[pool];
}

function adjustmentLine(label: string, date: string, adj: RouteCashAdjustment | { calculated: number; real: number; by: string; reason: string }) {
  return `Ajuste ${label} ${isoToDisplay(date).slice(0, 5)}: ${money(adj.calculated)} → ${money(adj.real)} (${adj.by || "—"}${adj.reason ? ` · «${adj.reason}»` : ""})`;
}

function movementOf(
  kind: InformeHistoryKind,
  days: Array<{ date: string; total: number } & Partial<Record<string, number | string>>>,
  routes: string[],
): WeeklyMovement {
  const rows = days
    .map((day): WeeklyMovementDay => ({
      date: day.date,
      values: Object.fromEntries(
        routes.map((route) => [route, routes.length === 1 ? day.total : Number(day[route]) || 0]),
      ),
      total: day.total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    kind,
    label: MOVEMENT_LABELS[kind],
    days: rows,
    total: pesos(rows.reduce((sum, row) => sum + row.total, 0)),
  };
}

export function buildWeeklyReport(
  src: WeeklyReportSources,
  scope: WeeklyReportScope,
  range: WeeklyRange,
  today: string,
): WeeklyReport {
  const routes = WEEKLY_SCOPE_ROUTES[scope];
  const pool: DigitalPool = scope === "a" ? "nequi" : "banco";
  const acc = emptyAcc(routes);
  const topUps: DayLoanDisbursementRow[] = [];
  const novedades: string[] = [];

  const chainRef = scope === "mtn" ? ownerOf(src.routes, "M") || ownerOf(src.routes, "T") : "";
  const ownRoute = scope === "a" ? "A" : "N";
  const ownRef = ownerOf(src.routes, ownRoute);
  const owners = [...new Set([chainRef, ownRef].filter(Boolean))];
  const nameOf = (ref: string) => src.collectors.find((row) => row.ref === ref)?.name ?? ref;

  for (const date of range.days) {
    if (chainRef) {
      const ledger = buildDayCashLedger(daySource(src, chainRef, date));
      if (ledger.chain) {
        addMove(acc, routes, "M", ledger.m, topUps);
        addMove(acc, routes, "T", ledger.t, topUps);
      }
    }
    if (ownRef) addMove(acc, routes, ownRoute, independentRouteMovement(daySource(src, ownRef, date), ownRoute), topUps);
    for (const ref of owners) {
      const day = daySource(src, ref, date);
      for (const route of routes) {
        const by = routeCollectedByMethod(day, route);
        acc.cobroEfectivo[route] += by.efectivo;
        acc.cobroDigital[route] += by.banco + by.nequi;
      }
      if (date < today && !findFullDayCieClose(src.dayCloses, ref, date)) {
        novedades.push(`Sin cierre: ${nameOf(ref)} el ${isoToDisplay(date).slice(0, 5)}`);
      }
    }
    for (const route of routes) {
      for (const row of dayDigitalLoanRows(date, route, src.loans, src.clients)) {
        acc.loanDigital[route] += row.capital;
        acc.loanCount[route] += 1;
      }
    }
  }

  const topUpLoanRefs = new Set(topUps.map((row) => row.loanRef));
  const paymentsByLoan = groupPaymentsByLoan(livePayments(src.payments));
  const cartera = routes.map((route) => routeCartera({ src, range, route, topUpLoanRefs, paymentsByLoan }));
  const carteraTotal = pesos(cartera.reduce((sum, row) => sum + row.total, 0));

  const caja: WeeklyCajaRow[] = [];
  let efectivoResumen: WeeklyResumenLine[] = [];
  if (chainRef) {
    const first = buildDayCashLedger(daySource(src, chainRef, range.start));
    const last = buildDayCashLedger(daySource(src, chainRef, range.end));
    const cie = findFullDayCieClose(src.dayCloses, chainRef, range.end);
    const closing = cie ? pesos(Number(cie.cashFloat)) : last.dayFinal;
    caja.push(
      cajaRow({
        label: "M + T (cadena)",
        opening: first.mOpening.kind === "chain" ? first.mOpening.opening : null,
        efectivo: pesos(acc.efectivo.M + acc.efectivo.T),
        prestamos: pesos(acc.prestamos.M + acc.prestamos.T),
        gastos: pesos(acc.gastos.M + acc.gastos.T),
        closing,
      }),
    );
    for (const route of ["M", "T"]) {
      caja.push(
        cajaRow({
          label: `de ${route}`,
          opening: null,
          efectivo: pesos(acc.efectivo[route]),
          prestamos: pesos(acc.prestamos[route]),
          gastos: pesos(acc.gastos[route]),
          closing: null,
          sub: true,
        }),
      );
    }
    efectivoResumen.push({ label: "T (saldo final, incluye M)", value: closing, tone: "sub" });
  }
  if (ownRef) {
    const first = independentRouteDay(daySource(src, ownRef, range.start), ownRoute);
    const last = independentRouteDay(daySource(src, ownRef, range.end), ownRoute);
    const closing = last.adjustment?.real ?? last.closing;
    caja.push(
      cajaRow({
        label: ownRoute,
        opening: first.opening,
        efectivo: pesos(acc.efectivo[ownRoute]),
        prestamos: pesos(acc.prestamos[ownRoute]),
        gastos: pesos(acc.gastos[ownRoute]),
        closing,
      }),
    );
    efectivoResumen.push({ label: scope === "a" ? "A (saldo final)" : "N", value: closing, tone: "sub" });
  }
  const efectivoTotal = pesos(efectivoResumen.reduce((sum, row) => sum + row.value, 0));
  efectivoResumen = [
    ...efectivoResumen,
    { label: scope === "a" ? "Total efectivo" : "Total efectivo (T + N)", value: efectivoTotal, tone: "total" },
  ];

  const cobros = routes.map((route): WeeklyCobroRow => {
    const efectivo = pesos(acc.cobroEfectivo[route]);
    const digital = pesos(acc.cobroDigital[route]);
    return { route, efectivo, digital, total: pesos(efectivo + digital) };
  });
  const prestamos = routes.map((route): WeeklyLoanRow => ({
    route,
    count: acc.loanCount[route],
    capital: pesos(acc.loanEfectivo[route] + acc.loanDigital[route]),
    efectivo: pesos(acc.loanEfectivo[route]),
    digital: pesos(acc.loanDigital[route]),
  }));
  const gastos = [...acc.gastoByLabel.entries()]
    .map(([label, byRoute]): WeeklyGastoRow => ({
      label,
      byRoute,
      total: pesos(Object.values(byRoute).reduce((sum, value) => sum + value, 0)),
    }))
    .sort((a, b) => b.total - a.total);

  const poolOpening = poolAt(src, pool, addCalendarDaysIso(range.start, -1));
  const poolClosing = poolAt(src, pool, range.end);
  const entro = pesos(cobros.reduce((sum, row) => sum + row.digital, 0));
  const salio = pesos(prestamos.reduce((sum, row) => sum + row.digital, 0));
  const poolLabel = pool === "nequi" ? "Nequi" : "Banco";

  const scopeRoutes = new Set(routes.map((route) => route.toUpperCase()));
  const poolRoute = pool === "nequi" ? "POOL-NEQUI" : "POOL-BANCO";
  const seenAdjustments = new Set<string>();
  for (const close of src.dayCloses) {
    const date = isoOf(close.date);
    if (date < range.start || date > range.end || close.provisional || !close.ref.startsWith("CIE-")) continue;
    if (chainRef && close.collectorRef === chainRef && close.cashAdjustment) {
      novedades.push(adjustmentLine("caja M·T", date, close.cashAdjustment));
    }
    for (const adj of close.routeCashAdjustments ?? []) {
      const route = adj.route.trim().toUpperCase();
      if (!scopeRoutes.has(route) && route !== poolRoute) continue;
      const key = `${route}|${date}|${adj.at}`;
      if (seenAdjustments.has(key)) continue;
      seenAdjustments.add(key);
      novedades.push(adjustmentLine(route === poolRoute ? poolLabel : `caja ${route}`, date, adj));
    }
  }
  const clientByRef = new Map(src.clients.map((row) => [row.ref, row]));
  const loanByRef = new Map(src.loans.map((row) => [row.ref, row]));
  for (const pay of livePayments(src.payments)) {
    if (!isLatePayment(pay)) continue;
    const paid = paymentRecaudoIso(pay);
    if (paid < range.start || paid > range.end) continue;
    const client = clientByRef.get(loanByRef.get(pay.loanRef ?? "")?.clientRef ?? "");
    if (!client || !routes.some((route) => sameRoute(client.route, route))) continue;
    novedades.push(
      `Pago tardío: ${client.name} ${client.lastName}`.trim() +
        ` · ${pay.loanRef} · cubre ${isoToDisplay(pay.lateFor?.date ?? "").slice(0, 5)} · ${money(Number(pay.amount) || 0)}`,
    );
  }
  for (const row of topUps) {
    novedades.push(`Anexo: ${row.clientName} · ${row.loanRef} · +${money(row.capital)}`);
  }

  const resumen: WeeklyResumenRow[] = [
    { kind: "section", label: "Cartera" },
    ...cartera.map((row): WeeklyResumenRow => ({ kind: "line", label: row.route, value: row.total, tone: "sub" })),
    { kind: "line", label: "Total cartera", value: carteraTotal, tone: "total" },
    { kind: "section", label: "Efectivo" },
    ...efectivoResumen.map((row): WeeklyResumenRow => ({ kind: "line", ...row })),
    { kind: "section", label: poolLabel },
    { kind: "line", label: poolLabel, value: poolClosing, tone: "total" },
    { kind: "section", label: "Gran total" },
    {
      kind: "line",
      label: `Cartera + efectivo + ${poolLabel.toLowerCase()}`,
      value: pesos(carteraTotal + efectivoTotal + poolClosing),
      tone: "grand",
    },
  ];

  const history =
    scope === "a"
      ? informeOwnRouteHistory(src, ownRef ? [ownRef] : [], "A", range.start, range.end)
      : informeRouteHistory(src, owners, range.start, range.end);
  const movimiento = (["cobrado", "prestamo", "gasto"] as const).map((kind) =>
    movementOf(kind, history[kind].days, routes),
  );

  return {
    scope,
    range,
    routes,
    cartera,
    carteraTotal,
    caja,
    cobros,
    prestamos,
    gastos,
    pool: {
      label: poolLabel,
      opening: poolOpening,
      entro,
      salio,
      ajustes: pesos(poolClosing - (poolOpening + entro - salio)),
      closing: poolClosing,
    },
    novedades,
    resumen,
    movimiento,
  };
}
