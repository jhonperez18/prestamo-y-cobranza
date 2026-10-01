/**
 * Control por aparato: qué versión corre, cuándo bajó la nube por última vez y cuántos
 * cambios le quedan sin subir. Cada aparato lo reporta; el panel (Configuración → Aparatos) lo lee.
 */
import { APP_BUILD } from "@/lib/app-build";
import { readSession } from "@/lib/auth";

export type DeviceStatus = {
  deviceId: string;
  userRef: string;
  userName: string;
  roleName: string;
  build: string;
  host: string;
  userAgent: string;
  lastPullAt: string;
  lastPullOk: boolean;
  lastPullError: string;
  pendingTotal: number;
  reportedAt: string;
};

const DEVICE_ID_KEY = "nexo-device-id";
const REPORT_MIN_MS = 60_000;
let lastReportAt = 0;

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeDeviceStatus(raw: unknown): DeviceStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const deviceId = text(row.deviceId, 64);
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(deviceId)) return null;
  return {
    deviceId,
    userRef: text(row.userRef, 40),
    userName: text(row.userName, 80),
    roleName: text(row.roleName, 40),
    build: text(row.build, 40),
    host: text(row.host, 80),
    userAgent: text(row.userAgent, 200),
    lastPullAt: text(row.lastPullAt, 40),
    lastPullOk: row.lastPullOk === true,
    lastPullError: text(row.lastPullError, 200),
    pendingTotal: Math.max(0, Math.trunc(Number(row.pendingTotal) || 0)),
    reportedAt: text(row.reportedAt, 40),
  };
}

function deviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const created =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return "";
  }
}

/** Tras cada sync con la nube. Máximo uno por minuto salvo que falle o queden pendientes. */
export async function reportDeviceStatus(input: {
  pullOk: boolean;
  pullError?: string;
  pendingTotal: number;
}) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (input.pullOk && input.pendingTotal === 0 && now - lastReportAt < REPORT_MIN_MS) return;
  const id = deviceId();
  const session = readSession();
  if (!id || !session) return;
  lastReportAt = now;
  const status: DeviceStatus = {
    deviceId: id,
    userRef: session.userRef,
    userName: session.name,
    roleName: session.roleName,
    build: APP_BUILD,
    host: window.location.host,
    userAgent: navigator.userAgent,
    lastPullAt: new Date(now).toISOString(),
    lastPullOk: input.pullOk,
    lastPullError: input.pullError || "",
    pendingTotal: input.pendingTotal,
    reportedAt: new Date(now).toISOString(),
  };
  try {
    await fetch("/api/ops/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: status }),
      keepalive: true,
    });
  } catch (error) {
    console.error("device-status-report", error);
  }
}
