/**
 * Cadena de caja entre planillas M y T (solo saldos). Regla de inicio:
 *
 * 1. M trabaja el día (cobros / gastos / préstamos en caja).
 * 2. T es la última que cierra: su Inicial = saldo final de M (solo saldo, sin
 *    arrastrar préstamos ni gastos de M).
 * 3. El saldo que arroja T al cerrar es el saldo final del día: manda en
 *    historial, registros y en el Inicial de M del día siguiente.
 * 4. No se puede cerrar T sin M cerrada el mismo día. Planilla A no participa.
 * 5. Rollover 00:00: ambas planillas abren nuevas.
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

/**
 * Arranque manual una sola vez: cierre T del día previo al época.
 * Fija Saldo T 24 = Inicial M 25. Después manda lo que arrojen las planillas.
 */
export const MANUAL_T_LAUNCH_CLOSE = {
  collectorRef: "COB-0",
  collectorName: "Cristian",
  date: "2026-09-24",
  closingCash: 3_999_000,
} as const;

/** Inserta el PCE-T de arranque solo si aún no existe. Nunca pisa un cierre real. */
export function ensureManualTLaunchClose(
  records: PlanillaCashCloseRecord[],
): PlanillaCashCloseRecord[] {
  const date = MANUAL_T_LAUNCH_CLOSE.date;
  const ref = planillaCashCloseRef(
    MANUAL_T_LAUNCH_CLOSE.collectorRef,
    date,
    PLANILLA_CASH_CHAIN_SECONDARY,
  );
  if (records.some((row) => row.ref === ref)) return records;
  const row: PlanillaCashCloseRecord = {
    ref,
    collectorRef: MANUAL_T_LAUNCH_CLOSE.collectorRef,
    collectorName: MANUAL_T_LAUNCH_CLOSE.collectorName,
    date,
    routeName: PLANILLA_CASH_CHAIN_SECONDARY,
    openingCash: pesos(MANUAL_T_LAUNCH_CLOSE.closingCash),
    closingCash: pesos(MANUAL_T_LAUNCH_CLOSE.closingCash),
    closedAt: `${date}T23:30:00.000-05:00`,
  };
  return upsertPlanillaCashClose(records, row);
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
  return records.find((row) => row.ref === ref) ?? null;
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
    const d = normalizeHistoryDate(row.date) || row.date;
    if (!d || d >= before) continue;
    if (!best || d > (normalizeHistoryDate(best.date) || best.date)) best = row;
  }
  return best;
}

/** Caja viva de M: inicial + efectivo − salidas (lo que T ve momentáneo). */
export function livePrimaryClosingCash(input: {
  opening: number;
  cashCollected: number;
  cashOut: number;
}) {
  return pesos(input.opening + pesos(input.cashCollected) - pesos(input.cashOut));
}

/**
 * Saldo final del día (única cifra para historial / registros / próximo Inicial M).
 *
 * T cierra última jalando M:
 * - Si hay PCE-T → `closingCash` de T (ya incluye el arrastre de M + movimiento de T).
 * - Si no, CIE- del día (`cashFloat`) — misma cifra en nube cuando PCE aún no sube.
 * - Si no, caja de M (`primaryLiveClosing` o PCE-M).
 */
export function dayFinalClosingCash(input: {
  collectorRef: string;
  date: string;
  records: PlanillaCashCloseRecord[];
  /** Caja viva / final real de M del mismo día (mientras T no cierra). */
  primaryLiveClosing?: number;
  /** CIE- del cobrador (fuente nube cuando falta PCE-T). */
  dayCloses?: CollectorDayCloseRecord[];
}): number | null {
  const date = normalizeHistoryDate(input.date) || input.date;
  const tClose = findPlanillaCashClose(
    input.records,
    input.collectorRef,
    date,
    PLANILLA_CASH_CHAIN_SECONDARY,
  );
  if (tClose) return pesos(tClose.closingCash);

  const cie = findFullDayCieClose(input.dayCloses ?? [], input.collectorRef, date);
  if (cie) {
    const float = Number(cie.cashFloat ?? cie.cashExpected);
    if (Number.isFinite(float)) return pesos(float);
  }

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
    if (!String(row.ref || "").startsWith("CIE-")) continue;
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
    if (!String(row.ref || "").startsWith("CIE-")) continue;
    const d = normalizeHistoryDate(row.date) || row.date;
    if (!d || d >= before) continue;
    if (!best || d > (normalizeHistoryDate(best.date) || best.date)) best = row;
  }
  return best;
}

/**
 * Si hay CIE- y falta PCE-T ese día, proyecta el eslabón T con el cash_float del CIE.
 * Así el Inicial de M mañana lee la misma cifra que ya está en la nube.
 */
export function projectPceTFromDayCloses(
  records: PlanillaCashCloseRecord[],
  dayCloses: CollectorDayCloseRecord[],
): PlanillaCashCloseRecord[] {
  let next = records;
  for (const cie of dayCloses) {
    if (!String(cie.ref || "").startsWith("CIE-")) continue;
    if (isPlanillaCashCloseRef(cie.ref)) continue;
    const date = normalizeHistoryDate(cie.date) || cie.date;
    if (!date || !cie.collectorRef) continue;
    const float = Number(cie.cashFloat ?? cie.cashExpected);
    if (!Number.isFinite(float)) continue;
    const existing = findPlanillaCashClose(
      next,
      cie.collectorRef,
      date,
      PLANILLA_CASH_CHAIN_SECONDARY,
    );
    // No pisar un PCE-T real distinto del arranque manual.
    if (
      existing &&
      !(
        date === MANUAL_T_LAUNCH_CLOSE.date &&
        pesos(existing.closingCash) === pesos(MANUAL_T_LAUNCH_CLOSE.closingCash)
      )
    ) {
      continue;
    }
    next = upsertPlanillaCashClose(next, {
      ref: planillaCashCloseRef(
        cie.collectorRef,
        date,
        PLANILLA_CASH_CHAIN_SECONDARY,
      ),
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

  // M: 1) cierre T del día anterior. 2) CIE- del día anterior (nube). 3) época.
  const prevT = findLatestPlanillaCashCloseBefore(
    input.records,
    input.collectorRef,
    date,
    PLANILLA_CASH_CHAIN_SECONDARY,
  );
  const prevCie = findLatestFullDayCieBefore(
    input.dayCloses ?? [],
    input.collectorRef,
    date,
  );
  if (prevT && prevCie) {
    const tDate = normalizeHistoryDate(prevT.date) || prevT.date;
    const cieDate = normalizeHistoryDate(prevCie.date) || prevCie.date;
    // Si el CIE es del mismo día o más fresco que el PCE-T, manda el CIE
    // (evita que el arranque manual 3.999.000 gane sobre el cierre real 2.704.000).
    if (cieDate >= tDate) {
      const float = Number(prevCie.cashFloat ?? prevCie.cashExpected);
      if (Number.isFinite(float)) {
        return { kind: "chain", opening: pesos(float), ready: true, provisional: false };
      }
    }
  }
  if (prevT) {
    return { kind: "chain", opening: pesos(prevT.closingCash), ready: true, provisional: false };
  }
  if (prevCie) {
    const float = Number(prevCie.cashFloat ?? prevCie.cashExpected);
    if (Number.isFinite(float)) {
      return { kind: "chain", opening: pesos(float), ready: true, provisional: false };
    }
  }

  if (
    date === PLANILLA_CASH_CHAIN_HISTORY_EPOCH &&
    input.fallbackOpening != null &&
    Number.isFinite(input.fallbackOpening)
  ) {
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
    blockReason: `El inicial de ${PLANILLA_CASH_CHAIN_PRIMARY} llega al cerrar ${PLANILLA_CASH_CHAIN_SECONDARY} la noche anterior.`,
  };
}

/** Guardia: no cerrar T sin M cerrada el mismo día. */
export function assertCanCloseChainedPlanilla(input: {
  collectorRef: string;
  routeName: string | undefined;
  date: string;
  records: PlanillaCashCloseRecord[];
}): { ok: true } | { ok: false; error: string } {
  const route = String(input.routeName || "").trim();
  if (!isPlanillaCashChainSecondary(route)) return { ok: true };
  const mClose = findPlanillaCashClose(
    input.records,
    input.collectorRef,
    input.date,
    PLANILLA_CASH_CHAIN_PRIMARY,
  );
  if (mClose) return { ok: true };
  return {
    ok: false,
    error: `No se puede cerrar ${PLANILLA_CASH_CHAIN_SECONDARY} sin cerrar antes ${PLANILLA_CASH_CHAIN_PRIMARY}.`,
  };
}

export function buildPlanillaCashClose(input: {
  collectorRef: string;
  collectorName: string;
  date: string;
  routeName: string;
  openingCash: number;
  /** Efectivo cobrado en esa planilla. */
  cashCollected: number;
  /** Gasto operativo + préstamos en efectivo de esa planilla. */
  cashOut: number;
}): PlanillaCashCloseRecord {
  const date = normalizeHistoryDate(input.date) || input.date;
  const routeName = String(input.routeName || "").trim();
  const opening = pesos(input.openingCash);
  const closing = pesos(opening + pesos(input.cashCollected) - pesos(input.cashOut));
  return {
    ref: planillaCashCloseRef(input.collectorRef, date, routeName),
    collectorRef: input.collectorRef,
    collectorName: input.collectorName,
    date,
    routeName,
    openingCash: opening,
    closingCash: closing,
    closedAt: new Date().toISOString(),
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

/**
 * Cierra eslabones M y T del día (aunque T no tenga cobros).
 * Orden firme: primero M, luego T con inicial = cierre de M.
 * Usado en cierre manual por hoja y en auto-cierre 23:30.
 */
export function sealMAndTCashChainForDay(input: {
  collectorRef: string;
  collectorName: string;
  date: string;
  records: PlanillaCashCloseRecord[];
  monthCloses: CollectorMonthCloseRecord[];
  fallbackOpening: number;
  primaryCashCollected: number;
  primaryCashOut: number;
  secondaryCashCollected: number;
  secondaryCashOut: number;
}): PlanillaCashCloseRecord[] {
  const date = normalizeHistoryDate(input.date) || input.date;
  let next = input.records;

  const mOpen = openingCashForChainedPlanilla({
    collectorRef: input.collectorRef,
    routeName: PLANILLA_CASH_CHAIN_PRIMARY,
    date,
    records: next,
    monthCloses: input.monthCloses,
    fallbackOpening: input.fallbackOpening,
  });
  const mOpening =
    mOpen.kind === "chain" ? mOpen.opening : pesos(input.fallbackOpening);

  const mClose = buildPlanillaCashClose({
    collectorRef: input.collectorRef,
    collectorName: input.collectorName,
    date,
    routeName: PLANILLA_CASH_CHAIN_PRIMARY,
    openingCash: mOpening,
    cashCollected: input.primaryCashCollected,
    cashOut: input.primaryCashOut,
  });
  next = upsertPlanillaCashClose(next, mClose);

  const tClose = buildPlanillaCashClose({
    collectorRef: input.collectorRef,
    collectorName: input.collectorName,
    date,
    routeName: PLANILLA_CASH_CHAIN_SECONDARY,
    openingCash: mClose.closingCash,
    cashCollected: input.secondaryCashCollected,
    cashOut: input.secondaryCashOut,
  });
  return upsertPlanillaCashClose(next, tClose);
}

/**
 * Alinea PCE-M/T al saldo final real de M (Inicial + efectivo − gasto − préstamo).
 * Evita que un cierre viejo sin descontar préstamos hinche el Inicial de T
 * y, al cerrar T, el Inicial de M del día siguiente.
 */
export function alignPlanillaCashChainToPrimaryClosing(
  records: PlanillaCashCloseRecord[],
  collectorRef: string,
  date: string,
  primaryClosingCash: number,
): PlanillaCashCloseRecord[] {
  const d = normalizeHistoryDate(date) || date;
  const closing = pesos(primaryClosingCash);
  const mClose = findPlanillaCashClose(
    records,
    collectorRef,
    d,
    PLANILLA_CASH_CHAIN_PRIMARY,
  );
  if (!mClose) return records;

  let next = records;
  if (pesos(mClose.closingCash) !== closing) {
    next = upsertPlanillaCashClose(next, { ...mClose, closingCash: closing });
  }

  const tClose = findPlanillaCashClose(
    next,
    collectorRef,
    d,
    PLANILLA_CASH_CHAIN_SECONDARY,
  );
  if (!tClose) return next;

  // Conserva el movimiento propio de T (cobros − salidas); solo corrige el arrastre.
  const tDelta = pesos(tClose.closingCash) - pesos(tClose.openingCash);
  const nextT: PlanillaCashCloseRecord = {
    ...tClose,
    openingCash: closing,
    closingCash: pesos(closing + tDelta),
  };
  if (
    pesos(tClose.openingCash) === nextT.openingCash &&
    pesos(tClose.closingCash) === nextT.closingCash
  ) {
    return next;
  }
  return upsertPlanillaCashClose(next, nextT);
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
 * Extracto M (como banco): Día · Inicial · Cobros · Préstamo · Gasto · Saldo.
 *
 * Arranque claro (día época):
 * - Saldo del día previo = caja real (efectivo − gasto − préstamo).
 * - Inicial del día época = ese mismo Saldo (se parte de ahí).
 * Después: Inicial = cierre T anoche; Saldo = — mientras el día no cierre.
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
}): Array<{
  date: string;
  dateLabel: string;
  cobro: number;
  gasto: number;
  prestamo: number;
  inicial: number | null;
  saldoShown: number | null;
}> {
  const epoch = input.epoch || PLANILLA_CASH_CHAIN_HISTORY_EPOCH;
  const today = normalizeHistoryDate(input.todayIso) || input.todayIso;
  const ascending = [...input.rows].sort((a, b) => a.date.localeCompare(b.date));
  const launchSaldo = epochBootstrapFromMHistoryRows(
    ascending,
    input.epochBootstrapOpening,
    epoch,
  );

  const annotatedAscending: Array<{
    date: string;
    dateLabel: string;
    cobro: number;
    gasto: number;
    prestamo: number;
    inicial: number | null;
    saldoShown: number | null;
  }> = [];

  for (let i = 0; i < ascending.length; i += 1) {
    const row = ascending[i];
    const prevAnnotated = i > 0 ? annotatedAscending[i - 1] : null;

    if (row.date < epoch) {
      // Día previo al época: Saldo = caja real; Inicial = Saldo del día anterior (si hay).
      // Arranque manual: si hay PCE-T ese día, ese cierre es el Saldo que parte M.
      const tCloseSameDay = findPlanillaCashClose(
        input.records,
        input.collectorRef,
        row.date,
        PLANILLA_CASH_CHAIN_SECONDARY,
      );
      const inicial =
        prevAnnotated?.saldoShown != null ? pesos(prevAnnotated.saldoShown) : null;
      annotatedAscending.push({
        date: row.date,
        dateLabel: row.dateLabel,
        cobro: row.cobro,
        gasto: row.gasto,
        prestamo: row.prestamo,
        inicial,
        saldoShown: tCloseSameDay
          ? pesos(tCloseSameDay.closingCash)
          : pesos(row.saldo),
      });
      continue;
    }

    const prevT = findLatestPlanillaCashCloseBefore(
      input.records,
      input.collectorRef,
      row.date,
      PLANILLA_CASH_CHAIN_SECONDARY,
    );

    let inicial: number | null = null;
    if (prevT) {
      inicial = pesos(prevT.closingCash);
    } else if (row.date === epoch) {
      // Arranque: Inicial hoy = Saldo ayer (caja real).
      inicial =
        prevAnnotated?.saldoShown != null
          ? pesos(prevAnnotated.saldoShown)
          : launchSaldo;
    } else if (prevAnnotated?.saldoShown != null) {
      inicial = pesos(prevAnnotated.saldoShown);
    }

    const mClosed = Boolean(
      findPlanillaCashClose(
        input.records,
        input.collectorRef,
        row.date,
        PLANILLA_CASH_CHAIN_PRIMARY,
      ),
    );
    const dayFinished = mClosed || row.date < today;

    let saldoShown: number | null = null;
    if (dayFinished && inicial != null) {
      saldoShown = pesos(
        inicial + pesos(row.cobroEfectivo) - pesos(row.gasto) - pesos(row.prestamo),
      );
    } else if (dayFinished) {
      saldoShown = pesos(row.saldo);
    }
    // Hoy abierto: Saldo — (aún no hay cierre).

    annotatedAscending.push({
      date: row.date,
      dateLabel: row.dateLabel,
      cobro: row.cobro,
      gasto: row.gasto,
      prestamo: row.prestamo,
      inicial,
      saldoShown,
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
 * M: Inicial = cierre T ayer; día época = saldo final de ayer una vez.
 *     Saldo = Inicial + efectivo − gasto − préstamo.
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
}): PlanillaChainHistoryRow[] {
  const route = String(input.routeName || "").trim();
  if (!isPlanillaCashChainRoute(route)) return [];
  const epoch = input.epoch || PLANILLA_CASH_CHAIN_HISTORY_EPOCH;
  const isM = isPlanillaCashChainPrimary(route);
  const ascending = [...input.rows]
    .filter((row) => row.date >= epoch)
    .sort((a, b) => a.date.localeCompare(b.date));

  const stamped: PlanillaChainHistoryRow[] = ascending.map((row) => {
    if (isM) {
      const prevT = findLatestPlanillaCashCloseBefore(
        input.records,
        input.collectorRef,
        row.date,
        PLANILLA_CASH_CHAIN_SECONDARY,
      );
      let inicial: number | null = null;
      if (prevT) inicial = pesos(prevT.closingCash);
      else if (row.date === epoch) inicial = pesos(input.epochBootstrapOpening);

      const saldo =
        inicial == null
          ? null
          : pesos(inicial + pesos(row.cobroEfectivo) - pesos(row.gasto) - pesos(row.prestamo));
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

