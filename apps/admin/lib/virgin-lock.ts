/**
 * Candado virgen: evita que celulares/PC con datos viejos vuelvan a llenar la nube
 * y fuerza wipe local cuando sube la generación.
 *
 * - Subí VIRGIN_WIPE_GEN para obligar a TODOS los navegadores a vaciarse otra vez.
 * - Mientras Date.now() < VIRGIN_WRITE_LOCK_UNTIL_MS, los mirrors rechazan escrituras de plata.
 * - Cuando ya operen con datos reales: subí VIRGIN_WRITE_LOCK_UNTIL_MS al pasado (o gen fija)
 *   y no vuelvas a subir VIRGIN_WIPE_GEN salvo wipe intencional.
 */
export const VIRGIN_WIPE_GEN = 20;

/** Clave local: última generación de wipe aplicada en este origen. */
export const DEMO_VIRGIN_WIPE_GEN_KEY = "nexo-demo-virgin-wipe-gen";

/**
 * Candado de escritura en servidor (UTC).
 * Hasta ~18-sep-2026 00:00 Colombia: celulares viejos no pueden rellenar la nube.
 * Después de esa hora ya se pueden guardar cobros/gastos reales.
 */
export const VIRGIN_WRITE_LOCK_UNTIL_MS = Date.UTC(2026, 8, 18, 5, 0, 0);

export function isVirginWriteLocked(now = Date.now()) {
  return now < VIRGIN_WRITE_LOCK_UNTIL_MS;
}

export function virginWriteLockPayload() {
  return {
    ok: true as const,
    skipped: true as const,
    reason: "virgin_write_lock" as const,
    until: new Date(VIRGIN_WRITE_LOCK_UNTIL_MS).toISOString(),
  };
}
