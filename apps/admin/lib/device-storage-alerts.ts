/**
 * Alarma de cupo / build / host por aparato. El 03/10 el supervisor pasó la mañana
 * sin poder guardar lo que bajaba («sin espacio en el aparato») y el primero en
 * notarlo fue el cliente. El reporte ya llegaba a la nube: esto lo convierte en
 * alarma (revisión 6:00, `verify:prod`, panel Aparatos).
 *
 * 02/11: también avisa build atrasado y host en Vercel (contrato: solo autoprestamos.org).
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

export type DeviceAlertOptions = {
  now?: number;
  /** SHA corto de prod. Si viene, alerta aparatos vivos con otro build. */
  expectedBuild?: string;
};

export function isStorageFullError(error: string) {
  return /sin espacio/i.test(error);
}

function isLocalHost(host: string) {
  return /localhost|127\.0\.0\.1/i.test(host);
}

function isVercelHost(host: string) {
  return /vercel\.app/i.test(host);
}

/** Un renglón por persona: el reporte más reciente dentro de la ventana. */
function latestLiveDevices(devices: DeviceStatus[], now: number): DeviceStatus[] {
  const latest = new Map<string, DeviceStatus>();
  for (const row of devices) {
    const at = Date.parse(row.reportedAt);
    if (!Number.isFinite(at) || now - at > DEVICE_ALERT_WINDOW_MS) continue;
    const key = String(row.userRef || row.deviceId || "").trim() || row.deviceId;
    const prev = latest.get(key);
    if (!prev || Date.parse(prev.reportedAt) < at) latest.set(key, row);
  }
  return [...latest.values()];
}

/**
 * @param nowOrOpts timestamp (compat) u opciones con build esperado de prod.
 */
export function deviceStorageAlerts(
  devices: DeviceStatus[],
  nowOrOpts: number | DeviceAlertOptions = Date.now(),
): DeviceStorageAlert[] {
  const opts: DeviceAlertOptions =
    typeof nowOrOpts === "number" ? { now: nowOrOpts } : nowOrOpts ?? {};
  const now = opts.now ?? Date.now();
  const expectedBuild = String(opts.expectedBuild || "").trim();
  const alerts: DeviceStorageAlert[] = [];

  for (const row of latestLiveDevices(devices, now)) {
    const reasons: string[] = [];
    if (!row.lastPullOk && isStorageFullError(row.lastPullError)) {
      reasons.push(`no guarda lo que baja: ${row.lastPullError}`);
    }
    if (row.storageUsedKb >= DEVICE_STORAGE_WARN_KB) {
      reasons.push(`almacenamiento al ${Math.round((row.storageUsedKb / 5_120) * 100)} %`);
    }
    const host = String(row.host || "");
    if (isVercelHost(host)) {
      reasons.push("sigue en Vercel (debe ser autoprestamos.org)");
    }
    const build = String(row.build || "").trim();
    if (
      expectedBuild &&
      !isLocalHost(host) &&
      build &&
      build !== "dev" &&
      build !== expectedBuild
    ) {
      reasons.push(`build atrasado ${build} (prod ${expectedBuild})`);
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
