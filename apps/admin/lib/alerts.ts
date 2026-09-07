import {
  collectionAlertLabel,
  isLoanInCollectionMora,
  loanCollectionAlerts,
} from "@/lib/collection-alerts";
import type { ModuleId } from "@/lib/navigation";
import type { ClientRow, LoanRow, StatusKind } from "@/lib/mock-data";
import { activeLoans } from "@/lib/mock-data";
import {
  clientsNeedingProfileCompletion,
  loansNeedingOfficeReview,
} from "@/lib/profile-pending";

export type AlertRow = {
  id: string;
  when: string;
  message: string;
  pill: string;
  kind: StatusKind;
  module: ModuleId;
  view: string;
};

export function buildAlerts(
  pendingReviewCount: number,
  loans: LoanRow[] = [],
  clients: ClientRow[] = [],
): AlertRow[] {
  const rows: AlertRow[] = [];

  if (pendingReviewCount > 0) {
    rows.push({
      id: "revision",
      when: "Hoy",
      message: `${pendingReviewCount} cliente${pendingReviewCount === 1 ? "" : "s"} pendiente${pendingReviewCount === 1 ? "" : "s"} de revisión`,
      pill: "Revisar",
      kind: "warn",
      module: "clientes",
      view: "revision",
    });
  }

  const profilePending = clientsNeedingProfileCompletion(clients).length;
  if (profilePending > 0) {
    rows.push({
      id: "ficha-incompleta",
      when: "Hoy",
      message: `${profilePending} cliente${profilePending === 1 ? "" : "s"} con ficha incompleta (alta en calle)`,
      pill: "Completar",
      kind: "warn",
      module: "clientes",
      view: "listado",
    });
  }

  const loanPending = loansNeedingOfficeReview(loans).length;
  if (loanPending > 0) {
    rows.push({
      id: "prestamo-rapido",
      when: "Hoy",
      message: `${loanPending} préstamo${loanPending === 1 ? "" : "s"} rápido${loanPending === 1 ? "" : "s"} por revisar en oficina`,
      pill: "Revisar",
      kind: "partial",
      module: "prestamos",
      view: "listado",
    });
  }

  const withAlerts = activeLoans(loans).filter(
    (loan) => loan.balance > 0 && loanCollectionAlerts(loan) > 0,
  );
  const inMora = withAlerts.filter((loan) => isLoanInCollectionMora(loan));
  const warning = withAlerts.filter((loan) => !isLoanInCollectionMora(loan));

  if (warning.length > 0) {
    const byLevel = [1, 2, 3, 4]
      .map((level) => ({
        level,
        count: warning.filter((loan) => loanCollectionAlerts(loan) === level).length,
      }))
      .filter((row) => row.count > 0);
    const detail = byLevel
      .map((row) => `${row.count} en ${collectionAlertLabel(row.level)}`)
      .join(" · ");
    rows.push({
      id: "cobro-alertas",
      when: "Hoy",
      message: `${warning.length} préstamo${warning.length === 1 ? "" : "s"} sin pago (${detail})`,
      pill: "Alerta",
      kind: "warn",
      module: "cobranza",
      view: "hoy",
    });
  }

  if (inMora.length > 0) {
    rows.push({
      id: "cobro-mora",
      when: "Hoy",
      message: `${inMora.length} préstamo${inMora.length === 1 ? "" : "s"} en mora (5 días sin pago)`,
      pill: "Mora",
      kind: "overdue",
      module: "cartera",
      view: "mora",
    });
  }

  return rows;
}
