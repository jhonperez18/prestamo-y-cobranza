"use client";

import type { CuotasProgress } from "@/lib/loan-cuotas-progress";

type Props = {
  progress: Pick<CuotasProgress, "label" | "intensity" | "title" | "expected">;
  className?: string;
};

/** Celda compacta `2/15` + barrita de intensidad al lado del denominador. */
export function CuotasProgressCell({ progress, className = "" }: Props) {
  if (!progress.expected || !progress.label) {
    return (
      <span className={`cuotas-progress is-empty ${className}`.trim()} aria-hidden>
        —
      </span>
    );
  }

  const [paid, expected] = progress.label.split("/");
  const level = Math.max(0, Math.min(4, progress.intensity));

  return (
    <span
      className={`cuotas-progress is-level-${level} ${className}`.trim()}
      title={progress.title}
      aria-label={progress.title}
    >
      <span className="cuotas-progress-paid">{paid}</span>
      <span className="cuotas-progress-sep">/</span>
      <span className="cuotas-progress-expected">{expected}</span>
      <span className="cuotas-progress-bar" aria-hidden data-level={level} />
    </span>
  );
}
