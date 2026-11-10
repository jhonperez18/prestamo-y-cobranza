/**
 * Tipos del Salvavidas (seguros para cliente y servidor).
 * Sin I/O. La lógica vive en server-business-lifeline.ts.
 */

export type BusinessAlarmSeverity = "critical" | "warn";

export type BusinessAlarm = {
  id: string;
  severity: BusinessAlarmSeverity;
  code:
    | "cie_vs_formula"
    | "inicial_vs_cie"
    | "m_caja_vs_formula"
    | "t_caja_vs_formula"
    | "an_caja_vs_formula"
    | "audit_error";
  collectorRef: string;
  collectorName: string;
  date: string;
  title: string;
  detail: string;
  expected: number;
  actual: number;
  kind: "chain" | "independent" | "system";
};

export type BusinessLifelineReport = {
  ok: boolean;
  businessDate: string;
  checkedAt: string;
  alarms: BusinessAlarm[];
  error?: string;
};

export function formatAlarmMoneyLine(alarm: BusinessAlarm): string {
  if (alarm.code === "audit_error") return alarm.detail;
  const money = (n: number) => Math.trunc(n).toLocaleString("es-CO");
  return `Debe ${money(alarm.expected)} · Tiene ${money(alarm.actual)}`;
}
