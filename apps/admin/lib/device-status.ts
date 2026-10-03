/**
 * Control por aparato: qué versión corre, cuándo bajó la nube por última vez y cuántos
 * cambios le quedan sin subir. Cada aparato lo reporta; el panel (Configuración → Aparatos) lo lee.
 */
import { APP_BUILD } from "@/lib/app-build";
import { readSession } from "@/lib/auth";
import { bigDemoStoreActive } from "@/lib/big-demo-store";

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
  /** Auto-revisión: inconsistencias que quedan tras reparar (0 = sano). */
  healthIssues: number;
  healthSummary: string;
  /** Se reparó y sigue: hay que revisar ese aparato. */
  healthPersistent: boolean;
  /** Miles de caracteres ocupados en localStorage (cupo ~5.120). */
  storageUsedKb: number;
  /** Planilla y rutas ya viven en IndexedDB. */
  bigStore: boolean;
  reportedAt: string;
  /** Primera vez que la nube vio este aparato (fecha del archivo en Storage, la pone el servidor). */
  firstSeenAt: string;
};

export type DeviceHealthInput = {
  issues: number;
  summary: string;
  persistent: boolean;
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
    healthIssues: Math.max(0, Math.trunc(Number(row.healthIssues) || 0)),
    healthSummary: text(row.healthSummary, 200),
    healthPersistent: row.healthPersistent === true,
    storageUsedKb: Math.max(0, Math.trunc(Number(row.storageUsedKb) || 0)),
    bigStore: row.bigStore === true,
    reportedAt: text(row.reportedAt, 40),
    firstSeenAt: text(row.firstSeenAt, 40),
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

function localStorageUsedKb(): number {
  try {
    let chars = 0;
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i) ?? "";
      chars += key.length + (window.localStorage.getItem(key)?.length ?? 0);
    }
    return Math.round(chars / 1024);
  } catch {
    return 0;
  }
}

/** Tras cada sync con la nube. Máximo uno por minuto salvo que falle o queden pendientes. */
export async function reportDeviceStatus(input: {
  pullOk: boolean;
  pullError?: string;
  pendingTotal: number;
  health?: DeviceHealthInput;
}) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const healthIssues = input.health?.issues ?? 0;
  const quiet = input.pullOk && input.pendingTotal === 0 && healthIssues === 0;
  if (quiet && now - lastReportAt < REPORT_MIN_MS) return;
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
    healthIssues,
    healthSummary: input.health?.summary ?? "",
    healthPersistent: input.health?.persistent === true,
    storageUsedKb: localStorageUsedKb(),
    bigStore: bigDemoStoreActive(),
    reportedAt: new Date(now).toISOString(),
    firstSeenAt: "",
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
