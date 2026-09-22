import {
  assignmentsForCollector,
  assignmentsForCollectorDate,
  dispatchRouteRef,
} from "@/lib/collector-dispatch-sync";
import { normalizeHistoryDate, type CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import type { ClientRow, CollectorRow, LoanRow, PaymentRow, RouteRow } from "@/lib/mock-data";
import { paymentsForCollector } from "@/lib/mock-data";
import { normalizePaymentMethod, paymentMethodIsCash } from "@/lib/payment-method";

export type CollectorMobileQueue = {
  date: string;
  dateLabel: string;
  routeRef: string | null;
  routeName: string;
  /** Cobros ya enviados al móvil */
  dispatched: DailyCollectionAssignment[];
  pending: DailyCollectionAssignment[];
  done: DailyCollectionAssignment[];
  /** Asignados pero aún no enviados desde Cobranza */
  awaitingDispatch: DailyCollectionAssignment[];
  /** Cierre formal del cobrador/oficina (dayClosedAt o CIE-). */
  closed: boolean;
  /** Ya no quedan visitas pendientes (puede faltar el cierre formal). */
  allDone: boolean;
};

export type CollectorMobileRouteOption = {
  date: string;
  dateLabel: string;
  routeRef: string;
  routeName: string;
  pending: number;
  done: number;
  total: number;
  closed: boolean;
  allDone: boolean;
};

function hasDayCloseRecord(
  dayCloses: CollectorDayCloseRecord[],
  collectorRef: string,
  date: string,
) {
  const norm = normalizeHistoryDate(date);
  return dayCloses.some(
    (row) => row.collectorRef === collectorRef && normalizeHistoryDate(row.date) === norm,
  );
}

export function collectorMobileQueue(
  collectorRef: string,
  date: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  routes: RouteRow[] = [],
  dayCloses: CollectorDayCloseRecord[] = [],
  payments: PaymentRow[] = [],
): CollectorMobileQueue {
  const dayItems = assignmentsForCollectorDate(assignments, collectorRef, date, loans, clients);
  const closedByCie = hasDayCloseRecord(dayCloses, collectorRef, date);
  // Si el CIE ya existe, toda la hoja del día cuenta aunque falte flag dispatched.
  const sheet = closedByCie ? dayItems : dayItems.filter((row) => row.dispatched);
  const awaitingDispatch = closedByCie
    ? []
    : dayItems.filter((row) => !row.dispatched);
  const liveByRef = new Map(
    payments.filter((row) => !row.voidedAt?.trim()).map((row) => [row.ref, row] as const),
  );
  const isEffectivelyPaid = (row: DailyCollectionAssignment) => {
    if (row.visitStatus === "omitido") return false;
    const linked = (row.paymentRef || "").trim();
    if (!linked) return false;
    const pay = liveByRef.get(linked);
    if (!pay) return false;
    // PG de otro préstamo no cierra esta visita (EDUARDO ≠ EDUARDO P).
    if (pay.loanRef && row.loanRef && pay.loanRef !== row.loanRef) return false;
    return true;
  };

  // Pendientes reales (incl. préstamo nuevo tras CIE / pago anulado).
  const pending = sheet.filter((row) => {
    if (row.dayClosedAt && isEffectivelyPaid(row)) return false;
    if (row.dayClosedAt && row.visitStatus === "omitido") return false;
    // Tras anular: visita sellada sin PG vivo vuelve a pendiente cobrable.
    if (row.dayClosedAt && !isEffectivelyPaid(row) && row.visitStatus !== "omitido") {
      return true;
    }
    if (row.visitStatus === "omitido") return false;
    if (isEffectivelyPaid(row)) return false;
    return (
      row.visitStatus === "pendiente" ||
      row.visitStatus === "parcial" ||
      row.visitStatus === "cobrado" ||
      !row.visitStatus ||
      Boolean(row.paymentRef?.trim())
    );
  });
  const done = sheet.filter((row) => {
    if (row.visitStatus === "omitido") return true;
    if (isEffectivelyPaid(row)) return true;
    return false;
  });
  const closedByVisits =
    sheet.length > 0 && sheet.every((row) => Boolean(row.dayClosedAt));
  // Jornada “cerrada” solo si no quedan pendientes abiertos (préstamo nuevo sigue cobrable).
  const closed = (closedByCie || closedByVisits) && pending.length === 0;
  const routeRef = dispatchRouteRef(collectorRef, date);
  const route = routes.find((row) => row.ref === routeRef) ?? null;
  const allDone = closed || (sheet.length > 0 && pending.length === 0);

  return {
    date,
    dateLabel: isoToDispatchLabel(date),
    routeRef: route?.ref ?? null,
    routeName: route?.name ?? `Cobros · ${isoToDispatchLabel(date)}`,
    dispatched: sheet,
    pending,
    done,
    awaitingDispatch,
    closed,
    allDone,
  };
}

/** Rutas enviadas al cobrador (una por fecha de despacho). */
export function collectorMobileRoutes(
  collectorRef: string,
  assignments: DailyCollectionAssignment[],
  loans: LoanRow[],
  clients: ClientRow[],
  routes: RouteRow[] = [],
  dayCloses: CollectorDayCloseRecord[] = [],
  payments: PaymentRow[] = [],
): CollectorMobileRouteOption[] {
  const dispatchedRows = assignmentsForCollector(assignments, collectorRef, loans, clients).filter(
    (row) => row.dispatched || row.dayClosedAt,
  );
  const dates = [
    ...new Set([
      ...dispatchedRows.map((row) => normalizeHistoryDate(row.dispatchDate) || row.dispatchDate),
      ...dayCloses
        .filter((row) => row.collectorRef === collectorRef)
        .map((row) => normalizeHistoryDate(row.date))
        .filter(Boolean),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  return dates.map((date) => {
    const queue = collectorMobileQueue(
      collectorRef,
      date,
      assignments,
      loans,
      clients,
      routes,
      dayCloses,
      payments,
    );
    return {
      date,
      dateLabel: queue.dateLabel,
      routeRef: queue.routeRef ?? dispatchRouteRef(collectorRef, date),
      routeName: queue.routeName,
      pending: queue.pending.length,
      done: queue.done.length,
      total: queue.dispatched.length,
      closed: queue.closed,
      allDone: queue.allDone,
    };
  });
}

/**
 * ¿Hay planilla ENVIADA que el cobrador deba trabajar o cerrar?
 * Si es false → inicio = mismo panel de último cierre / saldo (todos iguales).
 * awaitingDispatch NO cuenta: aún no hay hoja en el móvil → mismo home idle.
 */
export function collectorHasOpenPlanillaWork(queue: CollectorMobileQueue): boolean {
  if (queue.closed) return false;
  if (queue.pending.length > 0) return true;
  // Hoja enviada aún abierta (aunque ya no haya pendientes): falta cerrar jornada.
  if (queue.dispatched.length > 0) return true;
  return false;
}

/**
 * Fecha de inicio de la app del cobrador (misma regla para todos):
 * 1) Jornada abierta atrasada CON hoja enviada (hay que cerrarla).
 * 2) Día con visitas pendientes.
 * 3) Hoy abierto con planilla asignada (total > 0).
 * 4) Último cierre formal → cuadre + saldo en caja (recordatorio).
 * 5) Hoy / fallback (home idle: mismo panel para todos).
 */
export function defaultMobileRouteDate(
  options: CollectorMobileRouteOption[],
  fallback = "",
): string {
  if (!options.length) return fallback;

  const openPast = options.find(
    (row) => !row.closed && row.date < fallback && row.total > 0,
  );
  if (openPast) return openPast.date;

  const withPending = options.find((row) => !row.closed && row.pending > 0);
  if (withPending) return withPending.date;

  const openTodayWithSheet = options.find(
    (row) => !row.closed && row.date === fallback && row.total > 0,
  );
  if (openTodayWithSheet) return openTodayWithSheet.date;

  const lastClosed = options
    .filter((row) => row.closed)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (lastClosed) return lastClosed.date;

  return fallback || options[0]!.date;
}

/** Suma de cobros del día por medio (efectivo / Nequi / Banco) para que el cobrador cuadre su caja. */
export function collectorRecaudoBreakdown(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  collectors: CollectorRow[] = [],
) {
  let efectivo = 0;
  let nequi = 0;
  let banco = 0;
  let count = 0;
  const norm = normalizeHistoryDate(date) || date;
  for (const row of paymentsForCollector(collectorRef, collectors, payments)) {
    if (normalizeHistoryDate(row.paidDate || "") !== norm) continue;
    count += 1;
    const method = normalizePaymentMethod(row.method);
    if (method === "nequi") nequi += row.amount;
    else if (method === "banco") banco += row.amount;
    else efectivo += row.amount;
  }
  return {
    efectivo,
    nequi,
    banco,
    /** Medios que no entran a caja (Nequi + Banco). */
    digital: nequi + banco,
    total: efectivo + nequi + banco,
    count,
  };
}

export function collectorRecaudoForDate(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  collectors: CollectorRow[] = [],
) {
  return collectorRecaudoBreakdown(collectorRef, date, payments, collectors).total;
}

export function visitStatusLabel(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "Pago";
  if (status === "parcial") return "Parcial";
  if (status === "omitido") return "sin cobro";
  return "Pendiente";
}

/** Etiqueta corta para planillas densas (app supervisor / tablas compactas). */
export function visitStatusLabelShort(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "pa";
  if (status === "parcial") return "pa";
  if (status === "omitido") return "S/C";
  return "pe";
}

export function visitStatusKind(status?: DailyCollectionAssignment["visitStatus"]) {
  if (status === "cobrado") return "ok" as const;
  if (status === "parcial") return "partial" as const;
  if (status === "omitido") return "overdue" as const;
  return "pending" as const;
}
