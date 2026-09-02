export type KpiTone = "teal" | "amber" | "coral" | "sage";

export const KPI_TONES: KpiTone[] = ["teal", "sage", "amber", "coral"];

export function kpiToneAt(index: number): KpiTone {
  return KPI_TONES[index % KPI_TONES.length]!;
}
