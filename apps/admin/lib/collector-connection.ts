/**
 * Conexión del cobrador (punto de INICIO del supervisor). Solo lectura: sale de los reportes
 * de aparatos (`/api/ops/devices`); no toca dinero, planilla ni la regla de inicio.
 */
import type { CollectorRow } from "@/lib/mock-data";
import type { DeviceStatus } from "@/lib/device-status";

export type ConnectionLevel = "ok" | "warn" | "alert" | "none";

export type CollectorConnection = {
  level: ConnectionLevel;
  /** Aparatos del cobrador (sin el taller), el más reciente primero. */
  devices: DeviceStatus[];
  latest: DeviceStatus | null;
  pendingTotal: number;
  /** Aparato que apareció en las últimas 24 h teniendo el cobrador otro anterior. */
  newDevice: DeviceStatus | null;
  reasons: string[];
};

export const CONNECTION_STALE_MS = 30 * 60 * 1000;
export const NEW_DEVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

function ms(iso: string) {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

/** Este PC de taller (localhost / red local) o el navegador de Cursor: no es un aparato de cobro. */
export function isWorkshopDevice(device: DeviceStatus) {
  const host = device.host.toLowerCase();
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    /electron\//i.test(device.userAgent)
  );
}

function normName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Aparatos de un cobrador: por su usuario (`USR-`) y, sin usuario atado, por el nombre. */
export function devicesForCollector(
  collectorRef: string,
  collectorName: string,
  collectors: CollectorRow[],
  devices: DeviceStatus[],
) {
  const userRef = collectors.find((row) => row.ref === collectorRef)?.userRef?.trim() || "";
  const name = normName(collectorName);
  return devices.filter((device) => {
    if (isWorkshopDevice(device)) return false;
    if (userRef) return device.userRef === userRef;
    return Boolean(name) && normName(device.userName) === name;
  });
}

export function collectorConnection(own: DeviceStatus[], now: number): CollectorConnection {
  const devices = [...own].sort((a, b) => ms(b.reportedAt) - ms(a.reportedAt));
  const latest = devices[0] ?? null;
  if (!latest) {
    return { level: "none", devices, latest, pendingTotal: 0, newDevice: null, reasons: ["Sin reportes de conexión"] };
  }
  const pendingTotal = devices.reduce((sum, row) => sum + row.pendingTotal, 0);
  const firstSeen = (row: DeviceStatus) => ms(row.firstSeenAt) || ms(row.reportedAt);
  const oldest = Math.min(...devices.map(firstSeen));
  const newDevice =
    devices.find((row) => {
      const seen = firstSeen(row);
      return seen > oldest && now - seen <= NEW_DEVICE_WINDOW_MS;
    }) ?? null;
  const stale = now - ms(latest.reportedAt) > CONNECTION_STALE_MS;

  const reasons: string[] = [];
  if (pendingTotal > 0) reasons.push(`${pendingTotal} cambio(s) sin subir a la nube`);
  if (newDevice) reasons.push("Se conectó desde un aparato nuevo");
  if (!latest.lastPullOk) reasons.push("La última vez no pudo bajar la nube (sin internet)");
  if (stale) reasons.push("Más de 30 min sin conectarse");

  const level: ConnectionLevel =
    pendingTotal > 0 || newDevice ? "alert" : stale || !latest.lastPullOk ? "warn" : "ok";
  return { level, devices, latest, pendingTotal, newDevice, reasons };
}

export function connectionAgoLabel(iso: string, now: number) {
  const at = ms(iso);
  if (!at) return "—";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function deviceKindLabel(userAgent: string) {
  const kind = /android/i.test(userAgent)
    ? "Celular Android"
    : /iphone/i.test(userAgent)
      ? "iPhone"
      : /ipad/i.test(userAgent)
        ? "iPad"
        : /windows/i.test(userAgent)
          ? "PC Windows"
          : /mac os/i.test(userAgent)
            ? "Mac"
            : "Otro aparato";
  const browser = /samsungbrowser/i.test(userAgent)
    ? "Samsung Internet"
    : /edg\//i.test(userAgent)
      ? "Edge"
      : /firefox|fxios/i.test(userAgent)
        ? "Firefox"
        : /crios|chrome/i.test(userAgent)
          ? "Chrome"
          : /safari/i.test(userAgent)
            ? "Safari"
            : "";
  return browser ? `${kind} · ${browser}` : kind;
}
