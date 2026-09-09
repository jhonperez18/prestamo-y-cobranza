/**
 * Alertas de cobro = días hábiles SEGUIDOS sin dar dinero (retacar).
 * - Se cuentan desde el día siguiente al último pago hasta ayer (lun–sáb, sin festivos).
 * - Hoy no cuenta: si pagó ayer hoy está normal; si hoy no paga, mañana = Alerta 1.
 * - Alerta 1–3; al 4.º día hábil sin pago → Mora.
 * - Cualquier pago reinicia el contador (aunque el cronograma siga atrasado en papel).
 * El atraso del plan de cuotas es aparte: el cliente puede ponerse al día pagando de más.
 */
import {
  addCalendarDaysIso,
  countCollectionDaysAfter,
  isDailyCollectionDay,
} from "@/lib/colombia-holidays";
import { todayIso } from "@/lib/daily-dispatch";
import type { LoanRow, StatusKind } from "@/lib/mock-data";

/** Al llegar a este contador (4.º día hábil sin pago) el préstamo entra en mora. */
export const COLLECTION_ALERTS_BEFORE_MORA = 4;

export function loanCollectionAlerts(loan: Pick<LoanRow, "collectionAlerts">) {
  const n = Number(loan.collectionAlerts) || 0;
  return Math.max(0, Math.min(COLLECTION_ALERTS_BEFORE_MORA, n));
}

export function isLoanInCollectionMora(loan: Pick<LoanRow, "collectionAlerts">) {
  return loanCollectionAlerts(loan) >= COLLECTION_ALERTS_BEFORE_MORA;
}

export function collectionAlertLabel(alerts: number) {
  if (alerts >= COLLECTION_ALERTS_BEFORE_MORA) return "Mora";
  if (alerts > 0) return `Alerta ${alerts}`;
  return "";
}

export function collectionChargeKind(
  alerts: number,
): "cuota" | "alerta" | "mora" {
  if (alerts >= COLLECTION_ALERTS_BEFORE_MORA) return "mora";
  if (alerts > 0) return "alerta";
  return "cuota";
}

type PaymentTouch = {
  loanRef?: string;
  paidDate?: string;
  amount?: number;
};

function paymentDateIso(raw: string) {
  const trimmed = (raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** ¿Hubo cobro/abono de este préstamo en la fecha? (borra alerta). */
export function loanPaidOnDate(
  loanRef: string | undefined,
  payments: PaymentTouch[] | undefined,
  date = todayIso(),
) {
  if (!loanRef || !payments?.length) return false;
  return payments.some(
    (row) =>
      row.loanRef === loanRef &&
      paymentDateIso(row.paidDate || "") === date &&
      (Number(row.amount) || 0) > 0,
  );
}

/** Última fecha ISO con pago > 0 de este préstamo. */
export function lastPaymentDateIso(
  loanRef: string | undefined,
  payments: PaymentTouch[] | undefined,
) {
  if (!loanRef || !payments?.length) return "";
  let latest = "";
  for (const row of payments) {
    if (row.loanRef !== loanRef) continue;
    if ((Number(row.amount) || 0) <= 0) continue;
    const day = paymentDateIso(row.paidDate || "");
    if (!day) continue;
    if (day > latest) latest = day;
  }
  return latest;
}

/**
 * Días hábiles de cobro sin pago desde el último abono hasta ayer.
 * Ej.: pagó ayer → hoy 0; no pagó ayer → hoy Alerta 1.
 * Ej.: pagó sábado, hoy martes sin pagar lun/lun → Alerta 2.
 */
export function collectionAlertsFromPayments(
  loanRef: string | undefined,
  payments: PaymentTouch[] | undefined,
  today = todayIso(),
  fallbackAlerts = 0,
) {
  if (loanPaidOnDate(loanRef, payments, today)) return 0;

  const lastPay = lastPaymentDateIso(loanRef, payments);
  if (lastPay) {
    if (lastPay >= today) return 0;
    const throughDay = addCalendarDaysIso(today, -1);
    if (lastPay > throughDay) return 0;
    return Math.min(
      COLLECTION_ALERTS_BEFORE_MORA,
      countCollectionDaysAfter(lastPay, throughDay),
    );
  }

  // Sin historial de pagos: respeta contador guardado (cierres de día).
  return Math.max(0, Math.min(COLLECTION_ALERTS_BEFORE_MORA, fallbackAlerts));
}

function statusFromAlerts(
  alerts: number,
  finalized: boolean,
): { status: string; kind: StatusKind } {
  if (finalized) return { status: "Finalizado", kind: "paid" };
  if (alerts >= COLLECTION_ALERTS_BEFORE_MORA) {
    return { status: "Mora", kind: "overdue" };
  }
  if (alerts > 0) {
    return { status: collectionAlertLabel(alerts), kind: "warn" };
  }
  return { status: "Activo", kind: "ok" };
}

/**
 * Sincroniza alertas con pagos reales + status del préstamo.
 * Fuente de verdad: días hábiles sin cobro desde el último pago.
 */
export function reconcileLoanCollectionAlerts<T extends LoanRow>(
  loan: T,
  today = todayIso(),
  payments?: PaymentTouch[],
): T {
  const alerts = collectionAlertsFromPayments(
    loan.ref,
    payments,
    today,
    loanCollectionAlerts(loan),
  );

  const finalized = loan.status === "Finalizado" || (loan.balance ?? 0) <= 0;
  const { status: nextStatus, kind: nextKind } = statusFromAlerts(alerts, finalized);

  if (
    loanCollectionAlerts(loan) === alerts &&
    loan.status === nextStatus &&
    loan.kind === nextKind
  ) {
    return loan;
  }

  return {
    ...loan,
    collectionAlerts: alerts || undefined,
    status: nextStatus,
    kind: nextKind,
  };
}

/**
 * Suma 1 alerta a cada préstamo no cobrado al cerrar el día.
 * Si `date` no es día de cobro (domingo/festivo), no suma nada.
 */
export function bumpMissedCollectionAlerts(
  loans: LoanRow[],
  loanRefs: string[],
  date?: string,
) {
  if (date && !isDailyCollectionDay(date)) {
    return { loans, alerted: 0, toMora: 0 };
  }

  const targets = new Set(loanRefs.filter(Boolean));
  let alerted = 0;
  let toMora = 0;

  const next = loans.map((loan) => {
    if (!targets.has(loan.ref)) return loan;
    const prev = loanCollectionAlerts(loan);
    if (prev >= COLLECTION_ALERTS_BEFORE_MORA) return loan;

    const count = prev + 1;
    alerted += 1;
    const hitMora = count >= COLLECTION_ALERTS_BEFORE_MORA;
    if (hitMora) toMora += 1;

    const stamped = statusFromAlerts(count, false);
    return {
      ...loan,
      collectionAlerts: count,
      status: stamped.status,
      kind: stamped.kind,
    };
  });

  return { loans: next, alerted, toMora };
}

/** Cualquier abono reinicia las alertas (aunque el plan siga atrasado). */
export function clearCollectionAlertsOnPay(loan: LoanRow): LoanRow {
  const hadAlert =
    loanCollectionAlerts(loan) > 0 ||
    loan.status === "Mora" ||
    loan.kind === "overdue" ||
    Boolean(loan.status?.startsWith("Alerta"));
  if (!hadAlert && !loan.collectionAlerts) return loan;
  return {
    ...loan,
    collectionAlerts: 0,
    status: loan.status === "Finalizado" ? "Finalizado" : "Activo",
    kind: loan.status === "Finalizado" || (loan.balance ?? 0) <= 0 ? "paid" : "ok",
  };
}

export function formatCloseDayAlertSummary(alerted: number, toMora: number) {
  if (!alerted && !toMora) return null;
  const parts = [
    alerted > 0 ? `${alerted} alerta${alerted === 1 ? "" : "s"}` : null,
    toMora > 0 ? `${toMora} a mora (4 días hábiles sin pago)` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
