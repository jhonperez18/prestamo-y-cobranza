/**
 * Informe del supervisor → historial diario de Cobrado / Préstamo / Gasto por ruta (M · T · N).
 * Solo lee a los dueños de cada cifra; aquí no hay fórmula propia:
 *   Cobrado  = `routeCobradoAcrossCollectors` (efectivo de cada cobrador + Banco/Nequi de la ruta, una vez).
 *   Préstamo = efectivo del libro (`buildDayCashLedger().m/.t`, N: `independentRouteMovement`)
 *              + Banco / Nequi (`dayDigitalLoanRows`, por ruta del cliente).
 *   Gasto    = gastos operativos del libro (M / T) o de la caja de N (sin capital prestado).
 * A lleva dinero aparte y no entra.
 */
import { normalizeHistoryDate } from "@/lib/collector-day-close";
import {
  chainDayMovements,
  routeCobradoAcrossCollectors,
  type DayCashSources,
} from "@/lib/day-cash-ledger";
import type { DayLoanDisbursementRow } from "@/lib/collector-history-planilla";
import { dayDigitalLoanRows, digitalLoanPoolForRoute } from "@/lib/day-digital-loans";
import { pesos } from "@/lib/finance";
import {
  collectorGastosGoToChain,
  independentRouteMovement,
} from "@/lib/independent-route-cash";

export const INFORME_HISTORY_ROUTES = ["T", "M", "N"] as const;
export type InformeHistoryRoute = (typeof INFORME_HISTORY_ROUTES)[number];
export type InformeHistoryKind = "cobrado" | "prestamo" | "gasto";

export type InformeDayRow = Record<InformeHistoryRoute, number> & { date: string; total: number };

/** Un préstamo que entra al botón. La referencia no se pierde al sumar. */
export type InformePrestamoSource = "efectivo" | "banco" | "nequi";
export type InformePrestamoLine = {
  ref: string;
  date: string;
  route: string;
  capital: number;
  source: InformePrestamoSource;
  anexo: boolean;
  name: string;
};

export type InformeKindBucket<Day> = { days: Day[]; total: number; lines?: InformePrestamoLine[] };
export type InformeHistory = Record<InformeHistoryKind, InformeKindBucket<InformeDayRow>>;

export function informePrestamoSourceLabel(source: InformePrestamoSource): string {
  if (source === "efectivo") return "Efectivo";
  if (source === "banco") return "Banco";
  return "Nequi";
}

function prestamoLine(
  date: string,
  route: string,
  row: DayLoanDisbursementRow,
  source: InformePrestamoSource,
): InformePrestamoLine {
  return {
    ref: row.loanRef,
    date,
    route,
    capital: pesos(row.capital),
    source,
    anexo: Boolean(row.topUp),
    name: row.clientName,
  };
}

export type InformeHistorySources = Omit<DayCashSources, "collectorRef" | "collectorName" | "date" | "fallbackOpening">;

type DayAcc = Record<InformeHistoryKind, Record<InformeHistoryRoute, number>>;

function nextIsoDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1)).toISOString().slice(0, 10);
}

function groupByDay<Row>(
  rows: readonly Row[],
  dateOf: (row: Row) => string,
  start: string,
  end: string,
): Map<string, Row[]> {
  const byDay = new Map<string, Row[]>();
  for (const row of rows) {
    const raw = dateOf(row);
    const day = normalizeHistoryDate(raw) || raw;
    if (!day || day < start || day > end) continue;
    const list = byDay.get(day);
    if (list) list.push(row);
    else byDay.set(day, [row]);
  }
  return byDay;
}

function emptyDay(): DayAcc {
  const zero = () => ({ T: 0, M: 0, N: 0 });
  return { cobrado: zero(), prestamo: zero(), gasto: zero() };
}

function collectorDay(src: DayCashSources, acc: DayAcc, lines: InformePrestamoLine[], date: string) {
  if (collectorGastosGoToChain(src)) {
    const { m, t } = chainDayMovements(src);
    acc.prestamo.M += m.prestamos;
    acc.prestamo.T += t.prestamos;
    acc.gasto.M += m.gastos;
    acc.gasto.T += t.gastos;
    for (const row of m.loanRows) lines.push(prestamoLine(date, "M", row, "efectivo"));
    for (const row of t.loanRows) lines.push(prestamoLine(date, "T", row, "efectivo"));
  }
  const n = independentRouteMovement(src, "N");
  acc.prestamo.N += n.prestamos;
  acc.gasto.N += n.gastos;
  for (const row of n.loanRows) lines.push(prestamoLine(date, "N", row, "efectivo"));
}

/** Días de `from` a `to` (ISO) con movimiento, del más reciente al más viejo. */
export function informeRouteHistory(
  src: InformeHistorySources,
  collectorRefs: readonly string[],
  from: string,
  to: string,
): InformeHistory {
  const out: InformeHistory = {
    cobrado: { days: [], total: 0 },
    prestamo: { days: [], total: 0, lines: [] },
    gasto: { days: [], total: 0 },
  };
  const lines: InformePrestamoLine[] = [];
  const start = normalizeHistoryDate(from) || from;
  const end = normalizeHistoryDate(to) || to;
  // Cada lectura filtra la planilla por cobrador + `dispatchDate` y los cobros por `paidDate`:
  // darle solo los de ese cobrador y día da lo mismo y evita recorrer todo el mes en cada cuenta.
  const assignmentsByDay = groupByDay(src.assignments, (row) => row.dispatchDate, start, end);
  const paymentsByDay = groupByDay(src.payments, (row) => row.paidDate || "", start, end);
  for (let date = start; date <= end; date = nextIsoDay(date)) {
    const acc = emptyDay();
    const dayAssignments = assignmentsByDay.get(date) ?? [];
    const payments = paymentsByDay.get(date) ?? [];
    // Un cobrador con varias rutas (M, T, A) llega una vez por ruta: se cuenta una sola vez.
    const daySrc: DayCashSources = {
      ...src,
      assignments: dayAssignments,
      payments,
      date,
      collectorRef: "",
    };
    for (const collectorRef of new Set(collectorRefs)) {
      const collector = src.collectors.find((row) => row.ref === collectorRef);
      if (!collector) continue;
      collectorDay(
        {
          ...daySrc,
          assignments: dayAssignments.filter((row) => row.collectorRef === collectorRef),
          collectors: [collector],
          collectorRef,
          collectorName: collector.name,
        },
        acc,
        lines,
        date,
      );
    }
    for (const route of INFORME_HISTORY_ROUTES) {
      acc.cobrado[route] += routeCobradoAcrossCollectors(daySrc, route, collectorRefs).total;
    }
    for (const route of INFORME_HISTORY_ROUTES) {
      const pool = digitalLoanPoolForRoute(route);
      for (const row of dayDigitalLoanRows(date, route, src.loans, src.clients)) {
        acc.prestamo[route] += row.capital;
        lines.push(prestamoLine(date, route, row, pool));
      }
    }
    for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
      const day = acc[kind];
      if (day.T === 0 && day.M === 0 && day.N === 0) continue;
      const total = pesos(day.T + day.M + day.N);
      out[kind].days.push({ date, T: pesos(day.T), M: pesos(day.M), N: pesos(day.N), total });
      out[kind].total = pesos(out[kind].total + total);
    }
  }
  for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
    out[kind].days.sort((a, b) => b.date.localeCompare(a.date));
  }
  lines.sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref, "es"));
  out.prestamo.lines = lines;
  return out;
}

export type InformeRouteDayRow = { date: string; total: number };
export type InformeRouteHistory = Record<InformeHistoryKind, InformeKindBucket<InformeRouteDayRow>>;

/**
 * Informe de una planilla con caja propia (A · Angélica), día a día de `from` a `to`.
 * Cada día = el Cierre del día de la ruta (Historial → día), mismas funciones:
 *   Cobrado  = «Lo que cobró» (`routeCobradoDayTotal`, efectivo + pool, con Caja/oficina).
 *   Préstamo = «Lo que prestó» (`prestamosRuta`: efectivo + Banco/Nequi de la planilla).
 *   Gasto    = «Lo que gastó» (`independentRouteMovement`; un gasto marcado en A sale de A).
 */
export function informeOwnRouteHistory(
  src: InformeHistorySources,
  collectorRefs: readonly string[],
  route: string,
  from: string,
  to: string,
): InformeRouteHistory {
  const out: InformeRouteHistory = {
    cobrado: { days: [], total: 0 },
    prestamo: { days: [], total: 0, lines: [] },
    gasto: { days: [], total: 0 },
  };
  const lines: InformePrestamoLine[] = [];
  const pool = digitalLoanPoolForRoute(route);
  const start = normalizeHistoryDate(from) || from;
  const end = normalizeHistoryDate(to) || to;
  const assignmentsByDay = groupByDay(src.assignments, (row) => row.dispatchDate, start, end);
  const paymentsByDay = groupByDay(src.payments, (row) => row.paidDate || "", start, end);
  for (let date = start; date <= end; date = nextIsoDay(date)) {
    const acc: Record<InformeHistoryKind, number> = { cobrado: 0, prestamo: 0, gasto: 0 };
    const dayAssignments = assignmentsByDay.get(date) ?? [];
    const payments = paymentsByDay.get(date) ?? [];
    for (const collectorRef of new Set(collectorRefs)) {
      const collector = src.collectors.find((row) => row.ref === collectorRef);
      if (!collector) continue;
      const day: DayCashSources = {
        ...src,
        assignments: dayAssignments.filter((row) => row.collectorRef === collectorRef),
        payments,
        collectors: [collector],
        collectorRef,
        collectorName: collector.name,
        date,
      };
      const own = independentRouteMovement(day, route);
      acc.prestamo += own.prestamosRuta;
      acc.gasto += own.gastos;
      for (const row of own.loanRows) lines.push(prestamoLine(date, route, row, "efectivo"));
      for (const row of own.digitalLoanRows) lines.push(prestamoLine(date, route, row, pool));
    }
    acc.cobrado += routeCobradoAcrossCollectors(
      {
        ...src,
        assignments: dayAssignments,
        payments,
        date,
        collectorRef: "",
      },
      route,
      collectorRefs,
    ).total;
    for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
      if (acc[kind] === 0) continue;
      const total = pesos(acc[kind]);
      out[kind].days.push({ date, total });
      out[kind].total = pesos(out[kind].total + total);
    }
  }
  for (const kind of ["cobrado", "prestamo", "gasto"] as const) {
    out[kind].days.sort((a, b) => b.date.localeCompare(a.date));
  }
  lines.sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref, "es"));
  out.prestamo.lines = lines;
  return out;
}

function isPrestamoLine(row: unknown): row is InformePrestamoLine {
  if (!row || typeof row !== "object") return false;
  const line = row as Partial<InformePrestamoLine>;
  return (
    typeof line.ref === "string" &&
    typeof line.date === "string" &&
    typeof line.route === "string" &&
    typeof line.name === "string" &&
    typeof line.capital === "number" &&
    typeof line.anexo === "boolean" &&
    (line.source === "efectivo" || line.source === "banco" || line.source === "nequi")
  );
}

function isInformeBucket(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const bucket = row as { days?: unknown; total?: unknown; lines?: unknown };
  if (!Array.isArray(bucket.days) || typeof bucket.total !== "number") return false;
  if (bucket.lines == null) return true;
  return Array.isArray(bucket.lines) && bucket.lines.every(isPrestamoLine);
}

/** La respuesta del informe del mes. Null si no trae los tres botones y la lista de préstamos. */
export function readSupervisorInformePayload(
  body: unknown,
): { general: InformeHistory; angelica: InformeRouteHistory } | null {
  if (!body || typeof body !== "object") return null;
  const row = body as { ok?: unknown; general?: unknown; angelica?: unknown };
  if (row.ok !== true || !row.general || !row.angelica) return null;
  const general = row.general as Partial<InformeHistory>;
  const angelica = row.angelica as Partial<InformeRouteHistory>;
  if (!isInformeBucket(general.cobrado) || !isInformeBucket(general.prestamo) || !isInformeBucket(general.gasto)) {
    return null;
  }
  if (!isInformeBucket(angelica.cobrado) || !isInformeBucket(angelica.prestamo) || !isInformeBucket(angelica.gasto)) {
    return null;
  }
  if (!general.prestamo?.lines || !angelica.prestamo?.lines) return null;
  return { general: general as InformeHistory, angelica: angelica as InformeRouteHistory };
}
