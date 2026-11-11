import type { EnlaceDetectInput, EnlaceEstadoCodigo } from "./types";

/**
 * Regla pura (sin DOM): una sola decisión.
 *
 * 1. Sin internet del teléfono → sin_enlace
 * 2. Servidor no contestó (último reach = false) → sin_enlace
 * 3. Hay cola → subiendo
 * 4. Resto → ok (incluye “aún no comprobado” con online: no asusta al cobrador)
 */
export function resolveEnlaceEstado(input: EnlaceDetectInput): EnlaceEstadoCodigo {
  const pending = Math.max(0, Math.trunc(Number(input.pending) || 0));
  if (!input.online) return "sin_enlace";
  if (input.lastReachOk === false) return "sin_enlace";
  if (pending > 0) return "subiendo";
  return "ok";
}

export function enlaceEstadoLabel(estado: EnlaceEstadoCodigo, pending: number): string {
  const n = Math.max(0, Math.trunc(Number(pending) || 0));
  if (estado === "sin_enlace") return "Sin enlace · cobros quedan en el celular";
  if (estado === "subiendo") {
    return n === 1 ? "Enlace · subiendo 1…" : `Enlace · subiendo ${n}…`;
  }
  return "Enlace · al día";
}
