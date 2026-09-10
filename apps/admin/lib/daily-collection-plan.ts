import { displayToIso, isoToDisplay } from "@/lib/loan-preview";
import { lineRemaining, type ScheduleEntry } from "@/lib/loan-pay";
import {
  COLLECTION_ALERTS_BEFORE_MORA,
  collectionAlertLabel,
  collectionChargeKind,
  type CollectionPaymentTouch,
  liveLoanCollectionAlerts,
} from "@/lib/collection-alerts";
import { isPendingReview } from "@/lib/client-review";
import {
  activeLoans,
  type ClientRow,
  type LoanRow,
  type StatusKind,
} from "@/lib/mock-data";

function scheduleDateToIso(date: string) {
  const raw = String(date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return displayToIso(raw) || raw;
}

/** Primera fecha de cuota del cronograma (ISO), o null si no hay. */
export function firstScheduleCollectionIso(loan: LoanRow) {
  const lines = loan.schedule ?? [];
  if (!lines.length) return null;
  const dates = lines
    .map((line) => scheduleDateToIso(line.date))
    .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
    .sort();
  return dates[0] ?? null;
}

/**
 * ¿Ya puede entrar a planilla/cobro ese día?
 * Solo bloquea préstamo NUEVO el mismo día del desembolso si la 1.ª cuota es futura
 * (ej. prestó sábado → cobra lunes). No toca cartera ya operativa (Juan/Lina/etc.).
 */
export function loanIsCollectibleOn(loan: LoanRow, selectedDate: string) {
  const day = scheduleDateToIso(selectedDate);
  if (!day) return true;

  const first = firstScheduleCollectionIso(loan);
  if (!first || first <= day) return true;

  // 1.ª cuota aún no llega: solo aplica el día del desembolso.
  const disbursed = scheduleDateToIso(loan.date);
  if (disbursed && disbursed === day) return false;

  // Desembolso anterior + cronograma raro/regenerado → sigue en cobro diario.
  return true;
}

export type DailyCollectionItem = {
  id: string;
  loanRef: string;
  clientRef: string;
  clientName: string;
  clientRoute: string;
  address?: string;
  phone?: string;
  chargeDate: string;
  chargeLabel: string;
  amountDue: number;
  cuotaAmount: number;
  moraAmount: number;
  alertCount: number;
  kind: "cuota" | "alerta" | "mora";
  statusKind: StatusKind;
};

export type DailyCollectionAssignment = {
  itemId: string;
  dispatchDate: string;
  loanRef: string;
  clientRef: string;
  clientName: string;
  clientRoute: string;
  address?: string;
  chargeDate?: string;
  amountDue: number;
  chargeLabel: string;
  kind: "cuota" | "alerta" | "mora";
  collectorRef: string;
  collector: string;
  assignedAt: string;
  dispatched?: boolean;
  dispatchedAt?: string;
  visitStatus?: "pendiente" | "parcial" | "cobrado" | "omitido";
  skipReason?: string;
  /** Marca de cierre de jornada (oficina). */
  dayClosedAt?: string;
  paymentRef?: string;
  alertCount?: number;
  /** Cliente nuevo en ruta esperando primer préstamo (solo nombre + Prestar). */
  awaitingLoan?: boolean;
};

export function assignmentKey(itemId: string, dispatchDate: string) {
  return `${dispatchDate}::${itemId}`;
}

export function findAssignment(
  assignments: DailyCollectionAssignment[],
  itemId: string,
  dispatchDate: string,
) {
  return assignments.find(
    (row) => row.itemId === itemId && row.dispatchDate === dispatchDate,
  );
}

function clientName(client: ClientRow | undefined, fallback: string) {
  if (!client) return fallback;
  return `${client.name} ${client.lastName}`.trim();
}

function dueFromSchedule(loan: LoanRow, selectedDate: string) {
  const lines = loan.schedule ?? [];
  const day = scheduleDateToIso(selectedDate);
  const cuotaAmount = lines
    .filter((line) => scheduleDateToIso(line.date) === day)
    .reduce((sum, line) => sum + lineRemaining(line as ScheduleEntry), 0);
  const moraAmount = lines
    .filter((line) => scheduleDateToIso(line.date) < day)
    .reduce((sum, line) => sum + lineRemaining(line as ScheduleEntry), 0);
  const amountDue = Math.min(cuotaAmount + moraAmount, loan.balance);
  const oldestOverdue = lines.find(
    (line) =>
      scheduleDateToIso(line.date) < day && lineRemaining(line as ScheduleEntry) > 0,
  )?.date;
  return { cuotaAmount, moraAmount, amountDue, oldestOverdue };
}

function fallbackDueAmount(loan: LoanRow) {
  const installment = loan.installment ?? 0;
  if (installment > 0) return Math.min(installment, loan.balance);
  return loan.balance;
}

function accumulationLabel(cuotaAmount: number, moraAmount: number, alertCount: number) {
  if (alertCount >= COLLECTION_ALERTS_BEFORE_MORA || moraAmount > 0) {
    if (cuotaAmount > 0 && moraAmount > 0) return "Cuota + mora";
    if (moraAmount > 0) return "Mora acumulada";
  }
  if (alertCount > 0) return collectionAlertLabel(alertCount);
  return "Cuota";
}

/** Monto acumulado hasta la fecha. Mora solo al 4.º día hábil; antes es alerta 1–3. */
export function accumulatedDueForLoan(
  loan: LoanRow,
  selectedDate: string,
  payments?: CollectionPaymentTouch[],
) {
  const alertCount = liveLoanCollectionAlerts(loan, payments, selectedDate);
  const inMora = alertCount >= COLLECTION_ALERTS_BEFORE_MORA;
  const empty = {
    cuotaAmount: 0,
    moraAmount: 0,
    amountDue: 0,
    oldestOverdue: undefined as string | undefined,
    alertCount,
  };

  if ((loan.schedule?.length ?? 0) > 0) {
    // Solo bloquear préstamos nuevos: 1.ª cuota todavía no llega (ej. prestó sáb → lunes).
    if (!loanIsCollectibleOn(loan, selectedDate)) {
      return empty;
    }

    const fromSchedule = dueFromSchedule(loan, selectedDate);
    if (fromSchedule.amountDue > 0) {
      const past = fromSchedule.moraAmount;
      const today = fromSchedule.cuotaAmount;
      if (inMora) {
        return {
          ...fromSchedule,
          cuotaAmount: today,
          moraAmount: past,
          alertCount,
        };
      }
      // Sin mora aún: el atraso se cobra junto con la cuota, como alerta.
      return {
        cuotaAmount: today + past,
        moraAmount: 0,
        amountDue: fromSchedule.amountDue,
        oldestOverdue: fromSchedule.oldestOverdue,
        alertCount,
      };
    }
    // Ya en cobro operativo: cuota diaria (planilla de Juan/Lina, etc.).
    const cuota = fallbackDueAmount(loan);
    if (cuota > 0) {
      return {
        cuotaAmount: cuota,
        moraAmount: 0,
        amountDue: cuota,
        oldestOverdue: undefined as string | undefined,
        alertCount,
      };
    }
    return { ...fromSchedule, alertCount };
  }

  const fallback = fallbackDueAmount(loan);
  if (fallback <= 0) return empty;
  if (inMora) {
    return {
      cuotaAmount: 0,
      moraAmount: fallback,
      amountDue: fallback,
      oldestOverdue: selectedDate,
      alertCount,
    };
  }
  return {
    cuotaAmount: fallback,
    moraAmount: 0,
    amountDue: fallback,
    oldestOverdue: undefined as string | undefined,
    alertCount,
  };
}

/** Cobros del día: un registro por préstamo (cuota / alerta 1-3 / mora al 4). */
export function buildDailyCollectionList(
  loans: LoanRow[],
  clients: ClientRow[],
  selectedDate: string,
  payments?: CollectionPaymentTouch[],
): DailyCollectionItem[] {
  const items: DailyCollectionItem[] = [];

  for (const loan of activeLoans(loans)) {
    if (loan.balance <= 0) continue;
    const client = clients.find((row) => row.ref === loan.clientRef);
    if (client && isPendingReview(client)) continue;
    const { cuotaAmount, moraAmount, amountDue, oldestOverdue, alertCount } =
      accumulatedDueForLoan(loan, selectedDate, payments);
    if (amountDue <= 0) continue;

    const kind = collectionChargeKind(alertCount);
    items.push({
      loanRef: loan.ref,
      clientRef: loan.clientRef,
      clientName: clientName(client, loan.client),
      clientRoute: client?.route ?? "—",
      address: client?.address,
      phone: client?.phone,
      id: `${selectedDate}:${loan.ref}:acum`,
      chargeDate: oldestOverdue ?? selectedDate,
      chargeLabel: accumulationLabel(cuotaAmount, moraAmount, alertCount),
      amountDue,
      cuotaAmount,
      moraAmount,
      alertCount,
      kind,
      statusKind:
        kind === "mora"
          ? "overdue"
          : kind === "alerta"
            ? "warn"
            : cuotaAmount > 0 && loan.kind === "partial"
              ? "partial"
              : "pending",
    });
  }

  return items.sort(
    (a, b) =>
      b.alertCount - a.alertCount ||
      b.moraAmount - a.moraAmount ||
      a.clientName.localeCompare(b.clientName) ||
      a.loanRef.localeCompare(b.loanRef),
  );
}

export function dailyCollectionSummary(items: DailyCollectionItem[]) {
  const cuotas = items.filter((row) => row.kind === "cuota");
  const alertas = items.filter((row) => row.kind === "alerta");
  const mora = items.filter((row) => row.kind === "mora");
  return {
    total: items.length,
    cuotas: cuotas.length,
    alertas: alertas.length,
    mora: mora.length,
    totalDue: items.reduce((sum, row) => sum + row.amountDue, 0),
    cuotaDue: items.reduce((sum, row) => sum + row.cuotaAmount, 0),
    moraDue: items.reduce((sum, row) => sum + row.moraAmount, 0),
  };
}

export function formatChargeDate(iso: string) {
  return isoToDisplay(iso);
}
