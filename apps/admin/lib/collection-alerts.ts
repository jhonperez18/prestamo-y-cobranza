/**
 * Alertas de cobro = días hábiles SEGUIDOS sin dar dinero.
 *
 * Regla (única en todo el sistema):
 * - Primer día de pago = día hábil siguiente al desembolso.
 * - Si no paga ese día → al siguiente Alerta 1; luego 2; luego 3.
 * - Al 4.º día hábil sin pago reflejado → Mora (COLLECTION_ALERTS_BEFORE_MORA = 4).
 * - Hoy no cuenta todavía: la alerta del no-pago se ve al amanecer del día siguiente.
 * - Sin ningún pago: se cuenta desde el desembolso (mismo criterio que desde el último abono).
 * - Domingo/festivo no suman.
 * - Cualquier pago reinicia a 0 (aunque el cronograma siga atrasado).
 * - Misma cifra en admin, cobrador, supervisor, planilla, cartera y panel Alertas.
 */
import {
  addCalendarDaysIso,
  countCollectionDaysAfter,
  isDailyCollectionDay,
} from "@/lib/colombia-holidays";
import { todayIso } from "@/lib/daily-dispatch";
import type { LoanRow, StatusKind } from "@/lib/mock-data";

/** 4.º día hábil sin pago → mora. Alertas visibles: 1, 2 y 3. */
export const COLLECTION_ALERTS_BEFORE_MORA = 4;

export type CollectionPaymentTouch = {
  loanRef?: string;
  paidDate?: string;
  amount?: number;
};

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
  payments: CollectionPaymentTouch[] | undefined,
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
  payments: CollectionPaymentTouch[] | undefined,
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
 * Días hábiles de cobro sin pago desde el último abono (o el desembolso) hasta ayer.
 * Ej.: pagó ayer → hoy 0; no pagó ayer → hoy Alerta 1.
 * Ej.: nunca pagó, desembolsó el sábado 5 → lun/mar/mié = 3 → Alerta 3 (jueves).
 * Domingo/festivo no suman. Hoy todavía no cuenta.
 */
export function collectionAlertsFromPayments(
  loanRef: string | undefined,
  payments: CollectionPaymentTouch[] | undefined,
  today = todayIso(),
  fallbackAlerts = 0,
  /** Fecha de desembolso (ISO o dd/mm/aaaa). Obligatoria para quien nunca ha pagado. */
  disbursementDate?: string,
) {
  if (loanPaidOnDate(loanRef, payments, today)) return 0;

  const throughDay = addCalendarDaysIso(today, -1);
  const lastPay = lastPaymentDateIso(loanRef, payments);
  const since =
    lastPay ||
    paymentDateIso(disbursementDate || "") ||
    (/^\d{4}-\d{2}-\d{2}$/.test((disbursementDate || "").trim())
      ? (disbursementDate || "").trim()
      : "");

  if (since) {
    if (since >= today) return 0;
    if (since > throughDay) return 0;
    return Math.min(
      COLLECTION_ALERTS_BEFORE_MORA,
      countCollectionDaysAfter(since, throughDay),
    );
  }

  // Sin pagos ni fecha de desembolso: último recurso = contador guardado.
  return Math.max(0, Math.min(COLLECTION_ALERTS_BEFORE_MORA, fallbackAlerts));
}

/**
 * Contador vivo para un préstamo (misma cifra en todos los módulos).
 * Preferir esto a leer `loan.collectionAlerts` crudo.
 */
export function liveLoanCollectionAlerts(
  loan: Pick<LoanRow, "ref" | "collectionAlerts"> & { date?: string } | null | undefined,
  payments?: CollectionPaymentTouch[],
  today = todayIso(),
) {
  if (!loan?.ref) return 0;
  return collectionAlertsFromPayments(
    loan.ref,
    payments,
    today,
    loanCollectionAlerts(loan),
    loan.date,
  );
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
 * Fuente de verdad: días hábiles sin cobro desde el último pago / desembolso.
 * Si `payments` es `undefined`, no recalcula desde fechas (solo alinea status al contador guardado).
 */
export function reconcileLoanCollectionAlerts<T extends LoanRow>(
  loan: T,
  today = todayIso(),
  payments?: CollectionPaymentTouch[],
): T {
  const alerts =
    payments === undefined
      ? loanCollectionAlerts(loan)
      : liveLoanCollectionAlerts(loan, payments, today);

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
 * Al cerrar el día de cobro: recalcula alertas con pagos reales (no +1 ciego).
 * El no-pago de `date` queda reflejado como estado al amanecer del día siguiente.
 * Si `date` no es día de cobro (domingo/festivo), no cambia nada.
 */
export function bumpMissedCollectionAlerts(
  loans: LoanRow[],
  loanRefs: string[],
  date?: string,
  payments?: CollectionPaymentTouch[],
) {
  if (date && !isDailyCollectionDay(date)) {
    return { loans, alerted: 0, toMora: 0 };
  }

  const asOf = date ? addCalendarDaysIso(date, 1) : todayIso();
  const targets = new Set(loanRefs.filter(Boolean));
  let alerted = 0;
  let toMora = 0;

  const next = loans.map((loan) => {
    const prev = loanCollectionAlerts(loan);
    const reconciled = reconcileLoanCollectionAlerts(loan, asOf, payments);
    const count = loanCollectionAlerts(reconciled);

    if (targets.size === 0 || targets.has(loan.ref)) {
      if (count > prev && count > 0) alerted += 1;
      if (prev < COLLECTION_ALERTS_BEFORE_MORA && count >= COLLECTION_ALERTS_BEFORE_MORA) {
        toMora += 1;
      }
    }

    return reconciled;
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
