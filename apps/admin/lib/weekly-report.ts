/**
 * Informe semanal (corte sábado). Dos hojas: M · T · N y A aparte.
 * Solo lee a los dueños de cada cifra; aquí no hay fórmula de caja propia:
 *   Cartera   = misma que el Informe del supervisor (`portfolioBalanceForClients` /
 *               préstamos activos + pagos vivos). No fórmula aparte.
 *   Caja M·T  = libro del día (`buildDayCashLedger`); saldo final = CIE- del último día.
 *   Caja A/N  = `independentRouteDay` / `independentRouteMovement`.
 *   Cobros    = `routeCobradoAcrossCollectors` (efectivo de cada cobrador + Banco/Nequi de la ruta, una vez).
 *   Préstamos = renglones del libro (efectivo) + `dayDigitalLoanRows` (Banco / Nequi).
 *   Banco/Nequi = `digitalPoolSaldo` (rutas del mes − gastos de su cuenta), el Saldo del supervisor.
 *   Movimiento por día = `informeRouteHistory` / `informeOwnRouteHistory` (Informe del supervisor).
 */
import {
  addCalendarDaysIso,
  isColombiaHoliday,
  isDailyCollectionDay,
  utcWeekdayIndex,
} from "@/lib/colombia-holidays";
import { clientsOnRouteSorted, sameRoute } from "@/lib/client-route-order";
import { dayHasReachedAutoClose } from "@/lib/collector-day-auto-close";
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";
import { buildDayCashLedger, routeCobradoAcrossCollectors, type DayCashSources } from "@/lib/day-cash-ledger";
import { dayDigitalLoanRows } from "@/lib/day-digital-loans";
import type { BankAccount } from "@/lib/bank";
import { digitalPoolSaldo, type DigitalPool } from "@/lib/digital-pools";
import { pesos } from "@/lib/finance";
import { independentRouteDay, independentRouteMovement } from "@/lib/independent-route-cash";
import {
  informeOwnRouteHistory,
  informeRouteHistory,
  type InformeHistoryKind,
  type InformeHistorySources,
} from "@/lib/informe-route-days";
import { livePayments } from "@/lib/live-payments";
import { computeLoanFinancials } from "@/lib/loan-balance";
import { syncLoan } from "@/lib/loan-preview";
import { activeLoans, type LoanRow, type PaymentRow, type RouteRow } from "@/lib/mock-data";
import type { MiscPayment } from "@/lib/misc-payments";
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
  /** Día del corte en calendario: el sábado, o el último día del mes si llega antes. */
  cutoff: string;
  /** Último corte del mes (el siguiente día de cobro ya es de otro mes). */
  monthEnd: boolean;
  /** Primer día de cobro de la semana (lunes, o martes si el lunes es festivo). */
  start: string;
  /** Último día de cobro hasta el corte (o hasta hoy si la semana sigue abierta). */
  end: string;
  days: string[];
  holidays: string[];
  /** La semana aún no llega al sábado. */
  partial: boolean;
};

export type WeeklyClientRow = {
  ref: string;
  order: number;
  name: string;
  /** Inicio del préstamo con saldo (ISO); para mostrar (dd/mm) junto al nombre. */
  loanStart: string | null;
  /** Lo que debe al corte. `null` = sin préstamo con saldo («–»). */
  debt: number | null;
  /** Último cobro vivo del cliente con fecha ≤ corte (mismo día = suma). */
  lastPayment: { date: string; amount: number } | null;
};

/** Miles de pesos sin punto ni ceros: 200.000 → «200», 1.310.000 → «1310». */
export function weeklyMiles(value: number | null | undefined) {
  if (value == null) return "–";
  return String(Math.round(Number(value) / 1000));
}

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
/** Total de gastos operativos de la ruta en la semana (sin desglose por tipo). */
export type WeeklyGastoRow = { route: string; total: number };

export type WeeklyPool = {
  label: string;
  opening: number;
  entro: number;
  salio: number;
  /** Gastos pagados desde la cuenta del pool en la semana. */
  gastos: number;
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
  resumen: WeeklyResumenRow[];
  movimiento: WeeklyMovement[];
};

export type WeeklyReportSources = InformeHistorySources & {
  routes: RouteRow[];
  miscPayments: MiscPayment[];
  bankAccounts: BankAccount[];
};

const MOVEMENT_LABELS: Record<InformeHistoryKind, string> = {
  cobrado: "Cobrado",
  prestamo: "Préstamo",
  gasto: "Gasto",
};

function lastDayOfMonth(iso: string) {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Período del informe que contiene `day`: lunes → sábado, sin cruzar de mes.
 * Si el mes acaba a mitad de semana, el corte es el último día del mes y el día 1 abre otro.
 */
function weeklyPeriodOf(day: string) {
  const weekday = utcWeekdayIndex(day);
  const anchor = weekday === 0 ? addCalendarDaysIso(day, -1) : day;
  const monday = addCalendarDaysIso(anchor, 1 - utcWeekdayIndex(anchor));
  const saturday = addCalendarDaysIso(monday, 5);
  const monthStart = `${anchor.slice(0, 8)}01`;
  const monthLast = lastDayOfMonth(anchor);
  const cutoff = saturday > monthLast ? monthLast : saturday;
  let next = addCalendarDaysIso(cutoff, 1);
  while (!isDailyCollectionDay(next)) next = addCalendarDaysIso(next, 1);
  return {
    from: monday < monthStart ? monthStart : monday,
    cutoff,
    monthEnd: next.slice(0, 7) !== cutoff.slice(0, 7),
  };
}

/** Cortes del informe (fin de cada período), del más reciente (en curso) al más viejo. */
export function recentWeeklyCortes(today: string, count = 8): string[] {
  const cortes: string[] = [];
  let period = weeklyPeriodOf(today);
  while (cortes.length < count) {
    cortes.push(period.cutoff);
    period = weeklyPeriodOf(addCalendarDaysIso(period.from, -1));
  }
  return cortes;
}

function lastCollectionDayOf(cutoff: string) {
  let day = cutoff;
  while (!isDailyCollectionDay(day)) day = addCalendarDaysIso(day, -1);
  return day;
}

/**
 * Corte cuyo último día de cobro fue `today` o ayer (el cron de 00:05 reintenta el de 23:30),
 * solo si esa jornada ya pasó el corte de las 23:30: a las 00:05 del sábado la semana no cerró.
 * `null` si ninguno de los dos días cerró un período.
 */
export function weeklyCutoffClosedNear(today: string, now: Date): string | null {
  for (const day of [today, addCalendarDaysIso(today, -1)]) {
    const { cutoff } = weeklyPeriodOf(day);
    if (lastCollectionDayOf(cutoff) === day && dayHasReachedAutoClose(day, now)) return cutoff;
  }
  return null;
}

export function weeklyRangeForCutoff(cutoff: string, today: string): WeeklyRange {
  const period = weeklyPeriodOf(cutoff);
  const days: string[] = [];
  const holidays: string[] = [];
  for (let day = period.from; day <= period.cutoff; day = addCalendarDaysIso(day, 1)) {
    if (isColombiaHoliday(day)) holidays.push(day);
    if (isDailyCollectionDay(day) && day <= today) days.push(day);
  }
  const start = days[0] ?? period.from;
  return {
    cutoff: period.cutoff,
    monthEnd: period.monthEnd,
    start,
    end: days[days.length - 1] ?? start,
    days,
    holidays,
    partial: period.cutoff > today,
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

type CarteraInput = {
  src: WeeklyReportSources;
  range: WeeklyRange;
  route: string;
  paymentsByLoan: Map<string, PaymentRow[]>;
  /** Pagos vivos (misma lista que el Informe del supervisor). */
  live: PaymentRow[];
};

/**
 * Cartera por ruta = misma cifra que Supervisor → Informe (`portfolioBalanceForClients`):
 * solo préstamos activos, saldo con todos los cobros vivos.
 */
function routeCartera({ src, range, route, paymentsByLoan, live }: CarteraInput): WeeklyRouteCartera {
  const loansByClient = new Map<string, LoanRow[]>();
  for (const loan of activeLoans(src.loans.map((row) => syncLoan(row, live) as LoanRow))) {
    if (!loan.clientRef) continue;
    const list = loansByClient.get(loan.clientRef);
    if (list) list.push(loan);
    else loansByClient.set(loan.clientRef, [loan]);
  }
  const rows = clientsOnRouteSorted(src.clients, route)
    .filter((client) => !isClientDeletedStatus(client))
    .map((client): WeeklyClientRow => {
      const loans = loansByClient.get(client.ref) ?? [];
      let debt = 0;
      let lastDate = "";
      let lastAmount = 0;
      let loanStart = "";
      let topLoanDebt = 0;
      for (const loan of loans) {
        const bal = Math.max(0, computeLoanFinancials(loan, live).balancePending);
        debt += bal;
        const start = loanDisbursementIsoDate(loan);
        if (bal > 0 && start && bal >= topLoanDebt) {
          topLoanDebt = bal;
          loanStart = start;
        }
        for (const pay of paymentsByLoan.get(loan.ref) ?? []) {
          const paid = paymentRecaudoIso(pay);
          if (!paid || paid > range.end) continue;
          const amount = Number(pay.amount) || 0;
          if (amount <= 0) continue;
          if (paid > lastDate) {
            lastDate = paid;
            lastAmount = amount;
          } else if (paid === lastDate) {
            lastAmount += amount;
          }
        }
      }
      return {
        ref: client.ref,
        order: client.routeOrder || 0,
        name: `${client.name} ${client.lastName}`.trim() || client.ref,
        loanStart: loanStart || null,
        debt: debt > 0 ? pesos(debt) : null,
        lastPayment: lastDate ? { date: lastDate, amount: pesos(lastAmount) } : null,
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
  };
}

function addCashLoans(acc: Acc, route: string, rows: DayLoanDisbursementRow[]) {
  for (const row of rows) {
    acc.loanEfectivo[route] += row.capital;
    if (!row.topUp) acc.loanCount[route] += 1;
  }
}

type RouteMove = { efectivo: number; prestamos: number; gastos: number; loanRows: DayLoanDisbursementRow[] };

function addMove(acc: Acc, route: string, move: RouteMove) {
  acc.efectivo[route] += move.efectivo;
  acc.prestamos[route] += move.prestamos;
  acc.gastos[route] += move.gastos;
  addCashLoans(acc, route, move.loanRows);
}

/** Saldo del pool al cierre de `date`, con la ventana del mes de `monthOf` (Banco / Nequi arrancan en 0 cada mes). */
function poolAt(src: WeeklyReportSources, pool: DigitalPool, monthOf: string, date: string) {
  return digitalPoolSaldo({
    pool,
    payments: src.payments,
    loans: src.loans,
    clients: src.clients,
    dayCloses: src.dayCloses.filter((row) => isoOf(row.date) <= date),
    miscPayments: src.miscPayments,
    accounts: src.bankAccounts,
    fromIso: `${monthOf.slice(0, 7)}-01`,
    toIso: date,
  });
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
  _today: string,
): WeeklyReport {
  const routes = WEEKLY_SCOPE_ROUTES[scope];
  const pool: DigitalPool = scope === "a" ? "nequi" : "banco";
  const acc = emptyAcc(routes);

  const chainRef = scope === "mtn" ? ownerOf(src.routes, "M") || ownerOf(src.routes, "T") : "";
  const ownRoute = scope === "a" ? "A" : "N";
  const ownRef = ownerOf(src.routes, ownRoute);
  const owners = [...new Set([chainRef, ownRef].filter(Boolean))];

  for (const date of range.days) {
    if (chainRef) {
      const ledger = buildDayCashLedger(daySource(src, chainRef, date));
      if (ledger.chain) {
        addMove(acc, "M", ledger.m);
        addMove(acc, "T", ledger.t);
      }
    }
    if (ownRef) addMove(acc, ownRoute, independentRouteMovement(daySource(src, ownRef, date), ownRoute));
    const cobroDay = daySource(src, owners[0] || "", date);
    for (const route of routes) {
      const cobro = routeCobradoAcrossCollectors(cobroDay, route, owners);
      acc.cobroEfectivo[route] += cobro.efectivo;
      acc.cobroDigital[route] += cobro.digital;
    }
    for (const route of routes) {
      for (const row of dayDigitalLoanRows(date, route, src.loans, src.clients)) {
        acc.loanDigital[route] += row.capital;
        acc.loanCount[route] += 1;
      }
    }
  }

  const live = livePayments(src.payments);
  const paymentsByLoan = groupPaymentsByLoan(live);
  const cartera = routes.map((route) => routeCartera({ src, range, route, paymentsByLoan, live }));
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
  const gastos = routes.map(
    (route): WeeklyGastoRow => ({ route, total: pesos(acc.gastos[route]) }),
  );

  const poolBefore = poolAt(src, pool, range.start, addCalendarDaysIso(range.start, -1));
  const poolAfter = poolAt(src, pool, range.start, range.end);
  const poolOpening = poolBefore.saldo;
  const poolClosing = poolAfter.saldo;
  const entro = pesos(cobros.reduce((sum, row) => sum + row.digital, 0));
  const salio = pesos(prestamos.reduce((sum, row) => sum + row.digital, 0));
  const poolGastos = pesos(poolAfter.gastos - poolBefore.gastos);
  const poolLabel = pool === "nequi" ? "Nequi" : "Banco";

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
      gastos: poolGastos,
      ajustes: pesos(poolClosing - (poolOpening + entro - salio - poolGastos)),
      closing: poolClosing,
    },
    resumen,
    movimiento,
  };
}
