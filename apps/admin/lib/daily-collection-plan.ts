import { isoToDisplay } from "@/lib/loan-preview";
import { lineRemaining, type ScheduleEntry } from "@/lib/loan-pay";
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
  kind: "cuota" | "mora";
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
  kind: "cuota" | "mora";
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

function accumulationLabel(cuotaAmount: number, moraAmount: number) {
  if (cuotaAmount > 0 && moraAmount > 0) return "Cuota + mora acumulada";
  if (moraAmount > 0) return "Mora acumulada";
  return "Cuota";
}

/** Monto acumulado hasta la fecha: cuota del día + mora de días anteriores sin pagar. */
export function accumulatedDueForLoan(loan: LoanRow, selectedDate: string) {
  if ((loan.schedule?.length ?? 0) > 0) {
    return dueFromSchedule(loan, selectedDate);
  }

  const fallback = fallbackDueAmount(loan);
  if (fallback <= 0) return { cuotaAmount: 0, moraAmount: 0, amountDue: 0, oldestOverdue: undefined };

  const isMora = loan.kind === "overdue" || loan.status === "Mora";
  return {
    cuotaAmount: isMora ? 0 : fallback,
    moraAmount: isMora ? fallback : 0,
    amountDue: fallback,
    oldestOverdue: isMora ? selectedDate : undefined,
  };
}

/** Cobros del día: un registro por préstamo con cuota + mora acumulada. */
export function buildDailyCollectionList(
  loans: LoanRow[],
  clients: ClientRow[],
  selectedDate: string,
): DailyCollectionItem[] {
  const items: DailyCollectionItem[] = [];

  for (const loan of activeLoans(loans)) {
    if (loan.balance <= 0) continue;
    const { cuotaAmount, moraAmount, amountDue, oldestOverdue } = accumulatedDueForLoan(
      loan,
      selectedDate,
    );
    if (amountDue <= 0) continue;

    const client = clients.find((row) => row.ref === loan.clientRef);
    const hasMora = moraAmount > 0;
    items.push({
      loanRef: loan.ref,
      clientRef: loan.clientRef,
      clientName: clientName(client, loan.client),
      clientRoute: client?.route ?? "—",
      address: client?.address,
      phone: client?.phone,
      id: `${selectedDate}:${loan.ref}:acum`,
      chargeDate: oldestOverdue ?? selectedDate,
      chargeLabel: accumulationLabel(cuotaAmount, moraAmount),
      amountDue,
      cuotaAmount,
      moraAmount,
      kind: hasMora ? "mora" : "cuota",
      statusKind: hasMora ? "overdue" : cuotaAmount > 0 && loan.kind === "partial" ? "partial" : "pending",
    });
  }

  return items.sort(
    (a, b) =>
      b.moraAmount - a.moraAmount ||
      a.clientName.localeCompare(b.clientName) ||
      a.loanRef.localeCompare(b.loanRef),
  );
}

export function dailyCollectionSummary(items: DailyCollectionItem[]) {
  const cuotas = items.filter((row) => row.kind === "cuota");
  const mora = items.filter((row) => row.kind === "mora");
  return {
    total: items.length,
    cuotas: cuotas.length,
    mora: mora.length,
    totalDue: items.reduce((sum, row) => sum + row.amountDue, 0),
    cuotaDue: items.reduce((sum, row) => sum + row.cuotaAmount, 0),
    moraDue: items.reduce((sum, row) => sum + row.moraAmount, 0),
  };
}

export function formatChargeDate(iso: string) {
  return isoToDisplay(iso);
}
