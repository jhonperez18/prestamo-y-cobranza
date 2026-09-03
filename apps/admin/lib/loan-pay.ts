import type { LoanRow, StatusKind } from "@/lib/mock-data";
import { todayIso } from "@/lib/daily-dispatch";
import { chargeLabel, isoToDisplay, syncLoan, type ChargeKind } from "@/lib/loan-preview";

export type PayKind = "cuota" | "abono";

export type ScheduleEntry = {
  date: string;
  amount: number;
  kind?: ChargeKind;
  paid?: number;
};

export type CuotaTarget = {
  index: number;
  remaining: number;
  date?: string;
  kind?: ChargeKind;
};

export function linePaid(line: ScheduleEntry) {
  return line.paid ?? 0;
}

export function lineRemaining(line: ScheduleEntry) {
  return Math.max(0, line.amount - linePaid(line));
}

export type LineStatusKind = "paid" | "partial" | "pending" | "overdue";

export function lineStatus(
  line: ScheduleEntry,
  today = todayIso(),
): { label: string; kind: LineStatusKind } {
  const paid = linePaid(line);
  if (paid >= line.amount) return { label: "Pagada", kind: "paid" };

  const overdue = line.date < today;
  if (paid > 0) {
    return overdue
      ? { label: "Mora parcial", kind: "partial" }
      : { label: "Pendiente parcial", kind: "partial" };
  }

  return overdue ? { label: "Mora", kind: "overdue" } : { label: "Pendiente", kind: "pending" };
}

export function nextOpenCuota(schedule?: ScheduleEntry[]): CuotaTarget | null {
  if (!schedule?.length) return null;
  const index = schedule.findIndex((line) => lineRemaining(line) > 0);
  if (index < 0) return null;
  const line = schedule[index];
  return { index, remaining: lineRemaining(line), date: line.date, kind: line.kind };
}

export function cuotaTarget(loan: LoanRow): CuotaTarget | null {
  const open = nextOpenCuota(loan.schedule);
  if (open) {
    return { ...open, remaining: Math.min(open.remaining, loan.balance) };
  }
  const fallback = Math.min(loan.installment ?? 0, loan.balance);
  if (fallback > 0) return { index: -1, remaining: fallback };
  return null;
}

export function targetLabel(target: CuotaTarget | null) {
  if (!target) return "No hay cuota pendiente.";
  const concept = chargeLabel(target.kind);
  const date = target.date ? isoToDisplay(target.date) : null;
  if (date && concept !== "—") return `${date} · ${concept}`;
  if (date) return date;
  return "Cuota pendiente";
}

export function validatePay(loan: LoanRow, kind: PayKind, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return "Indique un valor.";
  if (loan.balance <= 0) return "Este préstamo ya no tiene saldo pendiente.";
  if (amount > loan.balance) return "El valor no puede ser mayor a lo pendiente del préstamo.";
  const target = cuotaTarget(loan);
  if (kind === "cuota") {
    if (!target) return "Este préstamo no tiene una cuota pendiente.";
    return null;
  }
  if (!target) {
    return null;
  }
  if (amount > target.remaining) {
    return "Un abono no puede ser mayor a lo pendiente de la cuota.";
  }
  return null;
}

export function payHint(loan: LoanRow, kind: PayKind, amount: number) {
  if (amount <= 0) {
    return kind === "cuota"
      ? "Registre el valor de la cuota, menos o más (hasta el saldo del préstamo)."
      : "Indique un valor menor o igual a la cuota.";
  }
  const error = validatePay(loan, kind, amount);
  if (error) return error;
  const target = cuotaTarget(loan);
  if (!target) return "Se descuenta del saldo del préstamo.";
  if (amount === loan.balance) return "Se cancela el total del préstamo a la fecha.";
  if (amount < target.remaining) return "Queda pendiente parcial en esta cuota.";
  if (amount === target.remaining) return "Se registra la cuota completa.";
  if (kind === "abono") return "Un abono no puede ser mayor a lo pendiente de la cuota.";
  return "Se cubre esta cuota y el resto pasa a las siguientes.";
}

function applyToSchedule(schedule: ScheduleEntry[], amount: number) {
  let left = amount;
  for (const line of schedule) {
    if (left <= 0) break;
    const room = lineRemaining(line);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    line.paid = linePaid(line) + take;
    left -= take;
  }
  return left;
}

export type ApplyPaySuccess = {
  ok: true;
  type: "Cuota" | "Abono";
  paid: number;
  balance: number;
  schedule: ScheduleEntry[] | undefined;
  partial: boolean;
  message: string;
  status: string;
  kind: LoanRow["kind"];
};

export type ApplyPayResult = ApplyPaySuccess | { ok: false; error: string };

export function paymentRowKind(result: Pick<ApplyPaySuccess, "partial">): StatusKind {
  return result.partial ? "partial" : "paid";
}

export function applyPay(loan: LoanRow, kind: PayKind, amount: number): ApplyPayResult {
  const error = validatePay(loan, kind, amount);
  if (error) return { ok: false, error };
  const target = cuotaTarget(loan);
  const schedule = loan.schedule?.map((line) => ({ ...line }));
  const type: "Cuota" | "Abono" = kind === "cuota" ? "Cuota" : "Abono";
  const partial = Boolean(target && amount < target.remaining);
  if (schedule && target && target.index >= 0) {
    if (kind === "cuota") {
      applyToSchedule(schedule, amount);
    } else {
      const line = schedule[target.index];
      line.paid = linePaid(line) + amount;
    }
  }
  const paid = loan.paid + amount;
  const balance = Math.max(0, loan.balance - amount);
  const settled = balance === 0;
  return {
    ok: true,
    type,
    paid,
    balance,
    schedule,
    partial,
    message: partial ? "Pago parcial registrado." : "Pago registrado.",
    status: settled ? "Finalizado" : loan.status,
    kind: settled ? ("paid" as const) : paid > 0 ? ("partial" as const) : loan.kind,
  };
}

/** Actualiza el préstamo tras un pago aplicado (admin y móvil). */
export function loanRowAfterPay(
  loan: LoanRow,
  pay: ApplyPaySuccess,
  payments?: { loanRef?: string; dueDate?: string; amount: number }[],
): LoanRow {
  return syncLoan(
    {
      ...loan,
      paid: pay.paid,
      balance: pay.balance,
      status: pay.status,
      kind: pay.kind,
      schedule: pay.schedule ?? loan.schedule,
    },
    payments,
  ) as LoanRow;
}
