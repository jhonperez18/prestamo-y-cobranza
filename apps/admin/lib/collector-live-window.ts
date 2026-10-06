/**
 * App del cobrador: solo mueve el día (planilla + cobros de hoy).
 * El historial se lee a demanda; no se sube ni se baja en el ciclo vivo.
 */
import { readSession } from "@/lib/auth";
import { BIG_DEMO_STORE_CHANGED_EVENT } from "@/lib/big-demo-store";
import { businessTodayIso } from "@/lib/business-timezone";
import { pesos } from "@/lib/finance";
import { paymentVisitDate } from "@/lib/late-payment";
import { isPaymentLive } from "@/lib/live-payments";
import { syncLoan } from "@/lib/loan-preview";
import { COLLECTOR_ROLE_REF, type LoanRow, type PaymentRow } from "@/lib/mock-data";

export function isCollectorLiveDevice(): boolean {
  if (typeof window === "undefined") return false;
  return readSession()?.roleRef === COLLECTOR_ROLE_REF;
}

export function collectorLiveDayIso(now = new Date()): string {
  return businessTodayIso(now);
}

export function readIsoDateParam(request: Request, name: string): string | null {
  const raw = new URL(request.url).searchParams.get(name)?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** `fromDate` / `toDate` para bajar solo un día (vivo o historial). */
export function withDateWindowParam(
  path: string,
  fromDate: string | null,
  toDate: string | null = null,
): string {
  if (!fromDate) return path;
  const sep = path.includes("?") ? "&" : "?";
  const until = toDate && toDate !== fromDate ? `&toDate=${encodeURIComponent(toDate)}` : "";
  return `${path}${sep}fromDate=${encodeURIComponent(fromDate)}${until}`;
}

/**
 * Saldo del cobrador = ficha del préstamo (nube) + cobros de hoy que aún no están en esa ficha.
 * No suma el historial: si solo está el día, el saldo no se infla.
 */
export function syncCollectorLiveLoan(
  loan: LoanRow,
  dayPayments: PaymentRow[],
  today = collectorLiveDayIso(),
): LoanRow {
  const base = syncLoan(loan) as LoanRow;
  const catalogAt = Date.parse(String(loan.updatedAt || "")) || 0;
  let add = 0;
  for (const row of dayPayments) {
    if (row.loanRef !== loan.ref || !isPaymentLive(row)) continue;
    const day = paymentVisitDate(row) || row.paidDate || "";
    if (day !== today) continue;
    const payAt = Date.parse(String(row.updatedAt || "")) || 0;
    if (catalogAt && payAt && payAt <= catalogAt) continue;
    add += pesos(row.amount);
  }
  if (add <= 0) return base;
  return {
    ...base,
    paid: pesos(base.paid) + add,
    balance: Math.max(0, pesos(base.balance) - add),
  };
}

/** Al abrir un día del historial: baja solo ese día y lo deja para leer. */
export async function pullCollectorHistoryDay(date: string): Promise<{ ok: boolean; changed: boolean }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, changed: false };
  try {
    const [{ mergePaymentsWindowIntoDemo }, { mergeOpsWindowIntoDemo }] = await Promise.all([
      import("@/lib/supabase/payment-mirror"),
      import("@/lib/supabase/ops-mirror"),
    ]);
    const [payments, ops] = await Promise.all([
      mergePaymentsWindowIntoDemo(date, date),
      mergeOpsWindowIntoDemo(date, date),
    ]);
    const changed = Boolean(ops.changed || payments.length);
    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(BIG_DEMO_STORE_CHANGED_EVENT));
    }
    return { ok: ops.ok, changed };
  } catch (error) {
    console.error("collector-history-day", error);
    return { ok: false, changed: false };
  }
}
