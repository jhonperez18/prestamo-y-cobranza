/**
 * Enlace celular → autoprestamos.org (puerta a Supabase).
 * No es intensidad de antena del chip.
 */
export type EnlaceEstadoCodigo = "ok" | "subiendo" | "sin_enlace";

export type EnlaceOficinaSnapshot = {
  estado: EnlaceEstadoCodigo;
  /** Texto de la franja del cobrador. */
  label: string;
  /** Filas en Outbox pendientes de subir. */
  pending: number;
  /** Última vez que el servidor contestó (ms epoch) o null. */
  lastReachAt: number | null;
  /** true/false si ya hubo prueba; null = aún no comprobado. */
  lastReachOk: boolean | null;
  online: boolean;
};

export type EnlaceDetectInput = {
  online: boolean;
  pending: number;
  lastReachOk: boolean | null;
};
