import { businessTodayIso } from "@/lib/business-timezone";
import {
  COLLECTION_ALERTS_BEFORE_MORA,
  collectionAlertLabel,
  loanCollectionAlerts,
} from "@/lib/collection-alerts";
import { loanRenewalOf } from "@/lib/loan-renewal-marks";
import type { StatusKind } from "@/lib/mock-data";

function loanDayIso(raw?: string | null) {
  const value = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

/**
 * Estado visual del préstamo.
 * Renovado (ámbar) solo el día en que nació la renovación; al día siguiente vuelve a Activo.
 * No cambia el estado guardado.
 */
export function loanStatusPill(
  loan: {
    status?: string;
    balance?: number;
    collectionAlerts?: number;
    notes?: string | null;
    date?: string | null;
  },
  today = businessTodayIso(),
): { label: string; kind: StatusKind } {
  const balance = loan.balance ?? 0;
  if (balance <= 0) {
    return { label: "Finalizado", kind: "paid" };
  }

  if (loanRenewalOf(loan) && loanDayIso(loan.date) === today) {
    return { label: "Renovado", kind: "renovado" };
  }

  const alerts = loanCollectionAlerts(loan);
  if (alerts >= COLLECTION_ALERTS_BEFORE_MORA) {
    return { label: "Mora", kind: "overdue" };
  }
  if (alerts > 0) {
    return { label: collectionAlertLabel(alerts), kind: "warn" };
  }

  return { label: "Activo", kind: "ok" };
}
