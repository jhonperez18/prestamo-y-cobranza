/**
 * Puesta a punto del aparato en su primera sincronización del día (Bogotá):
 * subir lo pendiente → soltar copias que la nube rehace → soltar fotos de sesión
 * → cobrador/supervisor sueltan días fuera de la ventana viva.
 * Los cortes `nexo-pull-cursor:*` se quedan (egress): solo los suelta cleanEpoch.
 * No vuelve a bajar el archivo entero. Nunca borra colas ni CIE.
 */
import {
  clearSessionMoneyWarms,
  releaseStaleLiveDeviceRows,
} from "@/lib/client-path-clean";
import { clearCloudRouteDayDetail } from "@/lib/cloud-route-day-detail";
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

/** Libera el cupo y deja el aparato al día antes de la bajada. */
export function compactDeviceForDay() {
  try {
    compactRebuildableStorage();
  } catch (error) {
    console.error("device-tuneup-rebuildable", error);
  }
  try {
    clearSessionMoneyWarms();
  } catch (error) {
    console.error("device-tuneup-session", error);
  }
  try {
    clearCloudRouteDayDetail();
  } catch (error) {
    console.error("device-tuneup-route-day", error);
  }
  try {
    releaseStaleLiveDeviceRows();
  } catch (error) {
    console.error("device-tuneup-live-rows", error);
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
