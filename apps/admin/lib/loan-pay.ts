import type { LoanRow, StatusKind } from "@/lib/mock-data";
import { todayIso } from "@/lib/daily-dispatch";
import { pendingBalance, pesos } from "@/lib/finance";
import { chargeLabel, isoToDisplay, syncLoan, type ChargeKind } from "@/lib/loan-preview";
import { clearCollectionAlertsOnPay } from "@/lib/collection-alerts";

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
  return pesos(line.paid ?? 0);
}

export function lineRemaining(line: ScheduleEntry) {
  return pendingBalance(line.amount, linePaid(line));
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
      ? { label: "Vencida parcial", kind: "partial" }
      : { label: "Pendiente parcial", kind: "partial" };
  }

  // Vencida ≠ mora del préstamo (mora = 4 días hábiles seguidos sin pago).
  return overdue ? { label: "Vencida", kind: "pending" } : { label: "Pendiente", kind: "pending" };
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
  // Tope único: saldo del préstamo. Cuota de referencia se puede pagar de menos o de más.
  if (amount > loan.balance) return "El valor no puede ser mayor a lo pendiente del préstamo.";
  if (kind === "cuota") {
    const target = cuotaTarget(loan);
    if (!target) return "Este préstamo no tiene una cuota pendiente.";
  }
  return null;
}

export function payHint(loan: LoanRow, kind: PayKind, amount: number) {
  if (amount <= 0) {
    return "Registre el valor: menos o más que la cuota (hasta el saldo del préstamo).";
  }
  const error = validatePay(loan, kind, amount);
  if (error) return error;
  const target = cuotaTarget(loan);
  if (!target) return "Se descuenta del saldo del préstamo.";
  if (amount === loan.balance) return "Se cancela el total del préstamo a la fecha.";
  if (amount < target.remaining) return "Queda pendiente parcial en esta cuota.";
  if (amount === target.remaining) return "Se registra la cuota completa.";
  return "El excedente baja el saldo. La cuota diaria sigue igual.";
}

/** Aplica el pago solo a la cuota abierta; el excedente no adelanta cuotas futuras. */
function applyToOpenCuotaOnly(schedule: ScheduleEntry[], targetIndex: number, amount: number) {
  const line = schedule[targetIndex];
  if (!line) return;
  const take = Math.min(lineRemaining(line), pesos(amount));
  if (take <= 0) return;
  line.paid = linePaid(line) + take;
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
  const amountPesos = pesos(amount);
  const target = cuotaTarget(loan);
  const schedule = loan.schedule?.map((line) => ({ ...line }));
  const type: "Cuota" | "Abono" = kind === "cuota" ? "Cuota" : "Abono";
  const partial = Boolean(target && amountPesos < target.remaining);
  if (schedule && target && target.index >= 0) {
    // Solo marca lo pendiente de la cuota abierta; el excedente solo baja saldo.
    applyToOpenCuotaOnly(schedule, target.index, amountPesos);
  }
  const paidBefore = pesos(loan.paid);
  const paid = paidBefore + amountPesos;
  const total =
    loan.total != null && loan.total > 0
      ? pesos(loan.total)
      : paidBefore + pesos(loan.balance);
  const balance = pendingBalance(total, paid);
  const settled = balance === 0;
  return {
    ok: true,
    type,
    paid,
    balance,
    schedule,
    partial,
    message: partial
      ? "Pago parcial registrado."
      : amount > (target?.remaining ?? amount)
        ? "Pago registrado. Excedente descontado del saldo."
        : "Pago registrado.",
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
  const cleared = clearCollectionAlertsOnPay({
    ...loan,
    paid: pay.paid,
    balance: pay.balance,
    status: pay.status,
    kind: pay.kind,
    schedule: pay.schedule ?? loan.schedule,
  });
  return syncLoan(cleared, payments) as LoanRow;
}
