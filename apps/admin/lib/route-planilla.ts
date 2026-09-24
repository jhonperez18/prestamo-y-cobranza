import { clientsOnRouteSorted } from "@/lib/client-route-order";
import {
  assignmentFromItem,
  buildDispatchRoute,
  upsertDispatchRoute,
} from "@/lib/collector-dispatch-sync";
import {
  collectionAlertLabel,
  collectionChargeKind,
  type CollectionPaymentTouch,
  liveLoanCollectionAlerts,
} from "@/lib/collection-alerts";
import { isPendingReview, isOperationalClient } from "@/lib/client-review";
import { isColombiaHoliday, isDailyCollectionDay, weekdayLabel } from "@/lib/colombia-holidays";
import {
  accumulatedDueForLoan,
  loanIsCollectibleOn,
  type DailyCollectionAssignment,
  type DailyCollectionItem,
} from "@/lib/daily-collection-plan";
import {
  purgeInvalidPlanillaAssignments,
} from "@/lib/planilla-eligibility";
import { dedupePlanillaAssignments } from "@/lib/planilla-dedupe";
import { pendingBalance, pesos } from "@/lib/finance";
import {
  catalogRoutes,
  routeIsActive,
  activeLoans,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";

function clientLabel(client: ClientRow) {
  return `${client.name} ${client.lastName}`.trim();
}

export { isValidPlanillaAssignment, purgeInvalidPlanillaAssignments } from "@/lib/planilla-eligibility";
export { dedupePlanillaAssignments } from "@/lib/planilla-dedupe";

/** Cuota pactada aunque `installment` se haya perdido en un pull. */
export function resolvedLoanInstallment(loan: LoanRow): number {
  const direct = Number(loan.installment) || 0;
  if (direct > 0) return direct;
  const lines = (loan.schedule ?? []).filter((line) => (line.kind ?? "cuota") !== "capital");
  const fromLine = lines.find((line) => Number(line.amount) > 0);
  if (fromLine) return Math.trunc(Number(fromLine.amount));
  const total = Number(loan.total) || Number(loan.capital) || 0;
  if (lines.length > 0 && total > 0) return Math.max(1, Math.trunc(total / lines.length));
  return 0;
}

function paymentIsLive(pay: CollectionPaymentTouch) {
  const row = pay as CollectionPaymentTouch & { voidedAt?: string; type?: string };
  if (String(row.voidedAt || "").trim()) return false;
  if (String(row.type || "") === "Anulado") return false;
  return true;
}

function collectedForLoan(loanRef: string, payments?: CollectionPaymentTouch[]) {
  let sum = 0;
  for (const pay of payments ?? []) {
    if ((pay.loanRef || "") !== loanRef || !paymentIsLive(pay)) continue;
    sum += pesos(pay.amount ?? 0);
  }
  return sum;
}

/** Saldo = total − PG vivos. Un Nequi ya registrado no vuelve como deuda. */
function loanOwes(loan: LoanRow, payments?: CollectionPaymentTouch[]) {
  const collected = collectedForLoan(loan.ref, payments);
  const total = pesos(loan.total ?? 0) || pesos(loan.capital) + pesos(loan.interest ?? 0);
  if (total > 0) return pendingBalance(total, collected);
  return pendingBalance(pesos(loan.balance) + collected, collected);
}

function paymentTouchesLoanOnDate(
  pay: CollectionPaymentTouch,
  loanRef: string,
  date: string,
) {
  return (
    paymentIsLive(pay) &&
    (pay.loanRef || "") === loanRef &&
    (pay.paidDate || "").trim() === date.trim() &&
    pesos(pay.amount ?? 0) > 0
  );
}

function loanPaidOnDate(loanRef: string, date: string, payments?: CollectionPaymentTouch[]) {
  if (!loanRef || !date.trim()) return false;
  return (payments ?? []).some((pay) => paymentTouchesLoanOnDate(pay, loanRef, date));
}

function paymentRefOnDate(
  loanRef: string,
  date: string,
  payments?: CollectionPaymentTouch[],
) {
  for (const pay of payments ?? []) {
    if (!paymentTouchesLoanOnDate(pay, loanRef, date)) continue;
    const ref = "ref" in pay ? String((pay as PaymentRow).ref || "").trim() : "";
    if (ref) return ref;
  }
  return "";
}

function loanItemsForClient(
  client: ClientRow,
  loans: LoanRow[],
  date: string,
  payments?: CollectionPaymentTouch[],
): DailyCollectionItem[] {
  const items: DailyCollectionItem[] = [];
  for (const loan of activeLoans(loans)) {
    const owes = loanOwes(loan, payments);
    const paidToday = loanPaidOnDate(loan.ref, date, payments);
    // Saldo 0 de un día anterior no vuelve a la ruta. El cobro de hoy sí queda.
    if (loan.clientRef !== client.ref || (owes <= 0 && !paidToday)) continue;
    if (isPendingReview(client)) continue;
    if (!loanIsCollectibleOn(loan, date)) continue;

    const installment = resolvedLoanInstallment(loan);
    const pactada = paidToday && owes <= 0 ? 0 : Math.min(installment > 0 ? installment : owes, owes);
    if (pactada <= 0 && !paidToday) continue;

    // Acumulado solo para etiquetas/alertas; el monto a cobrar es la cuota pactada.
    const { cuotaAmount, moraAmount, oldestOverdue, alertCount } =
      accumulatedDueForLoan(loan, date, payments);
    const liveAlerts = alertCount;
    const kind = collectionChargeKind(liveAlerts);

    items.push({
      id: `${date}:${loan.ref}:acum`,
      loanRef: loan.ref,
      clientRef: client.ref,
      clientName: clientLabel(client),
      clientRoute: client.route,
      address: client.address,
      phone: client.phone,
      chargeDate: oldestOverdue ?? date,
      chargeLabel:
        kind === "mora" && moraAmount > 0 && cuotaAmount > 0
          ? "Cuota + mora"
          : kind === "mora"
            ? collectionAlertLabel(liveAlerts) || "Mora"
            : liveAlerts > 0
              ? collectionAlertLabel(liveAlerts)
              : "Cuota",
      amountDue: pactada,
      cuotaAmount: pactada,
      moraAmount,
      alertCount: liveAlerts,
      kind,
      statusKind:
        kind === "mora" ? "overdue" : kind === "alerta" ? "warn" : "pending",
    });
  }
  return items;
}

/** Cliente de la ruta sin cobro cobrable hoy → sigue en planilla (Completar). */
function awaitingLoanItemForClient(client: ClientRow, date: string): DailyCollectionItem {
  return {
    id: `${date}:${client.ref}:prestar`,
    loanRef: "",
    clientRef: client.ref,
    clientName: clientLabel(client),
    clientRoute: client.route,
    address: client.address,
    phone: client.phone,
    chargeDate: date,
    chargeLabel: "Completar",
    amountDue: 0,
    cuotaAmount: 0,
    moraAmount: 0,
    alertCount: 0,
    kind: "cuota",
    statusKind: "pending",
  };
}

function preserveProgress(
  next: DailyCollectionAssignment,
  previous: DailyCollectionAssignment | undefined,
  livePaymentsByRef?: Map<string, { loanRef?: string }>,
): DailyCollectionAssignment {
  if (!previous) return next;
  const linkedRef = (previous.paymentRef || "").trim();
  const linkedPay = linkedRef ? livePaymentsByRef?.get(linkedRef) : undefined;
  const paymentStillLive =
    Boolean(linkedPay) &&
    (!previous.loanRef ||
      !linkedPay?.loanRef ||
      linkedPay.loanRef === previous.loanRef ||
      linkedPay.loanRef === next.loanRef);
  // Solo conservar “cobrado” si el PG sigue vivo y es de este préstamo.
  const paid =
    paymentStillLive &&
    (previous.visitStatus === "cobrado" || Boolean(linkedRef));
  const omitted = previous.visitStatus === "omitido";
  const voidedPaid =
    !paymentStillLive &&
    (previous.visitStatus === "cobrado" || Boolean(linkedRef));

  let visitStatus = previous.visitStatus ?? next.visitStatus;
  if (paid) visitStatus = "cobrado";
  else if (omitted) visitStatus = "omitido";
  else if (voidedPaid) visitStatus = "pendiente";

  return {
    ...next,
    assignedAt: previous.assignedAt || next.assignedAt,
    visitStatus,
    skipReason: previous.skipReason,
    dayClosedAt: previous.dayClosedAt,
    paymentRef: paid ? previous.paymentRef : undefined,
    amountDue: paid || omitted ? 0 : next.amountDue,
    alertCount: paid || omitted ? 0 : next.alertCount,
    kind: paid || omitted ? ("cuota" as const) : next.kind,
    chargeLabel: paid || omitted ? "Cuota" : next.chargeLabel,
    loanRef: previous.loanRef || next.loanRef,
    dispatched: true,
    dispatchedAt: previous.dispatchedAt ?? next.dispatchedAt,
  };
}

function keepAssignmentsOutsideOpenDay(
  existing: DailyCollectionAssignment[],
  date: string,
  _clients: ClientRow[],
  _loans: LoanRow[],
) {
  // Nunca borrar historial de otros días ni cierres: aunque falte el préstamo/cliente
  // en storage (p.ej. tras un wipe legado), el registro del día cerrado es evidencia.
  return existing.filter((row) => {
    if (row.dispatchDate !== date) return true;
    if (row.dayClosedAt) return true;
    return false;
  });
}

/** Motivo si hoy no corre cobro (domingo / festivo). */
export function planillaDayBlockedReason(date: string) {
  if (isDailyCollectionDay(date)) return null;
  if (weekdayLabel(date) === "domingo") return "Domingo: no se genera planilla.";
  if (isColombiaHoliday(date)) return `Festivo: no se genera planilla.`;
  return "Hoy no es día de cobro.";
}

/**
 * Planilla del día desde asignación permanente ruta → cobrador.
 * Lun–sáb (sin festivos). Se envía sola a la APP (dispatched).
 */
export function syncPermanentRoutePlanilla(
  date: string,
  routes: RouteRow[],
  clients: ClientRow[],
  loans: LoanRow[],
  collectors: CollectorRow[],
  existing: DailyCollectionAssignment[],
  payments?: CollectionPaymentTouch[] | PaymentRow[],
): { assignments: DailyCollectionAssignment[]; routes: RouteRow[] } {
  // Domingo / festivo: no crear planilla; limpia abiertas del día.
  if (!isDailyCollectionDay(date)) {
    return {
      assignments: keepAssignmentsOutsideOpenDay(existing, date, clients, loans),
      routes,
    };
  }

  const owned = catalogRoutes(routes).filter(
    (route) => routeIsActive(route) && Boolean(route.collectorRef),
  );

  const previousByKey = new Map(
    existing
      .filter((row) => row.dispatchDate === date)
      .map((row) => [`${row.itemId}`, row] as const),
  );
  const previousByClientLoan = new Map(
    existing
      .filter((row) => row.dispatchDate === date && row.clientRef)
      .map((row) => [`${row.clientRef}:${row.loanRef || ""}`, row] as const),
  );
  const livePaymentsByRef = new Map(
    (payments ?? [])
      .filter((row) => {
        const voided = "voidedAt" in row ? String((row as PaymentRow).voidedAt || "").trim() : "";
        return !voided;
      })
      .filter((row) => "ref" in row && Boolean((row as PaymentRow).ref))
      .map((row) => {
        const pay = row as PaymentRow;
        return [String(pay.ref), { loanRef: pay.loanRef }] as const;
      }),
  );

  const builtMap = new Map<string, DailyCollectionAssignment>();
  const at = new Date().toISOString();

  for (const route of owned) {
    const collector = collectors.find((row) => row.ref === route.collectorRef);
    if (!collector) continue;

    for (const client of clientsOnRouteSorted(clients, route.name)) {
      if (!isOperationalClient(client)) continue;
      // Toda la ruta diaria: cobrables + sin préstamo (Completar).
      // Quien ya pagó/omitió hoy no vuelve a pendiente como Completar.
      const items = loanItemsForClient(client, loans, date, payments);
      // Cada préstamo de hoy se queda en la ruta. El ya cobrado sale en cobrado,
      // no se borra: si se borra, el recaudo desaparece y solo quedan los gastos.
      let dayItems = items;
      if (!dayItems.length) {
        const settledToday = existing.some((prev) => {
          if (prev.dispatchDate !== date) return false;
          if (prev.collectorRef !== collector.ref) return false;
          if (prev.clientRef !== client.ref) return false;
          if (prev.visitStatus === "omitido") return true;
          const linked = (prev.paymentRef || "").trim();
          return Boolean(linked && livePaymentsByRef.has(linked));
        });
        if (!settledToday) dayItems = [awaitingLoanItemForClient(client, date)];
      }
      for (const item of dayItems) {
        const base = {
          ...assignmentFromItem(item, collector, date),
          awaitingLoan: !String(item.loanRef || "").trim() || item.id.includes(":prestar"),
          dispatched: true,
          dispatchedAt: at,
        };
        const progressed = preserveProgress(
          base,
          previousByKey.get(item.id) ??
            previousByClientLoan.get(`${item.clientRef}:${item.loanRef}`) ??
            previousByClientLoan.get(`${item.clientRef}:`),
          livePaymentsByRef,
        );
        const paidTodayRef = paymentRefOnDate(item.loanRef, date, payments);
        builtMap.set(
          item.id,
          paidTodayRef
            ? {
                ...progressed,
                amountDue: 0,
                visitStatus: "cobrado" as const,
                paymentRef: progressed.paymentRef || paidTodayRef,
              }
            : progressed,
        );
      }
    }
  }

  // Visitas ya cobradas/omitidas del día abierto: no se pierden si el préstamo
  // ya no genera cuota (saldo 0) o el itemId cambió al regenerar.
  // Si el PG fue anulado, no se reinyecta como cobrado.
  for (const prev of existing) {
    if (prev.dispatchDate !== date) continue;
    if (prev.dayClosedAt) continue;
    const linkedRef = (prev.paymentRef || "").trim();
    const linkedPay = linkedRef ? livePaymentsByRef.get(linkedRef) : undefined;
    const paymentStillLive =
      Boolean(linkedPay) &&
      (!prev.loanRef || !linkedPay?.loanRef || linkedPay.loanRef === prev.loanRef);
    const omitted = prev.visitStatus === "omitido";
    const paid = paymentStillLive && (prev.visitStatus === "cobrado" || Boolean(linkedRef));
    if (!paid && !omitted) continue;
    const prevLoan = loans.find((entry) => entry.ref === prev.loanRef);
    const paidOffEarlier =
      Boolean(prev.loanRef && prevLoan && loanOwes(prevLoan, payments) <= 0) &&
      !loanPaidOnDate(prev.loanRef, date, payments);
    if (paidOffEarlier) continue;
    const clientAlreadyListed = [...builtMap.values()].some(
      (row) => row.clientRef === prev.clientRef && row.collectorRef === prev.collectorRef,
    );
    if (clientAlreadyListed && loanPaidOnDate(prev.loanRef, date, payments)) continue;
    const inBuilt =
      builtMap.has(prev.itemId) ||
      [...builtMap.values()].some(
        (row) =>
          row.collectorRef === prev.collectorRef &&
          row.clientRef === prev.clientRef &&
          (row.loanRef === prev.loanRef || !prev.loanRef || !row.loanRef),
      );
    if (inBuilt) continue;
    builtMap.set(prev.itemId, {
      ...prev,
      amountDue: 0,
      visitStatus: omitted ? ("omitido" as const) : ("cobrado" as const),
      paymentRef: paid ? prev.paymentRef : undefined,
      dispatched: true,
      dispatchedAt: prev.dispatchedAt ?? at,
    });
  }

  const built = [...builtMap.values()];

  const kept = existing.filter((row) => {
    if (row.dispatchDate !== date) return true;
    if (row.dayClosedAt) return true;
    // Sustituye solo el día abierto actual; historial y cierres se conservan siempre.
    return false;
  });

  // Solo valida/purga filas del día abierto recién armado; no toca otros días.
  const todayClean = purgeInvalidPlanillaAssignments(built, clients, loans);
  const assignments = dedupePlanillaAssignments([...kept, ...todayClean]);

  let nextRoutes = routes;
  // Actualiza conteo de clientes en rutas de catálogo (para listados / fichas).
  nextRoutes = nextRoutes.map((row) => {
    if (row.ref.startsWith("RUT-D-")) return row;
    const count = clientsOnRouteSorted(clients, row.name).length;
    return count === row.clients ? row : { ...row, clients: count };
  });

  const collectorRefs = [...new Set(built.map((row) => row.collectorRef))];
  for (const collectorRef of collectorRefs) {
    const collector = collectors.find((row) => row.ref === collectorRef);
    if (!collector) continue;
    const existingRoute = nextRoutes.find(
      (row) => row.ref === `RUT-D-${collectorRef}-${date}`,
    );
    nextRoutes = upsertDispatchRoute(
      nextRoutes,
      buildDispatchRoute(
        collectorRef,
        collector.name,
        date,
        assignments,
        loans,
        clients,
        existingRoute,
      ),
    );
  }

  return { assignments, routes: nextRoutes };
}

/**
 * Asigna el cobrador a una ruta de catálogo. Un cobrador puede tener varias
 * rutas (ej. «1» mañana y «1.1» tarde): la planilla del día las une en ese orden.
 */
export function assignCollectorToCatalogRoute(
  routes: RouteRow[],
  routeRef: string,
  collectorRef: string,
  collectorName: string,
): RouteRow[] {
  return routes.map((row) => {
    if (row.ref.startsWith("RUT-D-")) return row;
    if (row.ref !== routeRef) return row;
    return {
      ...row,
      collectorRef: collectorRef || "",
      collector: collectorRef ? collectorName : "—",
    };
  });
}
