/**
 * Ajuste de saldo real en T (supervisor / admin).
 *
 * Vive en el CIE- de hoy: `cashFloat` = caja contada (`real`), y `cashAdjustment`
 * guarda el saldo que selló el cierre (`calculated`), quién, cuándo y por qué.
 * Por la regla de inicio, ese `cashFloat` es el Inicial de M de mañana.
 *
 * Planillas fuera de la cadena (A, N): `routeCashAdjustments` en el mismo CIE-, uno por ruta.
 *
 * En la nube viajan como entradas `AJUSTE:` (T) y `AJUSTE@<ruta>:` (A, N) en
 * `movement_refs` (columna existente).
 */
import type {
  CashAdjustment,
  CollectorDayCloseRecord,
  RouteCashAdjustment,
} from "@/lib/collector-day-close";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";

const ADJUSTMENT_PREFIX = "AJUSTE:";
const ROUTE_ADJUSTMENT_PREFIX = "AJUSTE@";
const FIELD_SEP = "|";

function cleanField(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function routeKey(route: string) {
  return cleanField(route).replace(/:/g, "").toUpperCase();
}

function encodeAdjustmentFields(adj: CashAdjustment): string {
  return [
    String(Math.round(adj.calculated)),
    String(Math.round(adj.real)),
    cleanField(adj.at),
    cleanField(adj.by),
    cleanField(adj.reason),
  ].join(FIELD_SEP);
}

function parseAdjustmentFields(body: string): CashAdjustment | null {
  const [calculated = "", real = "", at = "", by = "", ...reason] = body.split(FIELD_SEP);
  const calc = Number(calculated);
  const realNum = Number(real);
  if (!Number.isFinite(calc) || !Number.isFinite(realNum) || !at.trim()) return null;
  return {
    calculated: calc,
    real: realNum,
    at: at.trim(),
    by: by.trim(),
    reason: reason.join(FIELD_SEP).trim(),
  };
}

export function encodeCashAdjustmentRef(adj: CashAdjustment): string {
  return `${ADJUSTMENT_PREFIX}${encodeAdjustmentFields(adj)}`;
}

export function encodeRouteCashAdjustmentRef(adj: RouteCashAdjustment): string {
  return `${ROUTE_ADJUSTMENT_PREFIX}${routeKey(adj.route)}:${encodeAdjustmentFields(adj)}`;
}

function parseRouteCashAdjustmentRef(entry: string): RouteCashAdjustment | null {
  const rest = entry.slice(ROUTE_ADJUSTMENT_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const adj = parseAdjustmentFields(rest.slice(sep + 1));
  return adj ? { ...adj, route: rest.slice(0, sep) } : null;
}

function isAdjustmentEntry(entry: string) {
  return entry.startsWith(ADJUSTMENT_PREFIX) || entry.startsWith(ROUTE_ADJUSTMENT_PREFIX);
}

function adjustmentMs(adj: CashAdjustment | undefined) {
  const ms = Date.parse(String(adj?.at || ""));
  return Number.isFinite(ms) ? ms : 0;
}

/** Un ajuste por ruta: gana el más reciente. Ningún aparato borra el de otro. */
export function mergeRouteCashAdjustments(
  ...lists: Array<RouteCashAdjustment[] | undefined>
): RouteCashAdjustment[] | undefined {
  const byRoute = new Map<string, RouteCashAdjustment>();
  for (const list of lists) {
    for (const adj of list ?? []) {
      const key = routeKey(adj.route);
      if (!key) continue;
      const prev = byRoute.get(key);
      if (!prev || adjustmentMs(adj) > adjustmentMs(prev)) byRoute.set(key, adj);
    }
  }
  if (!byRoute.size) return undefined;
  return [...byRoute.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, adj]) => adj);
}

/** Firma estable de los ajustes por ruta (comparar nube vs local). */
export function routeCashAdjustmentsSig(list: RouteCashAdjustment[] | undefined) {
  return (mergeRouteCashAdjustments(list) ?? [])
    .map((adj) => `${routeKey(adj.route)}@${adj.at}@${Math.round(adj.real)}`)
    .join(",");
}

/** `movement_refs` de nube → refs de movimientos + ajustes (si hay). */
export function splitCashAdjustmentRefs(refs: string[]): {
  movementRefs: string[];
  cashAdjustment?: CashAdjustment;
  routeCashAdjustments?: RouteCashAdjustment[];
} {
  const movementRefs: string[] = [];
  let cashAdjustment: CashAdjustment | undefined;
  const routeAdjustments: RouteCashAdjustment[] = [];
  for (const entry of refs) {
    const text = String(entry ?? "");
    if (text.startsWith(ROUTE_ADJUSTMENT_PREFIX)) {
      const adj = parseRouteCashAdjustmentRef(text);
      if (adj) routeAdjustments.push(adj);
      continue;
    }
    if (text.startsWith(ADJUSTMENT_PREFIX)) {
      cashAdjustment = parseAdjustmentFields(text.slice(ADJUSTMENT_PREFIX.length)) ?? cashAdjustment;
      continue;
    }
    movementRefs.push(text);
  }
  return {
    movementRefs,
    cashAdjustment,
    routeCashAdjustments: mergeRouteCashAdjustments(routeAdjustments),
  };
}

/** Refs de movimientos + ajustes → `movement_refs` para la nube. */
export function joinCashAdjustmentRefs(
  movementRefs: string[],
  adj: CashAdjustment | undefined,
  routeAdjustments?: RouteCashAdjustment[],
): string[] {
  const base = movementRefs.filter((entry) => !isAdjustmentEntry(String(entry)));
  const withT = adj ? [...base, encodeCashAdjustmentRef(adj)] : base;
  const perRoute = mergeRouteCashAdjustments(routeAdjustments) ?? [];
  return [...withT, ...perRoute.map(encodeRouteCashAdjustmentRef)];
}

/** Marca de tiempo del CIE-: el ajuste es más fresco que el cierre que ajusta. */
export function dayCloseFreshnessMs(closedAt: string | undefined, adj: CashAdjustment | undefined) {
  const closed = Date.parse(String(closedAt || ""));
  const adjusted = Date.parse(String(adj?.at || ""));
  const values = [closed, adjusted].filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : Number.NaN;
}

export function cashAdjustmentDelta(adj: CashAdjustment) {
  return Math.round(adj.real - adj.calculated);
}

function isoDayLabel(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export type HistoryRowWithAdjustment<T> = { row: T; adjustment: CashAdjustment | null };

/**
 * Historial · T: el renglón del día muestra el saldo que selló el cierre y, si hubo
 * ajuste, va seguido de su renglón (saldo real = Inicial M del día siguiente).
 */
export function attachCashAdjustments<T extends { date: string; saldo: number }>(
  rows: T[],
  collectorRef: string,
  dayCloses: CollectorDayCloseRecord[],
): HistoryRowWithAdjustment<T>[] {
  return rows.map((row) => {
    const adjustment = findFullDayCieClose(dayCloses, collectorRef, row.date)?.cashAdjustment ?? null;
    return adjustment
      ? { row: { ...row, saldo: adjustment.calculated }, adjustment }
      : { row, adjustment: null };
  });
}

/** Nota visible del renglón de ajuste. */
export function cashAdjustmentNote(adj: CashAdjustment): string {
  const at = adj.at ? ` el ${isoDayLabel(adj.at)}` : "";
  const reason = adj.reason ? ` · ${adj.reason}` : "";
  return `Ajuste de saldo · por ${adj.by || "—"}${at}${reason}`;
}
