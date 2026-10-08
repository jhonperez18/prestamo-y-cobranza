/**
 * Celular del cobrador liviano: cerrada la jornada (y confirmada por la nube) suelta lo de
 * los días anteriores a ese cierre. Se queda con:
 * - el día del último cierre (su cuadre) y hoy;
 * - los cierres CIE- / PCE- (el de ayer es el Inicial de hoy);
 * - clientes y fichas de préstamos (el saldo vive en la ficha);
 * - todas las colas de subida.
 * El historial se baja al tocar un día (`pullCollectorHistoryDay`) y vuelve a soltarse.
 * En la nube no se borra nada.
 */
import { readSession } from "@/lib/auth";
import type { BankMovement } from "@/lib/bank";
import { businessTodayIso } from "@/lib/business-timezone";
import type { CollectorDailyLogRow } from "@/lib/collector-daily-log";
import {
  normalizeHistoryDate,
  type CollectorDayCloseRecord,
  type CollectorDayExpenseDraft,
} from "@/lib/collector-day-close";
import { isCollectorLiveDevice } from "@/lib/collector-live-window";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  DEMO_BANK_MOVEMENTS_KEY,
  DEMO_COLLECTOR_DAY_CLOSES_KEY,
  DEMO_COLLECTOR_DAY_EXPENSES_KEY,
  DEMO_DAILY_ASSIGNMENTS_KEY,
  DEMO_DAILY_LOGS_KEY,
  DEMO_PAYMENTS_KEY,
  DEMO_ROUTES_KEY,
  readDemoJson,
  releaseDemoRows,
} from "@/lib/demo-persist";
import { paymentVisitDate } from "@/lib/late-payment";
import type { PaymentRow, RouteRow } from "@/lib/mock-data";
import { countPendingMirrorQueues } from "@/lib/supabase/mirror-queue";

const DAY_CLOSE_REF_PREFIX = "CIE-";
const DAILY_ROUTE_DATE = /^RUT-D-.+-(\d{4}-\d{2}-\d{2})$/;

export type DeviceDayRows = {
  payments: PaymentRow[];
  assignments: DailyCollectionAssignment[];
  dayExpenseDrafts: CollectorDayExpenseDraft[];
  dailyLogs: CollectorDailyLogRow[];
  routes: RouteRow[];
  bankMovements: BankMovement[];
};

/**
 * Día del último cierre real del cobrador (CIE- sellado, no provisional) hasta hoy.
 * Lo anterior a ese día ya no hace falta en el celular. Sin cierre = no se suelta nada.
 */
export function collectorReleaseCutoff(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  today: string,
): string | null {
  let cutoff: string | null = null;
  for (const row of dayCloses) {
    if (row.collectorRef !== collectorRef || row.provisional) continue;
    if (!String(row.ref || "").startsWith(DAY_CLOSE_REF_PREFIX)) continue;
    const date = normalizeHistoryDate(row.date);
    if (!date || date > today) continue;
    if (!cutoff || date > cutoff) cutoff = date;
  }
  return cutoff;
}

/** Sin fecha legible: se queda (no se suelta a ciegas). */
function onOrAfter(raw: string | undefined, cutoff: string): boolean {
  const date = normalizeHistoryDate(raw ?? "");
  return !date || date >= cutoff;
}

/**
 * Filas que siguen en el celular. Cobros, planilla y movimientos de un día se sueltan
 * juntos: hidratar rearma cobros desde la planilla o el banco si queda uno sin el otro.
 * Un cobro tardío de hoy por un día viejo se queda (su caja es hoy).
 */
export function keepDeviceDaysFrom(rows: DeviceDayRows, cutoff: string): DeviceDayRows {
  return {
    payments: rows.payments.filter(
      (row) => onOrAfter(row.paidDate, cutoff) || onOrAfter(paymentVisitDate(row), cutoff),
    ),
    assignments: rows.assignments.filter((row) => onOrAfter(row.dispatchDate, cutoff)),
    dayExpenseDrafts: rows.dayExpenseDrafts.filter((row) => onOrAfter(row.date, cutoff)),
    dailyLogs: rows.dailyLogs.filter((row) => onOrAfter(row.date, cutoff)),
    routes: rows.routes.filter((row) => {
      const daily = DAILY_ROUTE_DATE.exec(String(row.ref || ""));
      return !daily || daily[1] >= cutoff;
    }),
    bankMovements: rows.bankMovements.filter((row) =>
      onOrAfter(row.valueDate || row.opDate, cutoff),
    ),
  };
}

export type DeviceReleaseResult = {
  released: number;
  cutoff: string | null;
  reason?: "not_collector" | "queue_pending" | "no_close" | "write_failed";
};

/**
 * Suelta del celular del cobrador lo anterior a su último cierre.
 * Solo con todas las colas en cero: lo que no subió nunca se toca.
 */
export function releaseClosedDaysOnDevice(today = businessTodayIso()): DeviceReleaseResult {
  const collectorRef = readSession()?.collectorRef?.trim() || "";
  if (!isCollectorLiveDevice() || !collectorRef) {
    return { released: 0, cutoff: null, reason: "not_collector" };
  }
  if (countPendingMirrorQueues().total > 0) {
    return { released: 0, cutoff: null, reason: "queue_pending" };
  }
  const dayCloses = readDemoJson<CollectorDayCloseRecord[]>(DEMO_COLLECTOR_DAY_CLOSES_KEY, []);
  const cutoff = collectorReleaseCutoff(dayCloses, collectorRef, today);
  if (!cutoff) return { released: 0, cutoff: null, reason: "no_close" };

  const current: DeviceDayRows = {
    payments: readDemoJson<PaymentRow[]>(DEMO_PAYMENTS_KEY, []),
    assignments: readDemoJson<DailyCollectionAssignment[]>(DEMO_DAILY_ASSIGNMENTS_KEY, []),
    dayExpenseDrafts: readDemoJson<CollectorDayExpenseDraft[]>(DEMO_COLLECTOR_DAY_EXPENSES_KEY, []),
    dailyLogs: readDemoJson<CollectorDailyLogRow[]>(DEMO_DAILY_LOGS_KEY, []),
    routes: readDemoJson<RouteRow[]>(DEMO_ROUTES_KEY, []),
    bankMovements: readDemoJson<BankMovement[]>(DEMO_BANK_MOVEMENTS_KEY, []),
  };
  const kept = keepDeviceDaysFrom(current, cutoff);
  // Cobros al final: si se corta a medias, no queda planilla vieja de la que rearmarlos.
  const writes: [string, unknown[], unknown[]][] = [
    [DEMO_DAILY_ASSIGNMENTS_KEY, current.assignments, kept.assignments],
    [DEMO_BANK_MOVEMENTS_KEY, current.bankMovements, kept.bankMovements],
    [DEMO_COLLECTOR_DAY_EXPENSES_KEY, current.dayExpenseDrafts, kept.dayExpenseDrafts],
    [DEMO_DAILY_LOGS_KEY, current.dailyLogs, kept.dailyLogs],
    [DEMO_ROUTES_KEY, current.routes, kept.routes],
    [DEMO_PAYMENTS_KEY, current.payments, kept.payments],
  ];
  let released = 0;
  for (const [key, before, after] of writes) {
    if (after.length === before.length) continue;
    // Cobros en [] nunca: se quedan los viejos hasta que haya alguno del día.
    if (key === DEMO_PAYMENTS_KEY && after.length === 0) continue;
    if (!releaseDemoRows(key, after)) {
      console.error("collector-device-release", key, "no se pudo guardar");
      return { released, cutoff, reason: "write_failed" };
    }
    released += before.length - after.length;
  }
  return { released, cutoff };
}
