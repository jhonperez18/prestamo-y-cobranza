/**
 * Alertas de cobro: 1–4 sin pago; al 5.º día sin dar dinero → mora.
 */
import type { LoanRow, StatusKind } from "@/lib/mock-data";

export const COLLECTION_ALERTS_BEFORE_MORA = 5;

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

/** Suma 1 alerta a cada préstamo no cobrado al cerrar el día. */
export function bumpMissedCollectionAlerts(loans: LoanRow[], loanRefs: string[]) {
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

    return {
      ...loan,
      collectionAlerts: count,
      ...(hitMora
        ? { status: "Mora", kind: "overdue" as StatusKind }
        : {}),
    };
  });

  return { loans: next, alerted, toMora };
}

/** Cualquier abono reinicia las alertas. */
export function clearCollectionAlertsOnPay(loan: LoanRow): LoanRow {
  if (!loan.collectionAlerts) return loan;
  const wasMora = loan.status === "Mora" || loan.kind === "overdue";
  return {
    ...loan,
    collectionAlerts: 0,
    ...(wasMora ? { status: "Activo", kind: "ok" as StatusKind } : {}),
  };
}

export function formatCloseDayAlertSummary(alerted: number, toMora: number) {
  if (!alerted && !toMora) return null;
  const parts = [
    alerted > 0 ? `${alerted} alerta${alerted === 1 ? "" : "s"}` : null,
    toMora > 0 ? `${toMora} a mora (5 sin pago)` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
