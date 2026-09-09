import {
  COLLECTION_ALERTS_BEFORE_MORA,
  collectionAlertLabel,
  loanCollectionAlerts,
} from "@/lib/collection-alerts";
import type { StatusKind } from "@/lib/mock-data";

/** Estado visual del préstamo según alertas de cobro (1–3) y mora (4.º día hábil). */
export function loanStatusPill(loan: {
  status?: string;
  balance?: number;
  termsPending?: boolean;
  collectionAlerts?: number;
}): { label: string; kind: StatusKind } {
  const balance = loan.balance ?? 0;
  if (loan.status === "Finalizado" || balance <= 0) {
    return { label: "Finalizado", kind: "paid" };
  }

  if (loan.termsPending) {
    return { label: "Revisar", kind: "partial" };
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
