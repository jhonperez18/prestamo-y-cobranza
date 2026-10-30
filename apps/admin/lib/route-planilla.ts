import { clientsOnRouteSorted, sameRoute } from "@/lib/client-route-order";
import { businessClockParts } from "@/lib/business-timezone";
import {
  assignmentFromItem,
  buildDispatchRoute,
  LOAN_GIVEN_TODAY_REASON,
  LOAN_RENEWED_TODAY_REASON,
  upsertDispatchRoute,
} from "@/lib/collector-dispatch-sync";
import { isAssignmentAwaitingLoan } from "@/lib/planilla-display";
import {
  collectionAlertLabel,
  collectionChargeKind,
  type CollectionPaymentTouch,
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
import { paymentVisitDate } from "@/lib/late-payment";
import { isCashlessRenewal, loanDisbursementIsoDate } from "@/lib/nequi-pool";
import { loanIsClosedHistory } from "@/lib/loan-renewal-marks";
import { displayToIso, syncLoan } from "@/lib/loan-preview";
import { readDeletedIdSet } from "@/lib/deleted-ids";
import { isCollectorLiveDevice, syncCollectorLiveLoan } from "@/lib/collector-live-window";
import {
  catalogRoutes,
  routeIsActive,
  activeLoans,
  isLoanVoided,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type PaymentRow,
  type RouteRow,
} from "@/lib/mock-data";

function clientLabel(client: ClientRow) {
  return `${client.name} ${client.lastName}`.trim();
}

/** Alta del cliente en el día de la hoja (DD/MM/AAAA o ISO). */
function clientBornOn(client: ClientRow, date: string) {
  const alta = displayToIso(String(client.alta || ""));
  return Boolean(date) && alta === date;
}

const SHEET_CLOSE_MINUTES = 23 * 60 + 30;

/**
 * La hoja de esa ruta ya cerró: el cobrador le dio Cerrar planilla,
 * o ya son las 23:30 (Bogotá). Mientras no pase eso, sigue abierta.
 */
export function routeSheetClosed(
  assignments: Pick<DailyCollectionAssignment, "dispatchDate" | "clientRoute" | "dayClosedAt">[],
  route: string,
  now = new Date(),
) {
  const routeName = String(route || "").trim();
  if (!routeName) return false;
  const clock = businessClockParts(now);
  if (clock.minutesSinceMidnight >= SHEET_CLOSE_MINUTES) return true;
  const visits = assignments.filter(
    (row) =>
      String(row.dispatchDate || "").slice(0, 10) === clock.dateIso &&
      sameRoute(String(row.clientRoute || ""), routeName),
  );
  if (!visits.length) return false;
  const sealed = visits.filter((row) => row.dayClosedAt).length;
  return sealed > 0 && sealed > visits.length - sealed;
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

function isPaymentRow(row: CollectionPaymentTouch): row is PaymentRow {
  return "ref" in row && Boolean((row as PaymentRow).ref);
}

/**
 * Saldo = el de la ficha. Una lista de cobros a la que le faltan días
 * (el 21 y el 22) inflaba la deuda. El cobrador suma solo el cobro de hoy
 * que la ficha todavía no trae.
 */
function loanOwes(loan: LoanRow, payments?: CollectionPaymentTouch[]) {
  if (loanIsClosedHistory(loan)) return 0;
  if (isCollectorLiveDevice()) {
    return pesos(syncCollectorLiveLoan(loan, (payments ?? []).filter(isPaymentRow)).balance);
  }
  const synced = syncLoan(loan) as LoanRow;
  if (Number.isFinite(Number(synced.balance))) return pesos(synced.balance);
  const total = pesos(loan.total ?? 0) || pesos(loan.capital) + pesos(loan.interest ?? 0);
  return pendingBalance(total, pesos(loan.paid ?? 0));
}

function paymentTouchesLoanOnDate(
  pay: CollectionPaymentTouch,
  loanRef: string,
  date: string,
) {
  return (
    paymentIsLive(pay) &&
    (pay.loanRef || "") === loanRef &&
    paymentVisitDate(pay) === date.trim() &&
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

/**
 * Índice de una pasada: préstamos activos por cliente y pagos por préstamo.
 * Sin esto cada cliente recorría todos los préstamos × todos los pagos
 * (≈15 M de vueltas cada 30 s en el celular del cobrador).
 */
type PlanillaLoanIndex = {
  activeByClient: Map<string, LoanRow[]>;
  loanByRef: Map<string, LoanRow>;
  /** `undefined` si no llegaron pagos (misma semántica que antes). */
  paymentsFor: (loanRef: string) => CollectionPaymentTouch[] | undefined;
  /** Borrado/cancelado (estado o tombstone de este aparato). */
  loanVoided: (loanRef: string) => boolean;
  /** Este aparato no sabe nada del préstamo (aún no lo cargó). */
  loanUnknown: (loanRef: string) => boolean;
};

const NO_PAYMENTS: CollectionPaymentTouch[] = [];

function buildPlanillaLoanIndex(
  loans: LoanRow[],
  payments?: CollectionPaymentTouch[],
): PlanillaLoanIndex {
  const activeByClient = new Map<string, LoanRow[]>();
  for (const loan of activeLoans(loans)) {
    if (loanIsClosedHistory(loan)) continue;
    const list = activeByClient.get(loan.clientRef);
    if (list) list.push(loan);
    else activeByClient.set(loan.clientRef, [loan]);
  }
  const loanByRef = new Map<string, LoanRow>();
  for (const loan of loans) {
    if (!loanByRef.has(loan.ref)) loanByRef.set(loan.ref, loan);
  }
  const byLoan = new Map<string, CollectionPaymentTouch[]>();
  for (const pay of payments ?? []) {
    const ref = pay.loanRef || "";
    const list = byLoan.get(ref);
    if (list) list.push(pay);
    else byLoan.set(ref, [pay]);
  }
  const deletedRefs = readDeletedIdSet();
  const loanVoided = (loanRef: string) => {
    const ref = String(loanRef || "").trim();
    if (!ref) return false;
    if (deletedRefs.has(ref)) return true;
    const loan = loanByRef.get(ref);
    return Boolean(loan && isLoanVoided(loan));
  };
  return {
    activeByClient,
    loanByRef,
    paymentsFor: (loanRef) => (payments ? (byLoan.get(loanRef) ?? NO_PAYMENTS) : undefined),
    loanVoided,
    loanUnknown: (loanRef) => {
      const ref = String(loanRef || "").trim();
      return Boolean(ref) && !loanByRef.has(ref) && !deletedRefs.has(ref);
    },
  };
}

/**
 * `sheetOpen`: la hoja de ese cobrador y ruta sigue abierta hoy.
 * A las 00:00 entran todos. Un préstamo de hoy sale, y solo vuelve si el
 * cronograma cobra ese mismo día. La renovación queda por cobrar hoy con la
 * hoja abierta. Con la hoja ya cerrada, el préstamo de hoy entra mañana.
 */
function loanItemsForClient(
  client: ClientRow,
  index: PlanillaLoanIndex,
  date: string,
  sheetOpen: boolean,
): DailyCollectionItem[] {
  const items: DailyCollectionItem[] = [];
  for (const loan of index.activeByClient.get(client.ref) ?? []) {
    const payments = index.paymentsFor(loan.ref);
    const owes = loanOwes(loan, payments);
    const paidToday = loanPaidOnDate(loan.ref, date, payments);
    // Saldo 0 de un día anterior no vuelve a la ruta. El cobro de hoy sí queda.
    if (owes <= 0 && !paidToday) continue;
    if (isPendingReview(client)) continue;
    const startedIso = loanDisbursementIsoDate(loan);
    // Hoja ya cerrada: el préstamo de hoy no reabre el día.
    if (startedIso === date && !paidToday && !sheetOpen) continue;
    // Renovación: la cuota nueva queda por cobrar hoy si la hoja sigue abierta.
    const renewalDueToday = startedIso === date && sheetOpen && isCashlessRenewal(loan);
    if (!renewalDueToday && !loanIsCollectibleOn(loan, date)) continue;

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
    chargeLabel: "Prestar",
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
  voidedPaymentRefs?: Set<string>,
): DailyCollectionAssignment {
  // Visita «prestar»: nunca heredar loanRef / monto de una fila vieja.
  const nextAwaiting =
    Boolean(next.awaitingLoan) ||
    String(next.itemId || "").includes(":prestar") ||
    !String(next.loanRef || "").trim();
  if (nextAwaiting) {
    // «Préstamo hecho hoy» cuyo préstamo ya no está (se borró): vuelve a Prestar.
    const keepsOmitted =
      previous?.visitStatus === "omitido" &&
      (previous.skipReason !== LOAN_GIVEN_TODAY_REASON || Boolean(previous.dayClosedAt));
    return {
      ...next,
      loanRef: "",
      amountDue: 0,
      alertCount: 0,
      awaitingLoan: true,
      chargeLabel: "Prestar",
      assignedAt: previous?.assignedAt || next.assignedAt,
      visitStatus: keepsOmitted ? "omitido" : next.visitStatus,
      skipReason: keepsOmitted ? previous?.skipReason : undefined,
      dayClosedAt: previous?.dayClosedAt,
      paymentRef: undefined,
      dispatched: true,
      dispatchedAt: previous?.dispatchedAt ?? next.dispatchedAt,
    };
  }
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
  const knownVoid = Boolean(linkedRef && voidedPaymentRefs?.has(linkedRef));
  const collectedOnSheet =
    !knownVoid && previous.visitStatus === "cobrado" && Boolean(linkedRef);
  const voidedPaid =
    !paymentStillLive &&
    !collectedOnSheet &&
    (previous.visitStatus === "cobrado" || Boolean(linkedRef));

  let visitStatus = previous.visitStatus ?? next.visitStatus;
  if (paid || collectedOnSheet) visitStatus = "cobrado";
  else if (omitted) visitStatus = "omitido";
  else if (voidedPaid) visitStatus = "pendiente";

  return {
    ...next,
    assignedAt: previous.assignedAt || next.assignedAt,
    visitStatus,
    skipReason: previous.skipReason,
    dayClosedAt: previous.dayClosedAt,
    paymentRef: paid || collectedOnSheet ? previous.paymentRef : undefined,
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
function visitIsOpenPending(row: DailyCollectionAssignment) {
  return row.visitStatus === "pendiente" || row.visitStatus === "parcial" || !row.visitStatus;
}

/** Mayor saldo gana. Empate: el préstamo más nuevo, luego el P- más alto. */
function pendingVisitBeats(
  row: DailyCollectionAssignment,
  other: DailyCollectionAssignment,
  index: PlanillaLoanIndex,
  owesFor: (loan: LoanRow) => number,
) {
  const rank = (visit: DailyCollectionAssignment) => {
    const loan = visit.loanRef ? index.loanByRef.get(visit.loanRef) : undefined;
    const owes = loan ? owesFor(loan) : 0;
    const started = loan ? loanDisbursementIsoDate(loan) : "";
    const refNum = Number(String(visit.loanRef || "").replace(/\D/g, "")) || 0;
    return { owes, started, refNum };
  };
  const a = rank(row);
  const b = rank(other);
  if (a.owes !== b.owes) return a.owes > b.owes;
  if (a.started !== b.started) return a.started > b.started;
  return a.refNum > b.refNum;
}

/**
 * Día abierto: un cliente, una visita por cobrar.
 * Prestar al lado de una cuota pendiente no se guarda.
 * Si pagó el total (saldo 0), el cobro se queda y vuelve Prestar.
 */
function oneOpenVisitPerClient(
  rows: DailyCollectionAssignment[],
  date: string,
  index: PlanillaLoanIndex,
  owesFor: (loan: LoanRow) => number,
) {
  const groups = new Map<string, DailyCollectionAssignment[]>();
  const kept: DailyCollectionAssignment[] = [];
  for (const row of rows) {
    if (row.dispatchDate !== date || row.dayClosedAt) {
      kept.push(row);
      continue;
    }
    const key = `${row.collectorRef}|${row.clientRef}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  for (const group of groups.values()) {
    const cuotas = group.filter((row) => !isAssignmentAwaitingLoan(row));
    if (!cuotas.length) {
      const decided = group.find((row) => row.visitStatus === "omitido" || row.visitStatus === "cobrado");
      kept.push(decided ?? group[0]);
      continue;
    }
    const pending = cuotas.filter(visitIsOpenPending);
    kept.push(...cuotas.filter((row) => !visitIsOpenPending(row)));
    if (!pending.length) {
      const paidOff = cuotas.every((row) => {
        const loan = row.loanRef ? index.loanByRef.get(row.loanRef) : undefined;
        if (!loan) return false;
        return owesFor(loan) <= 0;
      });
      if (paidOff) {
        const prestar = group.find(
          (row) => isAssignmentAwaitingLoan(row) && visitIsOpenPending(row),
        );
        if (prestar) kept.push(prestar);
      }
      continue;
    }
    kept.push(
      pending.reduce((best, row) =>
        pendingVisitBeats(row, best, index, owesFor) ? row : best,
      ),
    );
  }
  return kept;
}

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
  const voidedPaymentRefs = new Set<string>();
  const livePaymentsByRef = new Map(
    (payments ?? [])
      .filter((row) => {
        const ref = "ref" in row ? String((row as PaymentRow).ref || "").trim() : "";
        const voided = "voidedAt" in row ? String((row as PaymentRow).voidedAt || "").trim() : "";
        if (ref && voided) voidedPaymentRefs.add(ref);
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
  const index = buildPlanillaLoanIndex(loans, payments);
  const owesByLoan = new Map<LoanRow, number>();
  const owesFor = (loan: LoanRow) => {
    let owes = owesByLoan.get(loan);
    if (owes === undefined) {
      owes = loanOwes(loan, index.paymentsFor(loan.ref));
      owesByLoan.set(loan, owes);
    }
    return owes;
  };
  const loanGivenOnDate = (clientRef: string) =>
    (index.activeByClient.get(clientRef) ?? []).some(
      (loan) => loanDisbursementIsoDate(loan) === date,
    );
  // Visita de cuota hoy de un préstamo que este aparato aún no cargó: el cliente tiene
  // préstamo. Sin esto, un armado a medio cargar ofrecía Prestar a toda la ruta.
  // Préstamo conocido (activo, terminado o borrado) → decide `activeLoans`.
  const clientsWithUnloadedLoanToday = new Set(
    existing
      .filter(
        (prev) =>
          prev.dispatchDate === date &&
          prev.clientRef &&
          !isAssignmentAwaitingLoan(prev) &&
          index.loanUnknown(String(prev.loanRef || "")),
      )
      .map((prev) => `${prev.collectorRef}|${prev.clientRef}`),
  );

  const closedAtByCollectorRoute = new Map<string, string>();
  for (const row of existing) {
    if (row.dispatchDate !== date || !row.dayClosedAt) continue;
    const key = `${row.collectorRef}|${String(row.clientRoute || "").trim()}`;
    if (!closedAtByCollectorRoute.has(key)) closedAtByCollectorRoute.set(key, row.dayClosedAt);
  }

  for (const route of owned) {
    const collector = collectors.find((row) => row.ref === route.collectorRef);
    if (!collector) continue;
    const routeName = String(route.name || "").trim();
    const routeVisits = existing.filter(
      (row) =>
        row.dispatchDate === date &&
        row.collectorRef === collector.ref &&
        String(row.clientRoute || "").trim() === routeName,
    );
    const sealedCount = routeVisits.filter((row) => row.dayClosedAt).length;
    const openCount = routeVisits.length - sealedCount;
    // Hoja ya cerrada: no se le agregan visitas. Las selladas vuelven solas.
    if (sealedCount > 0 && sealedCount > openCount) continue;

    const sheetOpen = !closedAtByCollectorRoute.has(`${collector.ref}|${routeName}`);
    // Ya hay hoja: no se vuelve a armar. Se conserva lo que el cobrador lleva.
    // El alta de hoy entra sola, lista para prestar. El préstamo de hoy sale,
    // y solo vuelve si la primera cuota es ese mismo día.
    if (routeVisits.length > 0) {
      for (const prev of routeVisits) {
        if (prev.dayClosedAt) continue;
        if (
          isAssignmentAwaitingLoan(prev) &&
          prev.skipReason === LOAN_GIVEN_TODAY_REASON &&
          !loanGivenOnDate(prev.clientRef)
        ) {
          continue;
        }
        if (
          prev.loanRef &&
          !prev.paymentRef &&
          prev.visitStatus !== "cobrado" &&
          index.loanVoided(String(prev.loanRef))
        ) {
          continue;
        }
        builtMap.set(prev.itemId, prev);
      }
    }

    for (const client of clientsOnRouteSorted(clients, route.name)) {
      if (!isOperationalClient(client)) continue;
      if (routeVisits.length > 0 && !loanGivenOnDate(client.ref)) {
        const own = routeVisits.filter((row) => row.clientRef === client.ref);
        if (!own.length) {
          // Cliente creado hoy, hoja abierta, sin préstamo: entra solo él a Prestar.
          const bornToday = sheetOpen && clientBornOn(client, date);
          const free = !(index.activeByClient.get(client.ref)?.length);
          if (!bornToday || !free) continue;
        } else {
          const hasActive = (index.activeByClient.get(client.ref)?.length ?? 0) > 0;
          const openCuota = own.some(
            (row) => !row.dayClosedAt && !isAssignmentAwaitingLoan(row),
          );
          if (hasActive && openCuota) continue;
        }
      }
      const items = loanItemsForClient(client, index, date, sheetOpen);
      // El préstamo de hoy no se queda en por cobrar. El cobro de hoy sí queda.
      let dayItems = items;
      // `canClientTakeNewLoan` sobre el índice: libre ⇔ cero préstamos activos.
      const canTakeNewLoan = !(index.activeByClient.get(client.ref)?.length);
      // Sin cuota: queda en la hoja para prestar. Si no, no hay a quién prestarle.
      const unloadedLoanToday = clientsWithUnloadedLoanToday.has(`${collector.ref}|${client.ref}`);
      if (!dayItems.length && canTakeNewLoan && !unloadedLoanToday) {
        dayItems = [awaitingLoanItemForClient(client, date)];
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
          voidedPaymentRefs,
        );
        const paidTodayRef = paymentRefOnDate(item.loanRef, date, index.paymentsFor(item.loanRef));
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
    // Renovado hoy: resuelta sin cobro. Su préstamo ya cerró, pero el renglón queda en la lista.
    if (prev.visitStatus === "omitido" && prev.skipReason === LOAN_RENEWED_TODAY_REASON) {
      builtMap.set(prev.itemId, { ...prev, amountDue: 0, alertCount: 0 });
      continue;
    }
    const prestarRow = isAssignmentAwaitingLoan(prev);
    // «Préstamo hecho hoy» puesto a un cliente que no recibió préstamo hoy: fila fantasma.
    if (prestarRow && prev.skipReason === LOAN_GIVEN_TODAY_REASON && !loanGivenOnDate(prev.clientRef)) {
      continue;
    }
    // Prestar atendido: el cliente recibió préstamo hoy. La visita queda resuelta
    // (y cerrada si su hoja ya cerró); si se descarta, la copia abierta de la nube
    // vuelve por el pull y deja la jornada sin CIE-.
    if (
      prestarRow &&
      prev.visitStatus !== "omitido" &&
      prev.visitStatus !== "cobrado" &&
      loanGivenOnDate(prev.clientRef)
    ) {
      const routeClosedAt = closedAtByCollectorRoute.get(
        `${prev.collectorRef}|${String(prev.clientRoute || "").trim()}`,
      );
      builtMap.set(prev.itemId, {
        ...prev,
        loanRef: "",
        amountDue: 0,
        alertCount: 0,
        awaitingLoan: true,
        visitStatus: "omitido" as const,
        skipReason: LOAN_GIVEN_TODAY_REASON,
        paymentRef: undefined,
        dayClosedAt: routeClosedAt,
        dispatched: true,
        dispatchedAt: prev.dispatchedAt ?? at,
      });
      continue;
    }
    const linkedRef = (prev.paymentRef || "").trim();
    const linkedPay = linkedRef ? livePaymentsByRef.get(linkedRef) : undefined;
    const paymentStillLive =
      Boolean(linkedPay) &&
      (!prev.loanRef || !linkedPay?.loanRef || linkedPay.loanRef === prev.loanRef);
    const omitted = prev.visitStatus === "omitido";
    const paid = paymentStillLive && (prev.visitStatus === "cobrado" || Boolean(linkedRef));
    // Cobrado de hoy con PG: se queda hasta el cierre. Si este pase no trae el pago,
    // no se cambia por Prestar: esa visita abierta en la base impide cerrar la hoja.
    // Solo se suelta si este pase ve el PG anulado.
    const knownVoid = Boolean(linkedRef && voidedPaymentRefs.has(linkedRef));
    const collectedOnSheet =
      !knownVoid && prev.visitStatus === "cobrado" && Boolean(linkedRef);
    if (!paid && !omitted && !collectedOnSheet) continue;
    // Cuota de un préstamo borrado sin plata de por medio: el cliente queda libre (Prestar).
    if (!paid && !collectedOnSheet && index.loanVoided(String(prev.loanRef || ""))) continue;
    const prevLoan = prev.loanRef ? index.loanByRef.get(prev.loanRef) : undefined;
    const prevPaidToday = loanPaidOnDate(prev.loanRef, date, index.paymentsFor(prev.loanRef));
    const paidOffEarlier =
      Boolean(prev.loanRef && prevLoan && owesFor(prevLoan) <= 0) && !prevPaidToday;
    if (paidOffEarlier && !collectedOnSheet) continue;
    // La oferta Prestar de quien terminó hoy no reemplaza su cobro: se compara por préstamo.
    const loanAlreadyListed = [...builtMap.values()].some(
      (row) =>
        row.clientRef === prev.clientRef &&
        row.collectorRef === prev.collectorRef &&
        row.loanRef === prev.loanRef,
    );
    if (loanAlreadyListed && prevPaidToday) continue;
    const inBuilt =
      builtMap.has(prev.itemId) ||
      [...builtMap.values()].some((row) => {
        if (row.collectorRef !== prev.collectorRef) return false;
        if (row.clientRef !== prev.clientRef) return false;
        // Prestar (sin loanRef) no cubre una visita de cuota omitida/cobrada.
        if (prev.loanRef && !row.loanRef) return false;
        if (!prev.loanRef && row.loanRef) return false;
        return row.loanRef === prev.loanRef || !prev.loanRef || !row.loanRef;
      });
    if (inBuilt) continue;
    builtMap.set(prev.itemId, {
      ...prev,
      amountDue: 0,
      visitStatus: omitted ? ("omitido" as const) : ("cobrado" as const),
      paymentRef: paid || collectedOnSheet ? prev.paymentRef : undefined,
      dispatched: true,
      dispatchedAt: prev.dispatchedAt ?? at,
    });
  }

  const built = [...builtMap.values()];
  // Una persona, una visita en el día que se está armando. Prestar solo si es
  // la única. Dos cuotas pendientes: se queda la del préstamo que más debe.
  const builtUnique = oneOpenVisitPerClient(built, date, index, owesFor);
  const conCuota = new Set(
    builtUnique
      .filter((row) => row.dispatchDate === date && !isAssignmentAwaitingLoan(row))
      .map((row) => `${row.collectorRef}|${row.clientRef}`),
  );

  const kept = existing.filter((row) => {
    if (row.dispatchDate !== date) return true;
    if (!row.dayClosedAt) return false;
    if (
      isAssignmentAwaitingLoan(row) &&
      conCuota.has(`${row.collectorRef}|${row.clientRef}`)
    ) {
      return false;
    }
    return true;
  });

  // Solo valida/purga filas del día abierto recién armado; no toca otros días.
  const todayClean = purgeInvalidPlanillaAssignments(builtUnique, clients, loans);
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
 * Pagó todo hoy, hoja abierta → vuelve Prestar en la ruta (chulitos).
 * No rearma la ruta: sella la cuota liquidada de ese cliente y abre Prestar.
 * Recaudo no presta; la oferta vive solo aquí (hoja-diaria-lock).
 */
export function ensurePrestarAfterPaidOff(input: {
  date: string;
  clientRef: string;
  collectorRef: string;
  assignments: DailyCollectionAssignment[];
  clients: ClientRow[];
  loans: LoanRow[];
  payments: PaymentRow[];
  collectors: CollectorRow[];
}): DailyCollectionAssignment[] {
  const {
    date,
    clientRef,
    collectorRef,
    clients,
    loans,
    payments,
    collectors,
  } = input;
  let assignments = input.assignments;
  const client = clients.find((row) => row.ref === clientRef);
  if (!client || !isOperationalClient(client)) return assignments;
  const collector = collectors.find((row) => row.ref === collectorRef);
  if (!collector) return assignments;

  const routeName = String(client.route || "").trim();
  const routeVisits = assignments.filter(
    (row) =>
      row.dispatchDate === date &&
      row.collectorRef === collectorRef &&
      String(row.clientRoute || "").trim() === routeName,
  );
  if (routeVisits.length > 0 && routeVisits.every((row) => Boolean(row.dayClosedAt))) {
    return assignments;
  }

  const index = buildPlanillaLoanIndex(loans, payments);
  // Libre = nadie con saldo vivo. Ficha «Activo» en 0 (o cobro de hoy que la deja en 0) no bloquea.
  const stillOwes = (index.activeByClient.get(clientRef) ?? []).some(
    (loan) => owesForLoan(loan, index) > 0,
  );
  if (stillOwes) return assignments;

  assignments = assignments.map((row) => {
    if (row.dispatchDate !== date) return row;
    if (row.collectorRef !== collectorRef) return row;
    if (row.clientRef !== clientRef) return row;
    if (row.dayClosedAt) return row;
    if (isAssignmentAwaitingLoan(row)) return row;
    if (row.visitStatus === "cobrado" || row.visitStatus === "omitido") return row;
    const loanRef = String(row.loanRef || "").trim();
    if (!loanRef) return row;
    const loan = index.loanByRef.get(loanRef);
    if (!loan) return row;
    if (owesForLoan(loan, index) > 0) return row;
    const payRef = paymentRefOnDate(loanRef, date, index.paymentsFor(loanRef));
    if (!payRef && !loanPaidOnDate(loanRef, date, index.paymentsFor(loanRef))) {
      return row;
    }
    return {
      ...row,
      amountDue: 0,
      alertCount: 0,
      visitStatus: "cobrado" as const,
      paymentRef: row.paymentRef || payRef || undefined,
    };
  });

  const openPrestar = assignments.some(
    (row) =>
      row.dispatchDate === date &&
      row.collectorRef === collectorRef &&
      row.clientRef === clientRef &&
      isAssignmentAwaitingLoan(row) &&
      !row.dayClosedAt &&
      row.skipReason !== LOAN_GIVEN_TODAY_REASON &&
      (row.visitStatus === "pendiente" ||
        row.visitStatus === "parcial" ||
        !row.visitStatus),
  );
  if (openPrestar) return assignments;

  const openCuota = assignments.some(
    (row) =>
      row.dispatchDate === date &&
      row.collectorRef === collectorRef &&
      row.clientRef === clientRef &&
      !isAssignmentAwaitingLoan(row) &&
      !row.dayClosedAt &&
      (row.visitStatus === "pendiente" ||
        row.visitStatus === "parcial" ||
        !row.visitStatus),
  );
  if (openCuota) return assignments;

  const at = new Date().toISOString();
  const item = awaitingLoanItemForClient(client, date);
  return [
    ...assignments,
    {
      ...assignmentFromItem(item, collector, date),
      awaitingLoan: true,
      dispatched: true,
      dispatchedAt: at,
    },
  ];
}

function owesForLoan(loan: LoanRow, index: PlanillaLoanIndex) {
  return loanOwes(loan, index.paymentsFor(loan.ref));
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
