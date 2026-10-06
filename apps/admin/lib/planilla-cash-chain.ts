/**
 * Cadena de caja entre planillas M y T (solo saldos). Regla de inicio:
 *
 * 1. M trabaja el día (cobros / gastos / préstamos en caja).
 * 2. T es la última que cierra: su Inicial = saldo final de M (solo saldo).
 * 3. CIE- (`cash_float`) = saldo final del día en nube. Manda siempre.
 * 4. Inicial M mañana = CIE de ayer. PCE local nunca pisa al CIE.
 * 5. Ayer y atrás inmóviles: no recalcular saldos viejos.
 *
 * La caja viva de M, el Inicial de T y el `cash_float` que sella el CIE- se
 * calculan SOLO en `day-cash-ledger.ts`. Aquí no se suman cobros ni préstamos.
 */
import {
  dayCloseRef,
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
  type CollectorMonthCloseRecord,
} from "@/lib/collector-day-close";
import { sameRoute } from "@/lib/client-route-order";
import { pesos } from "@/lib/finance";

export const PLANILLA_CASH_CHAIN_PRIMARY = "M";
export const PLANILLA_CASH_CHAIN_SECONDARY = "T";

export const PLANILLA_CASH_CLOSE_REF_PREFIX = "PCE-";

/**
 * Día en que nace el historial de cadena M↔T.
 * Antes de esta fecha no se muestra (sin Ant. / sin mezclar el hilo viejo).
 * El día época arrastra el saldo final del día anterior una sola vez.
 */
export const PLANILLA_CASH_CHAIN_HISTORY_EPOCH = "2026-09-25";

/** Planillas fuera de la cadena con caja propia. */
export const INDEPENDENT_SALDO_ROUTES = ["A", "N"] as const;

/**
 * Desde este día, un préstamo a un cliente de A / N sale de la caja de esa planilla
 * (antes lo descontaba M). Días anteriores quedan como se sellaron.
 */
export const INDEPENDENT_OWN_LOANS_FROM = "2026-09-30";

/**
 * Monto del seed viejo (ya no se usa). Solo sirve para detectar y sacar
 * basura que aún esté en caché local. Inicial hoy = saldo de ayer, punto.
 */
export const MANUAL_T_LAUNCH_CLOSE = {
  collectorRef: "COB-0",
  collectorName: "Cristian",
  date: "2026-09-24",
  closingCash: 3_999_000,
} as const;

/** PCE-T con el monto fantasma 3.999.000: no es cierre real. */
export function isStaleManualLaunchAmount(row: PlanillaCashCloseRecord): boolean {
  return (
    row.collectorRef === MANUAL_T_LAUNCH_CLOSE.collectorRef &&
    sameRoute(row.routeName, PLANILLA_CASH_CHAIN_SECONDARY) &&
    pesos(row.closingCash) === pesos(MANUAL_T_LAUNCH_CLOSE.closingCash)
  );
}

/** @deprecated usar isStaleManualLaunchAmount */
export function isManualLaunchSeedRecord(row: PlanillaCashCloseRecord): boolean {
  return isStaleManualLaunchAmount(row);
}

/** @deprecated usar isStaleManualLaunchAmount */
export function isPoisonManualLaunchClone(row: PlanillaCashCloseRecord): boolean {
  return isStaleManualLaunchAmount(row);
}

/**
 * Saca el seed 3.999.000 de la cadena. No inserta nada manual.
 * Inicial de M = saldo final de ayer (CIE / PCE-T / caja), nunca un número fijo.
 */
export function ensureManualTLaunchClose(
  records: PlanillaCashCloseRecord[],
): PlanillaCashCloseRecord[] {
  return records.filter((row) => !isStaleManualLaunchAmount(row));
}

export type PlanillaCashCloseRecord = {
  ref: string;
  collectorRef: string;
  collectorName: string;
  date: string;
  routeName: string;
  openingCash: number;
  closingCash: number;
  closedAt: string;
};

export type ChainOpeningResult =
  | { kind: "independent" }
  | {
      kind: "chain";
      opening: number;
      /** true = saldo ya usable en pantalla (fijo o momentáneo). */
      ready: boolean;
      /** T: true mientras M del día aún no cerró (caja viva de M). */
      provisional?: boolean;
      blockReason?: string;
    };

export function isPlanillaCashCloseRef(ref: string | undefined) {
  return String(ref || "").startsWith(PLANILLA_CASH_CLOSE_REF_PREFIX);
}

/** CIE- del día completo (no es eslabón M/T). */
export function isFullDayCieRef(ref: string | undefined) {
  const r = String(ref || "");
  return r.startsWith("CIE-") && !isPlanillaCashCloseRef(r);
}

export function isPlanillaCashChainPrimary(route: string | undefined) {
  return sameRoute(route, PLANILLA_CASH_CHAIN_PRIMARY);
}

export function isPlanillaCashChainSecondary(route: string | undefined) {
  return sameRoute(route, PLANILLA_CASH_CHAIN_SECONDARY);
}

export function isPlanillaCashChainRoute(route: string | undefined) {
  return isPlanillaCashChainPrimary(route) || isPlanillaCashChainSecondary(route);
}

export function planillaCashCloseRef(
  collectorRef: string,
  date: string,
  routeName: string,
) {
  const d = normalizeHistoryDate(date) || date;
  const route = String(routeName || "").trim().toUpperCase();
  return `${PLANILLA_CASH_CLOSE_REF_PREFIX}${collectorRef}-${d}-${route}`;
}

export function findPlanillaCashClose(
  records: PlanillaCashCloseRecord[],
  collectorRef: string,
  date: string,
  routeName: string,
) {
  const ref = planillaCashCloseRef(collectorRef, date, routeName);
  const row = records.find((entry) => entry.ref === ref) ?? null;
  if (row && isStaleManualLaunchAmount(row)) return null;
  return row;
}

/** Último cierre de una ruta de la cadena estrictamente antes de `beforeDate`. */
export function findLatestPlanillaCashCloseBefore(
  records: PlanillaCashCloseRecord[],
  collectorRef: string,
  beforeDate: string,
  routeName: string,
) {
  const before = normalizeHistoryDate(beforeDate) || beforeDate;
  let best: PlanillaCashCloseRecord | null = null;
  for (const row of records) {
    if (row.collectorRef !== collectorRef) continue;
    if (!sameRoute(row.routeName, routeName)) continue;
    if (isStaleManualLaunchAmount(row)) continue;
    const d = normalizeHistoryDate(row.date) || row.date;
    if (!d || d >= before) continue;
    if (!best || d > (normalizeHistoryDate(best.date) || best.date)) best = row;
  }
  return best;
}

/**
 * Saldo final del día (única cifra para historial / registros / próximo Inicial M).
 *
 * Regla de inicio: Inicial mañana = este número.
 * Orden (nube gana):
 * 1) CIE- del día (`cashFloat`) — cierre de jornada en Supabase.
 * 2) PCE-T si aún no hay CIE.
 * 3) Caja viva de M / PCE-M.
 */
export function dayFinalClosingCash(input: {
  collectorRef: string;
  date: string;
  records: PlanillaCashCloseRecord[];
  /** Caja viva / final real de M del mismo día (mientras T no cierra). */
  primaryLiveClosing?: number;
  /** CIE- del cobrador (fuente nube del saldo final del día). */
  dayCloses?: CollectorDayCloseRecord[];
}): number | null {
  const date = normalizeHistoryDate(input.date) || input.date;

  // CIE manda: es el saldo sellado en nube. Un PCE local viejo no lo pisa.
  const cie = findFullDayCieClose(input.dayCloses ?? [], input.collectorRef, date);
  if (cie) {
    const float = Number(cie.cashFloat ?? cie.cashExpected);
    if (Number.isFinite(float)) return pesos(float);
  }

  const tClose = findPlanillaCashClose(
    input.records,
    input.collectorRef,
    date,
    PLANILLA_CASH_CHAIN_SECONDARY,
  );
  if (tClose) return pesos(tClose.closingCash);

  if (input.primaryLiveClosing != null && Number.isFinite(input.primaryLiveClosing)) {
    return pesos(input.primaryLiveClosing);
  }

  const mClose = findPlanillaCashClose(
    input.records,
    input.collectorRef,
    date,
    PLANILLA_CASH_CHAIN_PRIMARY,
  );
  if (mClose) return pesos(mClose.closingCash);
  return null;
}

/** CIE- de jornada completa (no PCE-). */
export function findFullDayCieClose(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  date: string,
) {
  const target = normalizeHistoryDate(date) || date;
  let best: CollectorDayCloseRecord | null = null;
  for (const row of dayCloses) {
    if (row.collectorRef !== collectorRef) continue;
    if (isPlanillaCashCloseRef(row.ref)) continue;
    if (!String(row.ref || "").startsWith("CIE-") || row.provisional) continue;
    const d = normalizeHistoryDate(row.date) || row.date;
    if (d !== target) continue;
    best = row;
  }
  return best;
}

/** Último CIE- estricto antes de `beforeDate`. */
export function findLatestFullDayCieBefore(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  beforeDate: string,
) {
  const before = normalizeHistoryDate(beforeDate) || beforeDate;
  let best: CollectorDayCloseRecord | null = null;
  for (const row of dayCloses) {
    if (row.collectorRef !== collectorRef) continue;
    if (isPlanillaCashCloseRef(row.ref)) continue;
    if (!String(row.ref || "").startsWith("CIE-") || row.provisional) continue;
    const d = normalizeHistoryDate(row.date) || row.date;
    if (!d || d >= before) continue;
    if (!best || d > (normalizeHistoryDate(best.date) || best.date)) best = row;
  }
  return best;
}

/**
 * Último día que este aparato sabe cerrado antes de `beforeDate`: CIE- sellado o provisional
 * (planilla sellada sin su CIE-) y eslabones PCE-. Si es posterior al último CIE- sellado,
 * a este aparato le falta el CIE- de ese día.
 */
export function latestClosedDayBefore(
  dayCloses: CollectorDayCloseRecord[],
  records: PlanillaCashCloseRecord[],
  collectorRef: string,
  beforeDate: string,
): string {
  const before = normalizeHistoryDate(beforeDate) || beforeDate;
  let latest = "";
  const consider = (raw: string) => {
    const d = normalizeHistoryDate(raw) || raw;
    if (d && d < before && d > latest) latest = d;
  };
  for (const row of dayCloses) {
    if (row.collectorRef !== collectorRef) continue;
    if (!String(row.ref || "").startsWith("CIE-")) continue;
    consider(row.date);
  }
  for (const row of records) {
    if (row.collectorRef !== collectorRef) continue;
    if (isStaleManualLaunchAmount(row)) continue;
    consider(row.date);
  }
  return latest;
}

/**
 * Día cerrado cuyo CIE- falta en este aparato ("" = cadena completa).
 * Un CIE- solo es el Inicial de M si es el del último día cerrado: si después hubo otro
 * día cerrado sin su CIE- aquí, usar el anterior saltaría ese día
 * (Vercel 12.271.000 = CIE del 01/10 contra 9.410.000 = CIE del 02/10).
 */
export function missingPriorDayCie(
  dayCloses: CollectorDayCloseRecord[],
  records: PlanillaCashCloseRecord[],
  collectorRef: string,
  date: string,
): string {
  const prevCie = findLatestFullDayCieBefore(dayCloses, collectorRef, date);
  if (!prevCie) return "";
  const prevCieDate = normalizeHistoryDate(prevCie.date) || prevCie.date;
  const lastClosedDay = latestClosedDayBefore(dayCloses, records, collectorRef, date);
  return lastClosedDay > prevCieDate ? lastClosedDay : "";
}

function missingCieMessage(day: string) {
  return `Falta en este aparato el cierre (CIE) del ${day}: el inicial de ${PLANILLA_CASH_CHAIN_PRIMARY} es ese saldo. Se está trayendo de la nube.`;
}

/**
 * Si hay CIE-, el PCE-T de ese día debe ser la misma cifra (nube = saldo final).
 * Corrige PCE local viejo que pisaba el Inicial de mañana.
 */
export function projectPceTFromDayCloses(
  records: PlanillaCashCloseRecord[],
  dayCloses: CollectorDayCloseRecord[],
): PlanillaCashCloseRecord[] {
  let next = records.filter((row) => !isStaleManualLaunchAmount(row));
  for (const cie of dayCloses) {
    if (!String(cie.ref || "").startsWith("CIE-") || cie.provisional) continue;
    if (isPlanillaCashCloseRef(cie.ref)) continue;
    const date = normalizeHistoryDate(cie.date) || cie.date;
    if (!date || !cie.collectorRef) continue;
    const float = Number(cie.cashFloat ?? cie.cashExpected);
    if (!Number.isFinite(float)) continue;
    const ref = planillaCashCloseRef(
      cie.collectorRef,
      date,
      PLANILLA_CASH_CHAIN_SECONDARY,
    );
    const existing = next.find((row) => row.ref === ref);
    // CIE manda: alinear PCE-T al cash_float (o crearlo si falta).
    if (existing && pesos(existing.closingCash) === pesos(float)) {
      continue;
    }
    next = upsertPlanillaCashClose(next, {
      ref,
      collectorRef: cie.collectorRef,
      collectorName: cie.collectorName || "",
      date,
      routeName: PLANILLA_CASH_CHAIN_SECONDARY,
      openingCash: pesos(float),
      closingCash: pesos(float),
      closedAt: cie.closedAt || `${date}T23:30:00.000-05:00`,
    });
  }
  return next;
}

/**
 * Saldo inicial de una planilla de la cadena.
 * - M: cierre T del día anterior (= dayFinalClosingCash de ayer).
 * - T: caja viva / final de M del mismo día (solo saldo).
 * - A y resto: independent.
 */
export function openingCashForChainedPlanilla(input: {
  collectorRef: string;
  routeName: string | undefined;
  date: string;
  records: PlanillaCashCloseRecord[];
  monthCloses: CollectorMonthCloseRecord[];
  /** Caja viva de M del mismo día (solo alimenta Inicial momentáneo de T). */
  primaryLiveClosing?: number;
  /**
   * Arrastre de caja ya conocido (historial / cierre previo) para M
   * mientras no exista PCE- de T del día anterior.
   */
  fallbackOpening?: number;
  /** CIE- en nube/local: Inicial M = cash_float del día anterior si falta PCE-T. */
  dayCloses?: CollectorDayCloseRecord[];
}): ChainOpeningResult {
  const route = String(input.routeName || "").trim();
  if (!isPlanillaCashChainRoute(route)) return { kind: "independent" };

  const date = normalizeHistoryDate(input.date) || input.date;

  if (isPlanillaCashChainSecondary(route)) {
    const mClose = findPlanillaCashClose(
      input.records,
      input.collectorRef,
      date,
      PLANILLA_CASH_CHAIN_PRIMARY,
    );
    // Caja viva / final real de M manda sobre un PCE hinchado (p. ej. sin descontar
    // todos los préstamos). T solo arrastra ese saldo — nunca los préstamos de M.
    if (input.primaryLiveClosing != null && Number.isFinite(input.primaryLiveClosing)) {
      return {
        kind: "chain",
        opening: pesos(input.primaryLiveClosing),
        ready: true,
        provisional: !mClose,
        blockReason: mClose
          ? undefined
          : `Inicial momentáneo de ${PLANILLA_CASH_CHAIN_SECONDARY}: se fija al cerrar ${PLANILLA_CASH_CHAIN_PRIMARY}.`,
      };
    }
    if (mClose) {
      return {
        kind: "chain",
        opening: pesos(mClose.closingCash),
        ready: true,
        provisional: false,
      };
    }
    return {
      kind: "chain",
      opening: 0,
      ready: false,
      provisional: true,
      blockReason: `Cierre primero la planilla ${PLANILLA_CASH_CHAIN_PRIMARY} para fijar el saldo inicial de ${PLANILLA_CASH_CHAIN_SECONDARY}.`,
    };
  }

  // ─── INVARIANTE SAGRADA (regla de inicio) ─────────────────────────
  // Si existe CIE- del día anterior, ESE cash_float es el Inicial de M.
  // Un PCE local jamás lo pisa. Fallo que ya dañó: taller 2.704k vs Vercel 2.090k.
  const prevCie = findLatestFullDayCieBefore(
    input.dayCloses ?? [],
    input.collectorRef,
    date,
  );
  const missingDay = missingPriorDayCie(
    input.dayCloses ?? [],
    input.records,
    input.collectorRef,
    date,
  );
  if (missingDay) {
    return {
      kind: "chain",
      opening: 0,
      ready: false,
      provisional: true,
      blockReason: missingCieMessage(missingDay),
    };
  }
  if (prevCie) {
    const float = Number(prevCie.cashFloat ?? prevCie.cashExpected);
    if (Number.isFinite(float)) {
      return {
        kind: "chain",
        opening: pesos(float),
        ready: true,
        provisional: false,
      };
    }
  }

  // Sin CIE aún: PCE-T / caja del día previo (mismo dayFinalClosingCash).
  const prevT = findLatestPlanillaCashCloseBefore(
    input.records,
    input.collectorRef,
    date,
    PLANILLA_CASH_CHAIN_SECONDARY,
  );
  const prevDate = prevT
    ? normalizeHistoryDate(prevT.date) || prevT.date
    : "";

  if (prevDate) {
    const final = dayFinalClosingCash({
      collectorRef: input.collectorRef,
      date: prevDate,
      records: input.records,
      dayCloses: input.dayCloses,
    });
    if (final != null) {
      return { kind: "chain", opening: pesos(final), ready: true, provisional: false };
    }
  }

  if (input.fallbackOpening != null && Number.isFinite(input.fallbackOpening)) {
    return {
      kind: "chain",
      opening: pesos(input.fallbackOpening),
      ready: true,
      provisional: false,
    };
  }

  return {
    kind: "chain",
    opening: 0,
    ready: false,
    provisional: false,
    blockReason: `El inicial de ${PLANILLA_CASH_CHAIN_PRIMARY} es el CIE de ayer (cash_float).`,
  };
}

type AssignmentRouteHint = {
  collectorRef: string;
  dispatchDate: string;
  clientRoute?: string;
  clientRef?: string;
  dayClosedAt?: string;
};

/** M ya cerró: eslabón PCE-M o todas las visitas M del día selladas. */
export function primaryChainSheetSealed(
  assignments: AssignmentRouteHint[],
  collectorRef: string,
  date: string,
  clients: { ref: string; route: string }[] = [],
): boolean {
  const day = normalizeHistoryDate(date) || date;
  const rows = assignments.filter((row) => {
    if (row.collectorRef !== collectorRef) return false;
    if ((normalizeHistoryDate(row.dispatchDate) || row.dispatchDate) !== day) return false;
    const fromVisit = String(row.clientRoute || "").trim();
    const fromClient = clients.find((client) => client.ref === row.clientRef)?.route ?? "";
    return isPlanillaCashChainPrimary(fromVisit || fromClient);
  });
  return rows.length > 0 && rows.every((row) => Boolean(row.dayClosedAt));
}

/**
 * Guardia: no cerrar T sin M cerrada el mismo día, ni sellar M/T si a este aparato
 * le falta el CIE- del último día cerrado (el saldo saldría del CIE de anteayer).
 */
export function assertCanCloseChainedPlanilla(input: {
  collectorRef: string;
  routeName: string | undefined;
  date: string;
  records: PlanillaCashCloseRecord[];
  dayCloses: CollectorDayCloseRecord[];
  assignments?: AssignmentRouteHint[];
  clients?: { ref: string; route: string }[];
}): { ok: true } | { ok: false; error: string } {
  const route = String(input.routeName || "").trim();
  if (!isPlanillaCashChainRoute(route)) return { ok: true };
  const missingDay = missingPriorDayCie(
    input.dayCloses,
    input.records,
    input.collectorRef,
    normalizeHistoryDate(input.date) || input.date,
  );
  if (missingDay) return { ok: false, error: missingCieMessage(missingDay) };
  if (!isPlanillaCashChainSecondary(route)) return { ok: true };
  const mClose = findPlanillaCashClose(
    input.records,
    input.collectorRef,
    input.date,
    PLANILLA_CASH_CHAIN_PRIMARY,
  );
  if (mClose) return { ok: true };
  if (primaryChainSheetSealed(input.assignments ?? [], input.collectorRef, input.date, input.clients)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: `No se puede cerrar ${PLANILLA_CASH_CHAIN_SECONDARY} sin cerrar antes ${PLANILLA_CASH_CHAIN_PRIMARY}.`,
  };
}

export function upsertPlanillaCashClose(
  records: PlanillaCashCloseRecord[],
  next: PlanillaCashCloseRecord,
) {
  const without = records.filter((row) => row.ref !== next.ref);
  return [...without, next];
}

/** Proyecta el eslabón a forma CIE para mirror nube (ref PCE-). */
export function planillaCashCloseAsDayClose(
  row: PlanillaCashCloseRecord,
): CollectorDayCloseRecord {
  return {
    ref: row.ref,
    collectorRef: row.collectorRef,
    collectorName: row.collectorName,
    date: row.date,
    routeRef: row.routeName,
    collected: 0,
    expenses: [],
    expensesTotal: 0,
    openingCash: row.openingCash,
    cashExpected: row.closingCash,
    cashDeclared: row.closingCash,
    cashVariance: 0,
    cashFloat: row.closingCash,
    closedAt: row.closedAt,
    movementRefs: [],
  };
}

export function dayCloseAsPlanillaCashClose(
  row: CollectorDayCloseRecord,
): PlanillaCashCloseRecord | null {
  if (!isPlanillaCashCloseRef(row.ref)) return null;
  const routeName = String(row.routeRef || "").trim();
  if (!isPlanillaCashChainRoute(routeName)) return null;
  return {
    ref: row.ref,
    collectorRef: row.collectorRef,
    collectorName: row.collectorName,
    date: normalizeHistoryDate(row.date) || row.date,
    routeName,
    openingCash: pesos(row.openingCash ?? 0),
    closingCash: pesos(row.cashFloat ?? row.cashExpected ?? 0),
    closedAt: row.closedAt,
  };
}

/** Separa CIE del día vs eslabones M/T al hidratar. */
export function splitDayClosesAndPlanillaCash(closes: CollectorDayCloseRecord[]) {
  const dayCloses: CollectorDayCloseRecord[] = [];
  const planillaCash: PlanillaCashCloseRecord[] = [];
  for (const row of closes) {
    if (isPlanillaCashCloseRef(row.ref)) {
      const link = dayCloseAsPlanillaCashClose(row);
      if (link) planillaCash.push(link);
      continue;
    }
    // Nunca usar CIE-xxx como llave de sellado si el ref colisionara; guardar normal.
    if (row.ref === dayCloseRef(row.collectorRef, row.date) || isFullDayCieRef(row.ref)) {
      dayCloses.push(row);
      continue;
    }
    dayCloses.push(row);
  }
  return { dayCloses, planillaCash };
}

/**
 * Historial M/T: si hay PCE- ese día, el Saldo es el cierre de cadena;
 * si no, se conserva el arrastre real del historial (no poner — / 0).
 * Tras un PCE-, los días siguientes re-arrastran desde ese ancla.
 */
export function stampHistoryWithPlanillaCashChain<
  T extends {
    date: string;
    cobroEfectivo: number;
    gasto: number;
    prestamo: number;
    saldo: number;
  },
>(input: {
  collectorRef: string;
  routeName: string | undefined;
  rows: T[];
  records: PlanillaCashCloseRecord[];
  monthCloses: CollectorMonthCloseRecord[];
  fallbackOpening?: number;
  /**
   * Saldo final real de M por día (misma cifra que Historial · M / ruta).
   * T arrastra solo eso — no un PCE hinchado.
   */
  primaryClosingByDate?: ReadonlyMap<string, number>;
}): T[] {
  const route = String(input.routeName || "").trim();
  if (!isPlanillaCashChainRoute(route) || input.rows.length === 0) {
    return input.rows;
  }
  const ascending = [...input.rows].sort((a, b) => a.date.localeCompare(b.date));
  let running: number | null = null;
  const stamped = ascending.map((row) => {
    const pce = findPlanillaCashClose(
      input.records,
      input.collectorRef,
      row.date,
      route,
    );
    if (pce || isPlanillaCashChainSecondary(route)) {
      if (isPlanillaCashChainSecondary(route)) {
        const fromPrimary = input.primaryClosingByDate?.get(row.date);
        const mClose = findPlanillaCashClose(
          input.records,
          input.collectorRef,
          row.date,
          PLANILLA_CASH_CHAIN_PRIMARY,
        );
        const tClose = findPlanillaCashClose(
          input.records,
          input.collectorRef,
          row.date,
          PLANILLA_CASH_CHAIN_SECONDARY,
        );
        // T cerró: el saldo final del día es el de T (jaló M). Una sola cifra.
        if (tClose) {
          const mFinal =
            fromPrimary != null && Number.isFinite(fromPrimary)
              ? pesos(fromPrimary)
              : mClose
                ? pesos(mClose.closingCash)
                : pesos(tClose.openingCash);
          const tDelta = pesos(tClose.closingCash) - pesos(tClose.openingCash);
          running = pesos(mFinal + tDelta);
          return { ...row, saldo: running };
        }
        const opening =
          fromPrimary != null && Number.isFinite(fromPrimary)
            ? pesos(fromPrimary)
            : mClose
              ? pesos(mClose.closingCash)
              : pce
                ? pesos(pce.openingCash)
                : null;
        if (opening == null) {
          if (running == null) {
            running = pesos(row.saldo);
            return row;
          }
          running = pesos(
            running + pesos(row.cobroEfectivo) - pesos(row.gasto) - pesos(row.prestamo),
          );
          return { ...row, saldo: running };
        }
        running = pesos(
          opening + pesos(row.cobroEfectivo) - pesos(row.gasto) - pesos(row.prestamo),
        );
        return { ...row, saldo: running };
      }
      // M: recalcular; no usar closingCash sellado viejo.
      running = pesos(
        pesos(pce!.openingCash) +
          pesos(row.cobroEfectivo) -
          pesos(row.gasto) -
          pesos(row.prestamo),
      );
      return { ...row, saldo: running };
    }
    if (running == null) {
      // Sin ancla PCE aún: conservar saldo real del historial de caja.
      running = pesos(row.saldo);
      return row;
    }
    running = pesos(running + pesos(row.cobroEfectivo) - pesos(row.gasto) - pesos(row.prestamo));
    return { ...row, saldo: running };
  });
  const byDate = new Map(stamped.map((row) => [row.date, row.saldo]));
  return input.rows.map((row) => ({
    ...row,
    saldo: byDate.get(row.date) ?? row.saldo,
  }));
}

export type PlanillaChainHistoryRow = {
  date: string;
  dateLabel: string;
  cobro: number;
  gasto: number;
  prestamo: number;
  /** Solo M: de T (o bootstrap día época). null = — . */
  inicial: number | null;
  saldo: number | null;
};

/**
 * Bootstrap del día época: Saldo en caja real del día previo
 * (efectivo − gasto − préstamo, misma base que Cierre del día).
 * No usar arrastre filtrado solo por clientes de M: infla el Saldo.
 */
export function epochBootstrapFromMHistoryRows(
  rows: Array<{ date: string; saldo: number }>,
  fallbackOpening: number,
  epoch: string = PLANILLA_CASH_CHAIN_HISTORY_EPOCH,
): number {
  const ascending = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const prior = ascending.filter((row) => {
    const d = normalizeHistoryDate(row.date) || row.date;
    return Boolean(d && d < epoch);
  });
  if (prior.length) return pesos(prior[prior.length - 1].saldo);
  return pesos(fallbackOpening);
}

/**
 * Pone en cada fila el Saldo en mano del cobrador (caja real).
 * Cobro/gasto/préstamo de la fila pueden seguir por ruta; el Saldo no.
 */
export function applyCollectorCashHandSaldos<
  T extends { date: string; saldo: number },
>(rows: T[], cashHandByDate: ReadonlyMap<string, number>): T[] {
  if (!rows.length || cashHandByDate.size === 0) return rows;
  return rows.map((row) => {
    const hand = cashHandByDate.get(row.date);
    if (hand == null || !Number.isFinite(hand)) return row;
    return { ...row, saldo: pesos(hand) };
  });
}

/**
 * Extracto M: Día · Inicial · Cobros · Préstamo · Gasto · Saldo.
 *
 * Regla de inicio (inmóvil hacia atrás):
 * - Ayer y antes: no se recalculan. Cobros/préstamo/gasto/saldo quedan quietos.
 * - Saldo final de ayer (CIE/T) se fija una vez.
 * - Hoy: Inicial = ese saldo final de ayer. Nada más se arrastra.
 */
export function annotateMHistoryExtractRows(input: {
  rows: Array<{
    date: string;
    dateLabel: string;
    cobro: number;
    cobroEfectivo: number;
    gasto: number;
    prestamo: number;
    saldo: number;
  }>;
  collectorRef: string;
  records: PlanillaCashCloseRecord[];
  epochBootstrapOpening: number;
  todayIso: string;
  epoch?: string;
  /** CIE-: misma cadena que el KPI Inicial de la planilla. */
  dayCloses?: CollectorDayCloseRecord[];
  monthCloses?: CollectorMonthCloseRecord[];
  /** Caja final de M de un día según el libro (`primaryClosingForDay`). */
  primaryClosingFor?: (dateIso: string) => number | null;
}): Array<{
  date: string;
  dateLabel: string;
  cobro: number;
  gasto: number;
  prestamo: number;
  inicial: number | null;
  saldoShown: number | null;
}> {
  const today = normalizeHistoryDate(input.todayIso) || input.todayIso;
  const ascending = [...input.rows].sort((a, b) => a.date.localeCompare(b.date));
  const dayCloses = input.dayCloses ?? [];
  const monthCloses = input.monthCloses ?? [];

  const pastDates = ascending.map((row) => row.date).filter((d) => d < today);
  const yesterdayIso = pastDates.length ? pastDates[pastDates.length - 1] : "";

  /** Saldo final de ayer (CIE): único ancla para el Inicial de M hoy. No es el Saldo de M ayer. */
  const yesterdayFinal =
    yesterdayIso.length > 0
      ? dayFinalClosingCash({
          collectorRef: input.collectorRef,
          date: yesterdayIso,
          records: input.records,
          dayCloses,
        })
      : null;

  const annotatedAscending: Array<{
    date: string;
    dateLabel: string;
    cobro: number;
    gasto: number;
    prestamo: number;
    inicial: number | null;
    saldoShown: number | null;
  }> = [];

  for (const row of ascending) {
    if (row.date < today) {
      // Inmóvil: no recalcular Inicial ni Saldo con fórmulas / cadena vieja.
      // Saldo de M ayer = caja final de M (Inicial de T), nunca el CIE (saldo final tras T).
      const isYesterday = row.date === yesterdayIso;
      const primaryClosing = isYesterday ? (input.primaryClosingFor?.(row.date) ?? null) : null;
      const saldoShown =
        primaryClosing != null && Number.isFinite(primaryClosing)
          ? pesos(primaryClosing)
          : pesos(row.saldo);
      annotatedAscending.push({
        date: row.date,
        dateLabel: row.dateLabel,
        cobro: row.cobro,
        gasto: row.gasto,
        prestamo: row.prestamo,
        // No reescribir Inicial del pasado (evita arrastrar -57M, etc.).
        inicial: null,
        saldoShown,
      });
      continue;
    }

    // Hoy: Inicial = saldo final de ayer. Saldo aún abierto (—).
    let inicial: number | null = null;
    if (yesterdayFinal != null) {
      inicial = pesos(yesterdayFinal);
    } else {
      const open = openingCashForChainedPlanilla({
        collectorRef: input.collectorRef,
        routeName: PLANILLA_CASH_CHAIN_PRIMARY,
        date: row.date,
        records: input.records,
        monthCloses,
        dayCloses,
      });
      if (open.kind === "chain" && open.ready) inicial = pesos(open.opening);
    }

    annotatedAscending.push({
      date: row.date,
      dateLabel: row.dateLabel,
      cobro: row.cobro,
      gasto: row.gasto,
      prestamo: row.prestamo,
      inicial,
      saldoShown: null,
    });
  }

  const byDate = new Map(annotatedAscending.map((row) => [row.date, row]));
  return input.rows.map(
    (row) =>
      byDate.get(row.date) ?? {
        date: row.date,
        dateLabel: row.dateLabel,
        cobro: row.cobro,
        gasto: row.gasto,
        prestamo: row.prestamo,
        inicial: null,
        saldoShown: pesos(row.saldo),
      },
  );
}

/**
 * Historial M/T desde el día época (sin Ant.).
 * M: Inicial = misma cadena que la planilla (CIE / PCE-T); día época = saldo real ayer.
 *     Saldo = Inicial + efectivo − gasto − préstamo (o CIE si ya cerró el día).
 * T: sin columna Inicial; Saldo = final (PCE o vivo desde M).
 */
export function buildPlanillaChainHistoryRows(input: {
  routeName: string | undefined;
  rows: Array<{
    date: string;
    dateLabel: string;
    cobro: number;
    cobroEfectivo: number;
    gasto: number;
    prestamo: number;
  }>;
  collectorRef: string;
  records: PlanillaCashCloseRecord[];
  /** Saldo final del día anterior al época (solo bootstrap M). */
  epochBootstrapOpening: number;
  epoch?: string;
  dayCloses?: CollectorDayCloseRecord[];
  monthCloses?: CollectorMonthCloseRecord[];
}): PlanillaChainHistoryRow[] {
  const route = String(input.routeName || "").trim();
  if (!isPlanillaCashChainRoute(route)) return [];
  const epoch = input.epoch || PLANILLA_CASH_CHAIN_HISTORY_EPOCH;
  const isM = isPlanillaCashChainPrimary(route);
  const ascending = [...input.rows]
    .filter((row) => row.date >= epoch)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dayCloses = input.dayCloses ?? [];
  const monthCloses = input.monthCloses ?? [];

  const stamped: PlanillaChainHistoryRow[] = ascending.map((row, index) => {
    if (isM) {
      // Inicial hoy = Saldo ayer (fila previa) o cadena planilla.
      let inicial: number | null = null;
      if (index > 0) {
        const prev = ascending[index - 1];
        const prevOpen = openingCashForChainedPlanilla({
          collectorRef: input.collectorRef,
          routeName: PLANILLA_CASH_CHAIN_PRIMARY,
          date: prev.date,
          records: input.records,
          monthCloses,
          fallbackOpening: input.epochBootstrapOpening,
          dayCloses,
        });
        const prevInicial =
          prev.date === epoch
            ? pesos(input.epochBootstrapOpening)
            : prevOpen.kind === "chain" && prevOpen.ready
              ? pesos(prevOpen.opening)
              : pesos(input.epochBootstrapOpening);
        const prevFormula = pesos(
          prevInicial +
            pesos(prev.cobroEfectivo) -
            pesos(prev.gasto) -
            pesos(prev.prestamo),
        );
        const prevFinal = dayFinalClosingCash({
          collectorRef: input.collectorRef,
          date: prev.date,
          records: input.records,
          dayCloses,
          primaryLiveClosing: prevFormula,
        });
        inicial = prevFinal != null ? pesos(prevFinal) : prevFormula;
      } else if (row.date === epoch) {
        inicial = pesos(input.epochBootstrapOpening);
      } else {
        const open = openingCashForChainedPlanilla({
          collectorRef: input.collectorRef,
          routeName: PLANILLA_CASH_CHAIN_PRIMARY,
          date: row.date,
          records: input.records,
          monthCloses,
          fallbackOpening: input.epochBootstrapOpening,
          dayCloses,
        });
        if (open.kind === "chain" && open.ready) inicial = pesos(open.opening);
      }

      const formula =
        inicial == null
          ? null
          : pesos(
              inicial +
                pesos(row.cobroEfectivo) -
                pesos(row.gasto) -
                pesos(row.prestamo),
            );
      const fromCie =
        formula == null
          ? null
          : dayFinalClosingCash({
              collectorRef: input.collectorRef,
              date: row.date,
              records: input.records,
              dayCloses,
              primaryLiveClosing: formula,
            });
      const saldo = fromCie != null ? pesos(fromCie) : formula;
      return {
        date: row.date,
        dateLabel: row.dateLabel,
        cobro: row.cobro,
        gasto: row.gasto,
        prestamo: row.prestamo,
        inicial,
        saldo,
      };
    }

    // T: saldo final; Inicial lo aporta M (no columna).
    const tClose = findPlanillaCashClose(
      input.records,
      input.collectorRef,
      row.date,
      PLANILLA_CASH_CHAIN_SECONDARY,
    );
    const mClose = findPlanillaCashClose(
      input.records,
      input.collectorRef,
      row.date,
      PLANILLA_CASH_CHAIN_PRIMARY,
    );
    let saldo: number | null = null;
    if (tClose) {
      saldo = pesos(tClose.closingCash);
    } else if (mClose) {
      saldo = pesos(
        mClose.closingCash + pesos(row.cobroEfectivo) - pesos(row.gasto) - pesos(row.prestamo),
      );
    }
    return {
      date: row.date,
      dateLabel: row.dateLabel,
      cobro: row.cobro,
      gasto: row.gasto,
      prestamo: row.prestamo,
      inicial: null,
      saldo,
    };
  });

  return stamped.sort((a, b) => b.date.localeCompare(a.date));
}

