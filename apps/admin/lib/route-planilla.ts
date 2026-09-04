import { clientsOnRouteSorted } from "@/lib/client-route-order";
import {
  assignmentFromItem,
  buildDispatchRoute,
  upsertDispatchRoute,
} from "@/lib/collector-dispatch-sync";
import {
  collectionAlertLabel,
  collectionChargeKind,
  loanCollectionAlerts,
} from "@/lib/collection-alerts";
import { isPendingReview } from "@/lib/client-review";
import { isColombiaHoliday, isDailyCollectionDay, weekdayLabel } from "@/lib/colombia-holidays";
import {
  accumulatedDueForLoan,
  type DailyCollectionAssignment,
  type DailyCollectionItem,
} from "@/lib/daily-collection-plan";
import {
  isValidPlanillaAssignment,
  purgeInvalidPlanillaAssignments,
} from "@/lib/planilla-eligibility";
import {
  catalogRoutes,
  routeIsActive,
  activeLoans,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type RouteRow,
} from "@/lib/mock-data";

function clientLabel(client: ClientRow) {
  return `${client.name} ${client.lastName}`.trim();
}

export { isValidPlanillaAssignment, purgeInvalidPlanillaAssignments } from "@/lib/planilla-eligibility";

function loanItemsForClient(
  client: ClientRow,
  loans: LoanRow[],
  date: string,
): DailyCollectionItem[] {
  const items: DailyCollectionItem[] = [];
  for (const loan of activeLoans(loans)) {
    if (loan.clientRef !== client.ref || loan.balance <= 0) continue;
    if (isPendingReview(client)) continue;
    let { cuotaAmount, moraAmount, amountDue, oldestOverdue, alertCount } =
      accumulatedDueForLoan(loan, date);
    // Si el cronograma no trae vencido hoy, igual cobramos la cuota diaria fija.
    if (amountDue <= 0) {
      const cuota = Math.min(loan.installment ?? 0, loan.balance);
      if (cuota <= 0) continue;
      cuotaAmount = cuota;
      moraAmount = 0;
      amountDue = cuota;
      oldestOverdue = undefined;
      alertCount = loanCollectionAlerts(loan);
    }
    const kind = collectionChargeKind(alertCount);
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
        kind === "mora" && cuotaAmount > 0 && moraAmount > 0
          ? "Cuota + mora"
          : kind === "mora"
            ? collectionAlertLabel(alertCount) || "Mora"
            : alertCount > 0
              ? collectionAlertLabel(alertCount)
              : "Cuota",
      amountDue,
      cuotaAmount,
      moraAmount,
      alertCount,
      kind,
      statusKind:
        kind === "mora" ? "overdue" : kind === "alerta" ? "warn" : "pending",
    });
  }
  return items;
}

function preserveProgress(
  next: DailyCollectionAssignment,
  previous: DailyCollectionAssignment | undefined,
): DailyCollectionAssignment {
  if (!previous) return next;
  return {
    ...next,
    assignedAt: previous.assignedAt || next.assignedAt,
    visitStatus: previous.visitStatus ?? next.visitStatus,
    skipReason: previous.skipReason,
    dayClosedAt: previous.dayClosedAt,
    paymentRef: previous.paymentRef,
    dispatched: true,
    dispatchedAt: previous.dispatchedAt ?? next.dispatchedAt,
  };
}

function keepAssignmentsOutsideOpenDay(
  existing: DailyCollectionAssignment[],
  date: string,
  clients: ClientRow[],
  loans: LoanRow[],
) {
  const kept = existing.filter((row) => {
    if (!isValidPlanillaAssignment(row, clients, loans)) return false;
    if (row.dispatchDate !== date) return true;
    if (row.dayClosedAt) return true;
    return false;
  });
  return purgeInvalidPlanillaAssignments(kept, clients, loans);
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

  const built: DailyCollectionAssignment[] = [];
  const at = new Date().toISOString();

  for (const route of owned) {
    const collector = collectors.find((row) => row.ref === route.collectorRef);
    if (!collector) continue;

    for (const client of clientsOnRouteSorted(clients, route.name)) {
      // Solo cobros reales: no inventar “visita de ruta” si el cliente no tiene cuota.
      const items = loanItemsForClient(client, loans, date);
      if (!items.length) continue;
      for (const item of items) {
        const base = {
          ...assignmentFromItem(item, collector, date),
          dispatched: true,
          dispatchedAt: at,
        };
        built.push(preserveProgress(base, previousByKey.get(item.id)));
      }
    }
  }

  const kept = existing.filter((row) => {
    if (!isValidPlanillaAssignment(row, clients, loans)) return false;
    if (row.dispatchDate !== date) return true;
    if (row.dayClosedAt) return true;
    // Sustituye el día abierto por la planilla permanente actual.
    return false;
  });

  const assignments = purgeInvalidPlanillaAssignments(
    [...kept, ...built],
    clients,
    loans,
  );

  let nextRoutes = routes;
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

/** Un cobrador = una ruta de catálogo (al reasignar, se libera la anterior). */
export function assignCollectorToCatalogRoute(
  routes: RouteRow[],
  routeRef: string,
  collectorRef: string,
  collectorName: string,
): RouteRow[] {
  return routes.map((row) => {
    if (row.ref.startsWith("RUT-D-")) return row;
    if (row.ref === routeRef) {
      return {
        ...row,
        collectorRef: collectorRef || "",
        collector: collectorRef ? collectorName : "—",
      };
    }
    if (collectorRef && row.collectorRef === collectorRef) {
      return { ...row, collectorRef: "", collector: "—" };
    }
    return row;
  });
}
