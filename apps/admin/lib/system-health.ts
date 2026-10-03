/**
 * Auto-evaluación. Función pura: recibe el estado ya hidratado y dice qué no cuadra
 * con las reglas del dominio. No lee storage ni red; el motor de reparación decide qué hacer.
 */
import { clientsOnRouteSorted } from "@/lib/client-route-order";
import { isOperationalClient, isPendingReview } from "@/lib/client-review";
import { isDailyCollectionDay } from "@/lib/colombia-holidays";
import type { CollectorDayCloseRecord } from "@/lib/collector-day-close";
import type { DailyCollectionAssignment } from "@/lib/daily-collection-plan";
import {
  activeLoans,
  catalogRoutes,
  isLoanVoided,
  routeIsActive,
  type ClientRow,
  type CollectorRow,
  type LoanRow,
  type RouteRow,
} from "@/lib/mock-data";
import { missingPriorDayCie } from "@/lib/planilla-cash-chain";
import { isAssignmentAwaitingLoan } from "@/lib/planilla-display";

export type HealthIssueKind =
  /** Cliente sin préstamos activos que no tiene su visita «Prestar» hoy. */
  | "prestar_missing"
  /** Visita «Prestar» pendiente de un cliente que tiene préstamo activo. */
  | "prestar_ghost"
  /** Cuota sin plata de un préstamo borrado ocupando la planilla. */
  | "deleted_loan_row"
  /** Día cerrado sin su CIE- en este aparato: el Inicial de M saldría del CIE de antes. */
  | "cie_missing"
  /** Filas en cola sin `ref`: nunca podrán subir. */
  | "queue_invalid_rows"
  /** Cola con pendientes hace demasiado tiempo. */
  | "queue_stuck";

/** Qué baja el motor para reparar: planilla (préstamos + planilla) o solo vaciar colas. */
export type HealthRepairScope = "planilla" | "queue";

export type HealthIssue = {
  kind: HealthIssueKind;
  ref: string;
  scope: HealthRepairScope;
};

export type SystemHealthReport = {
  ok: boolean;
  issues: HealthIssue[];
  /** Firma estable: mismas inconsistencias = misma firma (el motor no repara dos veces lo mismo). */
  signature: string;
};

export type QueueHealthInput = {
  pendingTotal: number;
  invalidRows: number;
  /** Desde cuándo hay pendientes sin interrupción (ms epoch); `null` si la cola está vacía. */
  pendingSinceMs: number | null;
};

export type SystemHealthInput = {
  date: string;
  nowMs: number;
  clients: ClientRow[];
  loans: LoanRow[];
  routes: RouteRow[];
  collectors: CollectorRow[];
  assignments: DailyCollectionAssignment[];
  dayCloses: CollectorDayCloseRecord[];
  deletedRefs: ReadonlySet<string>;
  queue: QueueHealthInput;
};

/** Pendientes por más de esto con red = cola atascada. */
export const QUEUE_STUCK_MS = 10 * 60_000;

function planillaIssues(input: SystemHealthInput): HealthIssue[] {
  const { date, clients, loans, routes, collectors, assignments, dayCloses, deletedRefs } = input;
  // Sin préstamos cargados no hay base para juzgar disponibilidad.
  if (!loans.length || !isDailyCollectionDay(date)) return [];

  const issues: HealthIssue[] = [];
  const loanByRef = new Map(loans.map((loan) => [loan.ref, loan] as const));
  const activeByClient = new Map<string, number>();
  for (const loan of activeLoans(loans)) {
    activeByClient.set(loan.clientRef, (activeByClient.get(loan.clientRef) ?? 0) + 1);
  }
  const loanVoided = (ref: string) => {
    if (!ref) return false;
    if (deletedRefs.has(ref)) return true;
    const loan = loanByRef.get(ref);
    return Boolean(loan && isLoanVoided(loan));
  };

  const today = assignments.filter((row) => row.dispatchDate === date);
  const clientsWithRow = new Set(today.map((row) => row.clientRef));
  const sealedCollectors = new Set(
    dayCloses
      .filter((close) => close.date === date && !close.provisional)
      .map((close) => close.collectorRef),
  );
  const closedSheets = new Set(
    today
      .filter((row) => row.dayClosedAt)
      .map((row) => `${row.collectorRef}|${String(row.clientRoute || "").trim()}`),
  );

  for (const row of today) {
    if (row.dayClosedAt) continue;
    const loanRef = String(row.loanRef || "").trim();
    if (isAssignmentAwaitingLoan(row)) {
      const pending = !row.visitStatus || row.visitStatus === "pendiente";
      if (pending && (activeByClient.get(row.clientRef) ?? 0) > 0) {
        issues.push({ kind: "prestar_ghost", ref: row.itemId, scope: "planilla" });
      }
      continue;
    }
    if (loanVoided(loanRef) && !row.paymentRef && row.visitStatus !== "cobrado") {
      issues.push({ kind: "deleted_loan_row", ref: row.itemId, scope: "planilla" });
    }
  }

  const collectorRefs = new Set(collectors.map((row) => row.ref));
  for (const route of catalogRoutes(routes)) {
    if (!routeIsActive(route) || !route.collectorRef) continue;
    if (!collectorRefs.has(route.collectorRef)) continue;
    if (sealedCollectors.has(route.collectorRef)) continue;
    if (closedSheets.has(`${route.collectorRef}|${route.name.trim()}`)) continue;
    for (const client of clientsOnRouteSorted(clients, route.name)) {
      if (!isOperationalClient(client) || isPendingReview(client)) continue;
      if ((activeByClient.get(client.ref) ?? 0) > 0) continue;
      if (clientsWithRow.has(client.ref)) continue;
      issues.push({ kind: "prestar_missing", ref: `${date}:${client.ref}`, scope: "planilla" });
    }
  }
  return issues;
}

/** Regla de inicio: cada día cerrado tiene su CIE- en el aparato (la reparación lo baja). */
function dayCloseIssues({ date, collectors, dayCloses }: SystemHealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const collector of collectors) {
    const missingDay = missingPriorDayCie(dayCloses, [], collector.ref, date);
    if (missingDay) {
      issues.push({ kind: "cie_missing", ref: `${collector.ref}:${missingDay}`, scope: "planilla" });
    }
  }
  return issues;
}

function queueIssues({ queue, nowMs }: SystemHealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (queue.invalidRows > 0) {
    issues.push({ kind: "queue_invalid_rows", ref: String(queue.invalidRows), scope: "queue" });
  }
  if (
    queue.pendingTotal > 0 &&
    queue.pendingSinceMs !== null &&
    nowMs - queue.pendingSinceMs >= QUEUE_STUCK_MS
  ) {
    issues.push({ kind: "queue_stuck", ref: String(queue.pendingTotal), scope: "queue" });
  }
  return issues;
}

export function evaluateSystemHealth(input: SystemHealthInput): SystemHealthReport {
  const issues = [...planillaIssues(input), ...dayCloseIssues(input), ...queueIssues(input)];
  const signature = issues
    .map((issue) => `${issue.kind}:${issue.ref}`)
    .sort()
    .join("|");
  return { ok: issues.length === 0, issues, signature };
}

/** Resumen corto para el monitor de aparatos: «prestar_ghost×2, queue_stuck×1». */
export function healthIssueSummary(report: SystemHealthReport): string {
  const counts = new Map<HealthIssueKind, number>();
  for (const issue of report.issues) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  return [...counts].map(([kind, n]) => `${kind}×${n}`).join(", ");
}
