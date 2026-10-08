/**
 * Reabrir la hoja de hoy (supervisor / admin).
 *
 * El cobrador cerró una planilla por error (T sin sus cobros). La reapertura no borra
 * nada en la nube: deja en el CIE- del día la marca `REABIERTA@<ruta>:<iso>|<quién>`
 * en `movement_refs`. Un CIE- cuyo `closed_at` no es posterior a la marca no cierra el
 * día; el siguiente cierre del cobrador (o el corte 23:30) lo vuelve a sellar.
 *
 * Solo hoy (Bogotá), antes de las 23:30. Reabrir M reabre también T (el saldo final de M
 * es el Inicial de T). Días pasados son historia.
 */
import { businessClockParts } from "@/lib/business-timezone";
import { sameRoute } from "@/lib/client-route-order";
import {
  dayCloseRef,
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
} from "@/lib/collector-day-close";
import { assignmentRouteName, DAY_CLOSE_SKIP_REASON } from "@/lib/collector-dispatch-sync";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow } from "@/lib/mock-data";
import {
  isPlanillaCashChainPrimary,
  PLANILLA_CASH_CHAIN_SECONDARY,
  planillaCashCloseRef,
  type PlanillaCashCloseRecord,
} from "@/lib/planilla-cash-chain";

const REOPEN_PREFIX = "REABIERTA@";
const FIELD_SEP = "|";
/** Corte automático (23:30 Bogotá): después ya no se reabre, el cron sella la jornada. */
const REOPEN_CUTOFF_MINUTES = 23 * 60 + 30;

export type SheetReopen = {
  route: string;
  /** ISO (hora del servidor). */
  at: string;
  by: string;
};

/** Reapertura vigente de un CIE- (posterior a su `closed_at`). */
export type DayCloseReopen = SheetReopen & {
  closeRef: string;
  collectorRef: string;
  date: string;
};

function routeKey(route: string) {
  return String(route || "").replace(/[|:]/g, "").trim().toUpperCase();
}

export function encodeSheetReopenRef(reopen: SheetReopen): string {
  const by = String(reopen.by || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  return `${REOPEN_PREFIX}${routeKey(reopen.route)}:${reopen.at}${FIELD_SEP}${by}`;
}

export function isSheetReopenRef(entry: string) {
  return String(entry ?? "").startsWith(REOPEN_PREFIX);
}

export function parseSheetReopens(refs: readonly string[]): SheetReopen[] {
  const out: SheetReopen[] = [];
  for (const entry of refs) {
    const text = String(entry ?? "");
    if (!isSheetReopenRef(text)) continue;
    const rest = text.slice(REOPEN_PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep <= 0) continue;
    const [at = "", ...by] = rest.slice(sep + 1).split(FIELD_SEP);
    if (!Number.isFinite(Date.parse(at))) continue;
    out.push({ route: rest.slice(0, sep), at, by: by.join(FIELD_SEP) });
  }
  return out;
}

export function withoutSheetReopenRefs(refs: readonly string[]): string[] {
  return refs.filter((entry) => !isSheetReopenRef(String(entry ?? "")));
}

function ms(iso: string | undefined | null) {
  const value = Date.parse(String(iso || ""));
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Reaperturas que siguen vigentes: hechas en o después del `closed_at` del CIE-.
 * Un cierre posterior las deja sin efecto (la hoja ya se volvió a cerrar).
 */
export function liveSheetReopens(
  closedAt: string | undefined | null,
  refs: readonly string[],
): SheetReopen[] {
  const closed = ms(closedAt);
  return parseSheetReopens(refs).filter(
    (reopen) => !Number.isFinite(closed) || ms(reopen.at) >= closed,
  );
}

/** ¿El CIE- (fila de nube) sigue cerrando la planilla `route`? */
export function cieClosesRoute(
  cie: { closed_at?: unknown; movement_refs?: unknown },
  route: string,
): boolean {
  const refs = Array.isArray(cie.movement_refs) ? (cie.movement_refs as string[]) : [];
  return !liveSheetReopens(String(cie.closed_at || ""), refs).some((reopen) =>
    sameRoute(reopen.route, route),
  );
}

/** Fila `day_closes` de nube → reaperturas vigentes (una por planilla). */
export function dayCloseReopensFromRow(row: Record<string, unknown>): DayCloseReopen[] {
  const ref = String(row.ref || "").trim();
  if (!ref.startsWith("CIE-")) return [];
  const refs = Array.isArray(row.movement_refs) ? (row.movement_refs as string[]) : [];
  const collectorRef = String(row.collector_ref || "");
  const date = normalizeHistoryDate(String(row.close_date || "")) || String(row.close_date || "");
  return liveSheetReopens(String(row.closed_at || ""), refs).map((reopen) => ({
    ...reopen,
    closeRef: ref,
    collectorRef,
    date,
  }));
}

/**
 * Planillas que abre el botón. M arrastra a T: el saldo final de M es el Inicial de T,
 * así que T no puede quedar cerrada sobre una M abierta.
 */
export function routesToReopen(route: string): string[] {
  const key = routeKey(route);
  return isPlanillaCashChainPrimary(key) ? [key, PLANILLA_CASH_CHAIN_SECONDARY] : [key];
}

/** Reaperturas de hoy de ese cobrador que ningún cierre posterior dejó atrás. */
export function liveReopensFor(
  collectorRef: string,
  date: string,
  reopens: readonly DayCloseReopen[],
  dayCloses: readonly CollectorDayCloseRecord[],
): DayCloseReopen[] {
  const cie = dayCloses.find((row) => row.ref === dayCloseRef(collectorRef, date) && !row.provisional);
  const closedMs = ms(cie?.closedAt);
  return reopens.filter(
    (reopen) =>
      reopen.collectorRef === collectorRef &&
      reopen.date === date &&
      !(Number.isFinite(closedMs) && closedMs > ms(reopen.at)),
  );
}

export type SheetReopenWindow =
  | { open: true; date: string }
  | { open: false; reason: string };

/**
 * Solo hoy (Bogotá), antes de 23:30, sin ajuste de saldo, con el día del cobrador
 * cerrado (CIE-) o con otra planilla suya ya reabierta hoy.
 */
export function sheetReopenWindow(
  collectorRef: string,
  route: string,
  dayCloses: readonly CollectorDayCloseRecord[],
  reopens: readonly DayCloseReopen[] = [],
  now = new Date(),
): SheetReopenWindow {
  if (!collectorRef || !route) return { open: false, reason: "Falta cobrador o planilla." };
  const clock = businessClockParts(now);
  if (clock.minutesSinceMidnight >= REOPEN_CUTOFF_MINUTES) {
    return { open: false, reason: "Después de las 23:30 la jornada la sella el corte automático." };
  }
  const ref = dayCloseRef(collectorRef, clock.dateIso);
  const cie = dayCloses.find((row) => row.ref === ref && !row.provisional);
  if (cie?.cashAdjustment) {
    return { open: false, reason: "El saldo de hoy ya se ajustó a la caja contada: no se reabre." };
  }
  const live = liveReopensFor(collectorRef, clock.dateIso, reopens, dayCloses);
  if (!cie && !live.length) {
    return { open: false, reason: "Hoy no hay cierre de jornada de ese cobrador." };
  }
  if (live.some((reopen) => sameRoute(reopen.route, route))) {
    return { open: false, reason: `La hoja ${routeKey(route)} ya está reabierta.` };
  }
  return { open: true, date: clock.dateIso };
}

type ReopenTarget = Pick<DayCloseReopen, "collectorRef" | "date" | "route" | "at" | "closeRef">;

/** Visita de esa planilla, ese cobrador y ese día. */
function assignmentInReopen(
  row: DailyCollectionAssignment,
  reopen: ReopenTarget,
  clients: readonly ClientRow[],
) {
  const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
  return (
    date === reopen.date &&
    row.collectorRef === reopen.collectorRef &&
    sameRoute(assignmentRouteName(row, clients as ClientRow[]), reopen.route)
  );
}

/** Visita sellada → abierta: «Cierre de jornada» vuelve a pendiente; cobros y N/P se quedan. */
export function reopenAssignment(row: DailyCollectionAssignment): DailyCollectionAssignment {
  if (!row.dayClosedAt) return row;
  const { dayClosedAt: _closed, ...rest } = row;
  const closedSkip =
    row.visitStatus === "omitido" &&
    row.skipReason === DAY_CLOSE_SKIP_REASON &&
    !String(row.paymentRef || "").trim();
  if (!closedSkip) return rest;
  return { ...rest, visitStatus: "pendiente", skipReason: undefined };
}

export type SheetReopenState = {
  dayCloses: CollectorDayCloseRecord[];
  planillaCashCloses: PlanillaCashCloseRecord[];
  assignments: DailyCollectionAssignment[];
};

export type SheetReopenApplied = SheetReopenState & {
  changed: boolean;
  /** Visitas de la planilla reabierta (para limpiar su cola de subida). */
  reopenedKeys: string[];
};

/**
 * Aplica la reapertura en el aparato. No hace nada si el aparato ya tiene un cierre
 * posterior (el cobrador volvió a cerrar): ese cierre manda.
 */
export function applySheetReopen(
  state: SheetReopenState,
  reopen: ReopenTarget,
  clients: readonly ClientRow[],
): SheetReopenApplied {
  const at = ms(reopen.at);
  const localCie = state.dayCloses.find((row) => row.ref === reopen.closeRef);
  if (localCie && ms(localCie.closedAt) > at) {
    return { ...state, changed: false, reopenedKeys: [] };
  }
  const pceRef = planillaCashCloseRef(reopen.collectorRef, reopen.date, reopen.route);
  const dayCloses = localCie
    ? state.dayCloses.filter((row) => row.ref !== reopen.closeRef)
    : state.dayCloses;
  const planillaCashCloses = state.planillaCashCloses.some((row) => row.ref === pceRef)
    ? state.planillaCashCloses.filter((row) => row.ref !== pceRef)
    : state.planillaCashCloses;
  const reopenedKeys: string[] = [];
  const assignments = state.assignments.map((row) => {
    if (!row.dayClosedAt || !assignmentInReopen(row, reopen, clients)) return row;
    reopenedKeys.push(`${normalizeHistoryDate(row.dispatchDate) || row.dispatchDate}::${row.itemId}`);
    return reopenAssignment(row);
  });
  return {
    dayCloses,
    planillaCashCloses,
    assignments: reopenedKeys.length ? assignments : state.assignments,
    changed:
      dayCloses !== state.dayCloses ||
      planillaCashCloses !== state.planillaCashCloses ||
      reopenedKeys.length > 0,
    reopenedKeys,
  };
}
