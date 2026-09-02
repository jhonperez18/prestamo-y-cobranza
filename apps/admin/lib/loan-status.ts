import { todayIso } from "@/lib/daily-dispatch";
import type { StatusKind } from "@/lib/mock-data";

type ScheduleLine = { date: string; amount: number; paid?: number };

function remaining(line: ScheduleLine) {
  return Math.max(0, line.amount - (line.paid ?? 0));
}

/** Estado visual del préstamo: Mora (rojo), Activo (verde), Finalizado (gris). */
export function loanStatusPill(loan: {
  status?: string;
  balance?: number;
  schedule?: ScheduleLine[];
}): { label: string; kind: StatusKind } {
  const balance = loan.balance ?? 0;
  if (loan.status === "Finalizado" || balance <= 0) {
    return { label: "Finalizado", kind: "paid" };
  }

  const today = todayIso();
  const hasOverdue = (loan.schedule ?? []).some(
    (line) => line.date < today && remaining(line) > 0,
  );
  if (hasOverdue) {
    return { label: "Mora", kind: "overdue" };
  }

  return { label: "Activo", kind: "ok" };
}
