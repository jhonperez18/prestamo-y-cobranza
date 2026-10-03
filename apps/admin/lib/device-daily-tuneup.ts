/**
 * Puesta a punto del aparato en su primera sincronización del día (Bogotá):
 * subir lo pendiente → soltar copias que la nube rehace → bajar todo completo → rehidratar.
 * Así ningún celular arranca la jornada con el cupo lleno ni con caché del día anterior.
 * Nunca borra cobros, clientes, préstamos, cierres ni colas de subida.
 */
import { businessTodayIso } from "@/lib/business-timezone";
import { compactRebuildableStorage } from "@/lib/demo-persist";

const TUNEUP_DAY_KEY = "nexo-device-tuneup-day";

function readTuneupDay(): string {
  try {
    return window.localStorage.getItem(TUNEUP_DAY_KEY) || "";
  } catch {
    return "";
  }
}

/** Día de negocio pendiente de puesta a punto ("" = ya se hizo hoy). */
export function deviceTuneupDueDay(now = new Date()): string {
  if (typeof window === "undefined") return "";
  const today = businessTodayIso(now);
  return readTuneupDay() === today ? "" : today;
}

/** Libera el cupo antes de la bajada completa del día. */
export function compactDeviceForDay() {
  try {
    compactRebuildableStorage();
  } catch (error) {
    console.error("device-tuneup", error);
  }
}

/** Solo tras una bajada completa OK: si falló, se reintenta en el siguiente ciclo. */
export function markDeviceTuneupDone(day: string) {
  try {
    window.localStorage.setItem(TUNEUP_DAY_KEY, day);
  } catch (error) {
    console.error("device-tuneup", error);
  }
}
