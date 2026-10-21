/**
 * Informe mensual guardado al cerrar la última ruta del último día de cobro.
 * Una copia por mes y por panel (General / Angélica). Ya guardada, no se reescribe.
 */
import { previousCalendarIso } from "@/lib/collector-day-auto-close";
import {
  lastCollectionDayOfPeriod,
  normalizeHistoryDate,
} from "@/lib/collector-day-close";
import { sameRoute } from "@/lib/client-route-order";
import { assignmentRouteName } from "@/lib/collector-dispatch-sync";
import type { InformeHistory, InformeRouteHistory } from "@/lib/informe-route-days";
import type { DigitalPoolGasto } from "@/lib/digital-pools";
import type { ClientRow } from "@/lib/mock-data";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";

export const INFORME_SNAPSHOT_ROUTES = ["M", "T", "N", "A"] as const;

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
] as const;

export type InformeSnapshotScope = "general" | "angelica";

export type InformeSnapshotRow = {
  kind: "section" | "line";
  label: string;
  value?: number;
  tone?: "sub" | "total" | "grand";
};

export type InformeMonthSnapshot = {
  ref: string;
  scope: InformeSnapshotScope;
  period: string;
  sealedOn: string;
  corteLabel: string;
  rows: InformeSnapshotRow[];
  history: InformeHistory | InformeRouteHistory;
  poolGastos: DigitalPoolGasto[];
  poolGastado: number;
};

export function informeSnapshotRef(scope: InformeSnapshotScope, period: string) {
  return scope === "general" ? `INF-GENERAL-${period}` : `INF-A-${period}`;
}

export function informePeriodName(period: string) {
  const month = Number(period.slice(5, 7));
  return MONTHS[month - 1] ?? period;
}

/**
 * Día que toca guardar, o null si hoy no es esa noche ni la semana siguiente.
 * El último día de cobro del mes, y los primeros 7 del mes nuevo por si esa noche falló.
 * No rellena meses más viejos.
 */
export function informeSnapshotDay(businessDate: string): string | null {
  const period = businessDate.slice(0, 7);
  const last = lastCollectionDayOfPeriod(period);
  if (last && businessDate === last) return last;
  const dayNum = Number(businessDate.slice(8, 10));
  if (!Number.isFinite(dayNum) || dayNum > 7) return null;
  const prev = previousCalendarIso(`${period}-01`);
  const prevLast = lastCollectionDayOfPeriod(prev.slice(0, 7));
  if (prevLast && businessDate > prevLast) return prevLast;
  return null;
}

function pinOf(route: string) {
  return INFORME_SNAPSHOT_ROUTES.find((pin) => sameRoute(pin, route)) ?? null;
}

/** La última ruta del día ya cerró: cada hoja M/T/N/A que trabajó tiene la visita sellada. */
export function informeMonthReady(
  assignments: readonly DailyCollectionAssignment[],
  clients: readonly ClientRow[],
  date: string,
) {
  const day = normalizeHistoryDate(date) || date;
  let worked = 0;
  for (const row of assignments) {
    const dispatch = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
    if (dispatch !== day) continue;
    const pin = pinOf(assignmentRouteName(row, clients as ClientRow[]));
    if (!pin) continue;
    worked += 1;
    if (!row.dayClosedAt) return false;
  }
  return worked > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function readRows(raw: unknown): InformeSnapshotRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: InformeSnapshotRow[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const kind = item.kind === "section" ? "section" : item.kind === "line" ? "line" : null;
    const label = String(item.label || "").trim();
    if (!kind || !label) return null;
    const tone =
      item.tone === "sub" || item.tone === "total" || item.tone === "grand" ? item.tone : undefined;
    rows.push(
      kind === "line"
        ? { kind, label, value: num(item.value), ...(tone ? { tone } : {}) }
        : { kind, label },
    );
  }
  return rows;
}

function readHistory(
  scope: InformeSnapshotScope,
  raw: unknown,
): InformeHistory | InformeRouteHistory | null {
  if (!isRecord(raw)) return null;
  const readKind = (kind: unknown, general: boolean) => {
    if (!isRecord(kind) || !Array.isArray(kind.days)) return null;
    const days: Array<{ date: string; T: number; M: number; N: number; total: number } | { date: string; total: number }> = [];
    for (const day of kind.days) {
      if (!isRecord(day)) return null;
      const date = String(day.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      if (general) {
        days.push({
          date,
          T: num(day.T),
          M: num(day.M),
          N: num(day.N),
          total: num(day.total),
        });
      } else {
        days.push({ date, total: num(day.total) });
      }
    }
    return { days, total: num(kind.total) };
  };
  const general = scope === "general";
  const cobrado = readKind(raw.cobrado, general);
  const prestamo = readKind(raw.prestamo, general);
  const gasto = readKind(raw.gasto, general);
  if (!cobrado || !prestamo || !gasto) return null;
  return { cobrado, prestamo, gasto } as InformeHistory | InformeRouteHistory;
}

function readGastos(raw: unknown): DigitalPoolGasto[] | null {
  if (!Array.isArray(raw)) return null;
  const gastos: DigitalPoolGasto[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const ref = String(item.ref || "").trim();
    const date = String(item.date || "");
    if (!ref || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    gastos.push({
      ref,
      date,
      label: String(item.label || "").trim(),
      amount: num(item.amount),
    });
  }
  return gastos;
}

export function normalizeInformeSnapshot(raw: unknown): InformeMonthSnapshot | null {
  if (!isRecord(raw)) return null;
  const scope = raw.scope === "general" || raw.scope === "angelica" ? raw.scope : null;
  const period = String(raw.period || "");
  const sealedOn = String(raw.sealedOn || "");
  if (!scope || !/^\d{4}-\d{2}$/.test(period) || !/^\d{4}-\d{2}-\d{2}$/.test(sealedOn)) return null;
  const rows = readRows(raw.rows);
  const history = readHistory(scope, raw.history);
  const poolGastos = readGastos(raw.poolGastos);
  if (!rows || !history || !poolGastos) return null;
  return {
    ref: informeSnapshotRef(scope, period),
    scope,
    period,
    sealedOn,
    corteLabel: String(raw.corteLabel || sealedOn),
    rows,
    history,
    poolGastos,
    poolGastado: num(raw.poolGastado),
  };
}
