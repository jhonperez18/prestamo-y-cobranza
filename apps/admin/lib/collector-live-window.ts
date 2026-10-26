/**
 * App del cobrador: solo mueve el día (planilla + cobros de hoy).
 * El historial se lee a demanda; no se sube ni se baja en el ciclo vivo.
 */
import { readSession } from "@/lib/auth";
import { BIG_DEMO_STORE_CHANGED_EVENT } from "@/lib/big-demo-store";
import { businessTodayIso } from "@/lib/business-timezone";
import { syncAllLoans, syncLoan } from "@/lib/loan-preview";
import { finalizeSupersededLoans } from "@/lib/route-sync";
import {
  COLLECTOR_ROLE_REF,
  SUPERVISOR_ROLE_REF,
  type LoanRow,
  type PaymentRow,
} from "@/lib/mock-data";

export function isCollectorLiveDevice(): boolean {
  if (typeof window === "undefined") return false;
  return readSession()?.roleRef === COLLECTOR_ROLE_REF;
}

/** App supervisor: tiene que bajar el sistema entero; no reenviar la planilla. */
export function isSupervisorLiveDevice(): boolean {
  if (typeof window === "undefined") return false;
  return readSession()?.roleRef === SUPERVISOR_ROLE_REF;
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
 * Saldo del cobrador = la ficha que bajó la base.
 * El celular no suma ni resta cobros de su copia.
 */
export function syncCollectorLiveLoan(
  loan: LoanRow,
  _dayPayments?: PaymentRow[],
  _today?: string,
): LoanRow {
  return syncLoan(loan) as LoanRow;
}

/**
 * El cobrador y el supervisor no rehacen el saldo con su lista de cobros.
 * El panel tampoco: `syncDeviceLoans` usa la ficha en todos.
 */
export function deviceTrustsLoanFicha(): boolean {
  return isCollectorLiveDevice() || isSupervisorLiveDevice();
}

/**
 * Fichas del aparato tras hidratar / proyectar. Pagado, saldo y estado los
 * calcula la base. Nadie los rehace con la lista de cobros del aparato.
 */
export function syncDeviceLoans(loans: LoanRow[], _payments: PaymentRow[]): LoanRow[] {
  return finalizeSupersededLoans(syncAllLoans(loans));
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
