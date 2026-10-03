/**
 * Alarma de cupo por aparato. El 03/10 el supervisor pasó la mañana sin poder guardar lo que
 * bajaba («sin espacio en el aparato») y el primero en notarlo fue el cliente. El reporte ya
 * llegaba a la nube: esto lo convierte en alarma (revisión 6:00, `verify:prod`, panel Aparatos).
 */
import type { DeviceStatus } from "@/lib/device-status";

/** localStorage ~5.120 miles de caracteres por sitio: avisar al 70 %. */
export const DEVICE_STORAGE_WARN_KB = 3_584;
/** Solo aparatos que reportaron en este lapso (los viejos ya no se usan). */
export const DEVICE_ALERT_WINDOW_MS = 36 * 60 * 60_000;

export type DeviceStorageAlert = {
  deviceId: string;
  userName: string;
  roleName: string;
  host: string;
  build: string;
  reportedAt: string;
  reason: string;
};

export function isStorageFullError(error: string) {
  return /sin espacio/i.test(error);
}

export function deviceStorageAlerts(
  devices: DeviceStatus[],
  now = Date.now(),
): DeviceStorageAlert[] {
  const alerts: DeviceStorageAlert[] = [];
  for (const row of devices) {
    const at = Date.parse(row.reportedAt);
    if (!Number.isFinite(at) || now - at > DEVICE_ALERT_WINDOW_MS) continue;
    const reasons: string[] = [];
    if (!row.lastPullOk && isStorageFullError(row.lastPullError)) {
      reasons.push(`no guarda lo que baja: ${row.lastPullError}`);
    }
    if (row.storageUsedKb >= DEVICE_STORAGE_WARN_KB) {
      reasons.push(`almacenamiento al ${Math.round((row.storageUsedKb / 5_120) * 100)} %`);
    }
    if (!reasons.length) continue;
    alerts.push({
      deviceId: row.deviceId,
      userName: row.userName,
      roleName: row.roleName,
      host: row.host,
      build: row.build,
      reportedAt: row.reportedAt,
      reason: reasons.join(" · "),
    });
  }
  return alerts;
}
