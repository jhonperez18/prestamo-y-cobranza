import { isoToDisplay } from "@/lib/loan-preview";
import { lineRemaining, type ScheduleEntry } from "@/lib/loan-pay";
import {
  collectionAlertLabel,
  collectionChargeKind,
  isLoanInCollectionMora,
  loanCollectionAlerts,
} from "@/lib/collection-alerts";
import { isPendingReview } from "@/lib/client-review";
import {
  activeLoans,
  type ClientRow,
  type LoanRow,
  type StatusKind,
} from "@/lib/mock-data";

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
  const cuotaAmount = lines
    .filter((line) => line.date === selectedDate)
    .reduce((sum, line) => sum + lineRemaining(line as ScheduleEntry), 0);
  const moraAmount = lines
    .filter((line) => line.date < selectedDate)
    .reduce((sum, line) => sum + lineRemaining(line as ScheduleEntry), 0);
  const amountDue = Math.min(cuotaAmount + moraAmount, loan.balance);
  const oldestOverdue = lines.find(
    (line) => line.date < selectedDate && lineRemaining(line as ScheduleEntry) > 0,
  )?.date;
  return { cuotaAmount, moraAmount, amountDue, oldestOverdue };
}

function fallbackDueAmount(loan: LoanRow) {
  const installment = loan.installment ?? 0;
  if (installment > 0) return Math.min(installment, loan.balance);
  return loan.balance;
}

function accumulationLabel(cuotaAmount: number, moraAmount: number, alertCount: number) {
  if (alertCount >= 5 || moraAmount > 0) {
    if (cuotaAmount > 0 && moraAmount > 0) return "Cuota + mora";
    if (moraAmount > 0) return "Mora acumulada";
  }
  if (alertCount > 0) return collectionAlertLabel(alertCount);
  return "Cuota";
}

/** Monto acumulado hasta la fecha. Mora solo con 5 alertas; antes es atraso con alerta. */
export function accumulatedDueForLoan(loan: LoanRow, selectedDate: string) {
  const alertCount = loanCollectionAlerts(loan);
  const inMora = isLoanInCollectionMora(loan);

  if ((loan.schedule?.length ?? 0) > 0) {
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
  if (fallback <= 0) {
    return {
      cuotaAmount: 0,
      moraAmount: 0,
      amountDue: 0,
      oldestOverdue: undefined as string | undefined,
      alertCount,
    };
  }
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

/** Cobros del día: un registro por préstamo (cuota / alerta 1-4 / mora al 5). */
export function buildDailyCollectionList(
  loans: LoanRow[],
  clients: ClientRow[],
  selectedDate: string,
): DailyCollectionItem[] {
  const items: DailyCollectionItem[] = [];

  for (const loan of activeLoans(loans)) {
    if (loan.balance <= 0) continue;
    const client = clients.find((row) => row.ref === loan.clientRef);
    if (client && isPendingReview(client)) continue;
    const { cuotaAmount, moraAmount, amountDue, oldestOverdue, alertCount } =
      accumulatedDueForLoan(loan, selectedDate);
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
