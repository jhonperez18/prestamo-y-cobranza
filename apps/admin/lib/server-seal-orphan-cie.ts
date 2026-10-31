/**
 * CIE huérfano: hay planilla de un día pasado (visitas) y no hay CIE- en la nube.
 * Tras Fase 4.2 el celular ya no sube cash_float; si el cierre no pasó por
 * seal_day_close, el día queda sin CIE → al día siguiente Inicial M = 0
 * (cie_faltante). La revisión 6:00 debe sellar esos huecos, no solo reportarlos.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { normalizeHistoryDate, type CollectorDayCloseRecord } from "@/lib/collector-day-close";
import type { OperationalDayState } from "@/lib/collector-day-auto-close";
import { independentRouteForCollectorDay } from "@/lib/independent-route-cash";
import { findFullDayCieClose } from "@/lib/planilla-cash-chain";
import { planillaWindowStartIso } from "@/lib/planilla-window";
import { callSealDayClose } from "@/lib/server-seal-day-close";
import type { DayCashSources } from "@/lib/day-cash-ledger";

export type OrphanCieSeal = {
  collectorRef: string;
  collectorName: string;
  date: string;
  route: string;
  cashFloat?: number;
  error?: string;
};

function sourcesOf(
  state: OperationalDayState,
  collectorRef: string,
  collectorName: string,
  date: string,
): DayCashSources {
  return {
    collectorRef,
    collectorName,
    date,
    payments: state.payments,
    loans: state.loans,
    clients: state.clients,
    collectors: state.collectors,
    assignments: state.assignments,
    dayCloses: state.dayCloses,
    dayExpenseDrafts: state.dayExpenseDrafts,
    planillaCashCloses: state.planillaCashCloses ?? [],
    monthCloses: state.monthCloses ?? [],
  };
}

/** Días anteriores a hoy, en la ventana de planilla, con visitas y sin CIE- real. */
export function listOrphanCieDays(
  state: OperationalDayState,
  businessDate: string,
  windowStart: string,
): Array<{ collectorRef: string; collectorName: string; date: string; route: string }> {
  const firstCie = new Map<string, string>();
  for (const row of state.dayCloses) {
    if (!String(row.ref || "").startsWith("CIE-") || row.provisional) continue;
    const date = normalizeHistoryDate(row.date) || row.date;
    const prev = firstCie.get(row.collectorRef);
    if (date && (!prev || date < prev)) firstCie.set(row.collectorRef, date);
  }

  const days = new Map<string, { collectorRef: string; date: string; open: number; sealed: number }>();
  for (const row of state.assignments) {
    if (!row.dispatched || !row.collectorRef) continue;
    const date = normalizeHistoryDate(row.dispatchDate) || row.dispatchDate;
    if (!date || date >= businessDate || date < windowStart) continue;
    const key = `${row.collectorRef}::${date}`;
    const day = days.get(key) ?? {
      collectorRef: row.collectorRef,
      date,
      open: 0,
      sealed: 0,
    };
    if (row.dayClosedAt) day.sealed += 1;
    else day.open += 1;
    days.set(key, day);
  }

  const out: Array<{ collectorRef: string; collectorName: string; date: string; route: string }> = [];
  for (const day of days.values()) {
    const since = firstCie.get(day.collectorRef);
    if (!since || day.date < since) continue;
    if (findFullDayCieClose(state.dayCloses, day.collectorRef, day.date)) continue;
    // Solo si ya hubo sello de hoja o el día ya pasó completo (visitas aún abiertas
    // de un día pasado igual necesitan CIE para no dejar Inicial en 0).
    if (day.sealed === 0 && day.open === 0) continue;
    const collector = state.collectors.find((row) => row.ref === day.collectorRef);
    const name = collector?.name || day.collectorRef;
    const own = independentRouteForCollectorDay(
      sourcesOf(state, day.collectorRef, name, day.date),
    );
    out.push({
      collectorRef: day.collectorRef,
      collectorName: name,
      date: day.date,
      route: own || "",
    });
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.collectorRef.localeCompare(b.collectorRef),
  );
}

export async function sealOrphanDayCloses(
  state: OperationalDayState,
  now = new Date(),
): Promise<{ ok: boolean; sealed: OrphanCieSeal[]; errors: string[] }> {
  const businessDate = businessTodayIso(now);
  const orphans = listOrphanCieDays(state, businessDate, planillaWindowStartIso(now));
  const sealed: OrphanCieSeal[] = [];
  const errors: string[] = [];

  for (const orphan of orphans) {
    const result = await callSealDayClose({
      collectorRef: orphan.collectorRef,
      date: orphan.date,
      route: orphan.route,
      key: `orphan-cie|${orphan.collectorRef}|${orphan.date}`,
      by: "orphan-cie",
      writeCie: true,
      collectorName: orphan.collectorName,
    });
    if (!result.ok) {
      const msg = `${orphan.collectorName} ${orphan.date}: ${result.error}`;
      errors.push(msg);
      sealed.push({ ...orphan, error: result.error });
      continue;
    }
    sealed.push({
      ...orphan,
      cashFloat: result.cashFloat,
    });
    // Para el resto del barrido: el estado en memoria ya “tiene” CIE.
    if (result.ref && result.cashFloat != null) {
      const row: CollectorDayCloseRecord = {
        ref: result.ref,
        collectorRef: orphan.collectorRef,
        collectorName: orphan.collectorName,
        date: orphan.date,
        routeRef: `RUT-D-${orphan.collectorRef}-${orphan.date}`,
        collected: 0,
        expenses: [],
        expensesTotal: 0,
        cashFloat: result.cashFloat,
        closedAt: result.closedAt || new Date().toISOString(),
        movementRefs: [],
      };
      state.dayCloses = [...state.dayCloses.filter((r) => r.ref !== result.ref), row];
    }
  }

  return { ok: errors.length === 0, sealed, errors };
}
