/**
 * Ajuste de saldo real en T (supervisor / admin).
 *
 * Vive en el CIE- de hoy: `cashFloat` = caja contada (`real`), y `cashAdjustment`
 * guarda el saldo que selló el cierre (`calculated`), quién, cuándo y por qué.
 * Por la regla de inicio, ese `cashFloat` es el Inicial de M de mañana.
 *
 * En la nube viaja como una entrada `AJUSTE:` en `movement_refs` (columna existente).
 */
import type { CashAdjustment, CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";

const ADJUSTMENT_PREFIX = "AJUSTE:";
const FIELD_SEP = "|";

function cleanField(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

export function encodeCashAdjustmentRef(adj: CashAdjustment): string {
  const fields = [
    String(Math.round(adj.calculated)),
    String(Math.round(adj.real)),
    cleanField(adj.at),
    cleanField(adj.by),
    cleanField(adj.reason),
  ];
  return `${ADJUSTMENT_PREFIX}${fields.join(FIELD_SEP)}`;
}

function parseCashAdjustmentRef(entry: string): CashAdjustment | null {
  if (!entry.startsWith(ADJUSTMENT_PREFIX)) return null;
  const [calculated = "", real = "", at = "", by = "", ...reason] = entry
    .slice(ADJUSTMENT_PREFIX.length)
    .split(FIELD_SEP);
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

/** `movement_refs` de nube → refs de movimientos + ajuste (si hay). */
export function splitCashAdjustmentRefs(refs: string[]): {
  movementRefs: string[];
  cashAdjustment?: CashAdjustment;
} {
  const movementRefs: string[] = [];
  let cashAdjustment: CashAdjustment | undefined;
  for (const entry of refs) {
    const text = String(entry ?? "");
    if (text.startsWith(ADJUSTMENT_PREFIX)) {
      cashAdjustment = parseCashAdjustmentRef(text) ?? cashAdjustment;
      continue;
    }
    movementRefs.push(text);
  }
  return { movementRefs, cashAdjustment };
}

/** Refs de movimientos + ajuste → `movement_refs` para la nube. */
export function joinCashAdjustmentRefs(
  movementRefs: string[],
  adj: CashAdjustment | undefined,
): string[] {
  const base = movementRefs.filter((entry) => !String(entry).startsWith(ADJUSTMENT_PREFIX));
  return adj ? [...base, encodeCashAdjustmentRef(adj)] : base;
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
