/**
 * Reabrir la hoja de hoy en la nube (supervisor / admin). Ver `lib/sheet-reopen.ts`.
 *
 * Fase 4.4: una sola orden `reopen_day_sheet` en la base (marca + visitas).
 * Nada se borra. El resto de planillas del cobrador siguen cerradas.
 */
import { callReopenDaySheet } from "@/lib/server-reopen-day-sheet";
import type { DayCloseReopen } from "@/lib/sheet-reopen";

export type ReopenSheetRequest = {
  collectorRef: string;
  route: string;
  by: string;
  key?: string;
};

export type ReopenSheetResult =
  | { ok: true; reopens: DayCloseReopen[]; reopenedVisits: number }
  | { ok: false; error: string; status: number };

const ERROR_ES: Record<string, string> = {
  dato_invalido: "Falta cobrador o planilla.",
  ruta_invalida: "Planilla no válida.",
  sin_quien: "Falta quién reabre.",
  despues_corte: "Después de las 23:30 la jornada la sella el corte automático.",
  sin_cie: "Hoy no hay cierre de jornada de ese cobrador.",
  m_no_cerrada: "La hoja M de hoy no está cerrada.",
  saldo_ajustado: "El saldo de hoy ya se ajustó a la caja contada: no se reabre.",
  ya_reabierta: "La hoja ya está reabierta.",
  sin_servicio: "Nube sin configurar.",
};

function humanError(code: string): string {
  return ERROR_ES[code] || code;
}

function statusFor(code: string): number {
  if (code === "sin_servicio") return 503;
  if (
    code === "despues_corte" ||
    code === "sin_cie" ||
    code === "m_no_cerrada" ||
    code === "saldo_ajustado" ||
    code === "ya_reabierta" ||
    code === "ruta_invalida"
  ) {
    return 409;
  }
  if (code === "dato_invalido" || code === "sin_quien") return 400;
  return 500;
}

export async function reopenSheetInCloud(
  input: ReopenSheetRequest,
): Promise<ReopenSheetResult> {
  const collectorRef = String(input.collectorRef || "").trim();
  const route = String(input.route || "").trim().toUpperCase();
  const by = String(input.by || "").trim() || "supervisor";
  if (!collectorRef || !route) {
    return { ok: false, error: humanError("dato_invalido"), status: 400 };
  }

  const result = await callReopenDaySheet({
    collectorRef,
    route,
    by,
    key: input.key,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: humanError(result.error),
      status: statusFor(result.error),
    };
  }

  // Idempotente sin payload de reopens: el aparato ya aplicó o no hay nada que soltar.
  if (result.idempotent && !result.reopens.length) {
    return { ok: true, reopens: [], reopenedVisits: 0 };
  }

  return {
    ok: true,
    reopens: result.reopens,
    reopenedVisits: result.reopenedVisits,
  };
}
