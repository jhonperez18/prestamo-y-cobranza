"use client";

import { useEffect, useState } from "react";
import { normalizeDeviceStatus, type DeviceStatus } from "@/lib/device-status";

export type DeviceStatusesState = {
  devices: DeviceStatus[];
  /** Hora de la última lectura buena (0 = aún no se pudo leer). */
  loadedAt: number;
  error: string;
};

/** Reportes de aparatos desde la nube. Si una lectura falla se conserva la última buena. */
export function useDeviceStatuses(intervalMs = 60_000): DeviceStatusesState {
  const [state, setState] = useState<DeviceStatusesState>({ devices: [], loadedAt: 0, error: "" });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/ops/devices", { cache: "no-store" });
        const body = (await res.json()) as { ok?: boolean; devices?: unknown[]; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const devices = (body.devices ?? [])
          .map(normalizeDeviceStatus)
          .filter((row): row is DeviceStatus => Boolean(row));
        if (alive) setState({ devices, loadedAt: Date.now(), error: "" });
      } catch (error) {
        console.error("device-statuses-load", error);
        const message = error instanceof Error ? error.message : "red";
        if (alive) setState((prev) => ({ ...prev, error: message }));
      }
    };
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), intervalMs);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return state;
}
