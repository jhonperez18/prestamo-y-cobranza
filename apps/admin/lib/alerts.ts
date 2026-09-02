import type { ModuleId } from "@/lib/navigation";
import type { StatusKind } from "@/lib/mock-data";

export type AlertRow = {
  id: string;
  when: string;
  message: string;
  pill: string;
  kind: StatusKind;
  module: ModuleId;
  view: string;
};

export function buildAlerts(pendingReviewCount: number): AlertRow[] {
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

  rows.push(
    {
      id: "mora",
      when: "Hoy",
      message: "61 cuotas vencidas sin abono en 7 días",
      pill: "Mora",
      kind: "overdue",
      module: "cartera",
      view: "mora",
    },
    {
      id: "anulacion",
      when: "Ayer",
      message: "Pago PG-9102 anulado por el administrador",
      pill: "Auditoría",
      kind: "draft",
      module: "inicio",
      view: "auditoria",
    },
    {
      id: "gps",
      when: "Ayer",
      message: "Cobrador sin GPS en 3 cobros",
      pill: "Campo",
      kind: "partial",
      module: "inicio",
      view: "actividad",
    },
  );

  return rows;
}
