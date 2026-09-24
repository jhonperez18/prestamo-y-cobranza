import {
  assignmentsForCollector,
  assignmentsForCollectorDate,
  dispatchRouteRef,
} from "@/lib/collector-dispatch-sync";
import { normalizeHistoryDate, type CollectorDayCloseRecord } from "@/lib/collector-day-close";
import { isoToDispatchLabel } from "@/lib/daily-dispatch";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import { isAssignmentAwaitingLoan } from "@/lib/planilla-display";
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
  /**
   * Hoja del día en orden de ruta: cobrables + sin préstamo (listos para prestar).
   * Los sin crédito van en azul, sin billete.
   */
  pending: DailyCollectionAssignment[];
  /** Solo visitas con cuota por cobrar (KPI «Por cobrar»). */
  pendingCollectCount: number;
  done: DailyCollectionAssignment[];
  /** Asignados pero aún no enviados desde Cobranza */
  awaitingDispatch: DailyCollectionAssignment[];
  /** Cierre formal del cobrador/oficina (dayClosedAt o CIE-). */
  closed: boolean;
  /** Ya no quedan visitas con cuota por cobrar (puede faltar el cierre formal). */
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

/** Fila de ruta sin crédito cobrable: listo para prestar, no es un cobro. */
function isRouteFiller(row: DailyCollectionAssignment) {
  return isAssignmentAwaitingLoan(row);
}

/**
 * Recaudo = cada PG vivo del día. Si la planilla no tiene la visita, el cobro igual se muestra.
 */
function recaudoFromDayPayments(
  collectorRef: string,
  date: string,
  sheet: DailyCollectionAssignment[],
  payments: PaymentRow[],
  loans: LoanRow[],
  clients: ClientRow[],
): DailyCollectionAssignment[] {
  const norm = normalizeHistoryDate(date) || date;
  const pays = collectorDayPayments(collectorRef, date, payments);
  const used = new Set<string>();
  return pays.map((pay) => {
    const visit = sheet.find((row) => {
      if (used.has(row.itemId)) return false;
      if ((row.paymentRef || "").trim() === pay.ref) return true;
      return Boolean(pay.loanRef && row.loanRef === pay.loanRef);
    });
    if (visit) used.add(visit.itemId);
    if (visit && String(visit.loanRef || "").trim()) {
      return {
        ...visit,
        visitStatus: "cobrado" as const,
        paymentRef: pay.ref,
        amountDue: 0,
        dispatched: true,
      };
    }
    const loan = loans.find((row) => row.ref === pay.loanRef);
    const client = clients.find((row) => row.ref === (loan?.clientRef || ""));
    const clientName = client
      ? `${client.name} ${client.lastName}`.trim()
      : pay.client;
    return {
      itemId: `pay:${pay.ref}`,
      dispatchDate: norm,
      loanRef: pay.loanRef || loan?.ref || "",
      clientRef: client?.ref || loan?.clientRef || "",
      clientName,
      clientRoute: client?.route || visit?.clientRoute || "",
      address: client?.address || visit?.address,
      amountDue: 0,
      chargeLabel: pay.chargeLabel || "Cuota",
      kind: "cuota",
      collectorRef,
      collector: pay.collector,
      assignedAt: pay.paidDate || norm,
      dispatched: true,
      visitStatus: "cobrado",
      paymentRef: pay.ref,
    };
  });
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
  const dayItems = assignmentsForCollectorDate(
    assignments,
    collectorRef,
    date,
    loans,
    clients,
    payments,
  );
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

  // Pendientes de la hoja: cobrables + sin préstamo (Prestar), en el orden de la ruta.
  // Los «filler» ya no se ocultan: van en azul, sin billete.
  const pending = sheet.filter((row) => {
    if (row.dayClosedAt && isEffectivelyPaid(row)) return false;
    if (row.dayClosedAt && row.visitStatus === "omitido") return false;
    if (isRouteFiller(row)) {
      // Sin crédito: sigue en hoja hasta prestar u omitir.
      if (row.visitStatus === "omitido") return false;
      return (
        row.visitStatus === "pendiente" ||
        !row.visitStatus ||
        Boolean(row.awaitingLoan)
      );
    }
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
  /** KPI: solo los que tienen cuota por cobrar (no los «Prestar»). */
  const pendingCollectCount = pending.filter((row) => !isRouteFiller(row)).length;
  const done = recaudoFromDayPayments(
    collectorRef,
    date,
    sheet,
    payments,
    loans,
    clients,
  );
  const closedByVisits =
    sheet.length > 0 && sheet.every((row) => Boolean(row.dayClosedAt));
  // Cierre / «listo» según cobros, no según filas Prestar.
  const closed = (closedByCie || closedByVisits) && pendingCollectCount === 0;
  const routeRef = dispatchRouteRef(collectorRef, date);
  const route = routes.find((row) => row.ref === routeRef) ?? null;
  const allDone = closed || (sheet.length > 0 && pendingCollectCount === 0);

  return {
    date,
    dateLabel: isoToDispatchLabel(date),
    routeRef: route?.ref ?? null,
    routeName: route?.name ?? `Cobros · ${isoToDispatchLabel(date)}`,
    dispatched: sheet,
    pending,
    pendingCollectCount,
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
      pending: queue.pendingCollectCount,
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
  // Incluye filas «Prestar»: la hoja sigue abierta aunque no haya cuota por cobrar.
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

/** Los PG del día que arman el recaudo. La lista y el total salen de aquí. */
export function collectorDayPayments(
  collectorRef: string,
  date: string,
  payments: PaymentRow[],
  collectors: CollectorRow[] = [],
) {
  const norm = normalizeHistoryDate(date) || date;
  return paymentsForCollector(collectorRef, collectors, payments).filter((row) => {
    const paid = normalizeHistoryDate(row.paidDate || "");
    return Boolean(paid) && paid === norm;
  });
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
  for (const row of collectorDayPayments(collectorRef, date, payments, collectors)) {
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
