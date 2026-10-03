"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizeDeviceStatus, type DeviceStatus } from "@/lib/device-status";
import type { MorningCheckReport } from "@/lib/server-morning-check";

type Props = {
  onToast: (message?: string) => void;
};

const STALE_MS = 10 * 60 * 1000;

function agoLabel(iso: string, now: number) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

function deviceLabel(userAgent: string) {
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad/i.test(userAgent)) return "iPhone";
  if (/windows/i.test(userAgent)) return "PC Windows";
  if (/mac os/i.test(userAgent)) return "Mac";
  return "Otro";
}

/** Configuración → Aparatos: versión, último sync y cambios sin subir de cada aparato. */
export function DeviceStatusPanel({ onToast }: Props) {
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [servedBuild, setServedBuild] = useState("");
  const [morning, setMorning] = useState<MorningCheckReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [devRes, buildRes, morningRes] = await Promise.all([
        fetch("/api/ops/devices", { cache: "no-store" }),
        fetch("/api/ops/build-health", { cache: "no-store" }),
        fetch("/api/ops/morning-check", { cache: "no-store" }),
      ]);
      const devBody = (await devRes.json()) as { ok?: boolean; devices?: unknown[]; error?: string };
      const buildBody = (await buildRes.json()) as { build?: string };
      const morningBody = (await morningRes.json()) as {
        ok?: boolean;
        report?: MorningCheckReport | null;
      };
      setMorning(morningBody.ok ? (morningBody.report ?? null) : null);
      if (!devRes.ok || !devBody.ok) {
        onToast(`No se pudo leer el estado de los aparatos: ${devBody.error || devRes.status}`);
        return;
      }
      setDevices(
        (devBody.devices ?? [])
          .map(normalizeDeviceStatus)
          .filter((row): row is DeviceStatus => Boolean(row)),
      );
      setServedBuild(String(buildBody.build || ""));
      setNow(Date.now());
    } catch (error) {
      onToast(`No se pudo leer el estado de los aparatos: ${error instanceof Error ? error.message : "red"}`);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <div className="sheet settings-sheet">
      <div className="sheet-fields">
        <p className="muted" style={{ marginBottom: 12, maxWidth: "64ch" }}>
          Cada aparato reporta su versión y su última sincronización con la nube. Versión del
          sistema publicada: <strong>{servedBuild || "—"}</strong>. Si un aparato muestra otra
          versión, tiene que cerrar la app y volver a abrirla.
        </p>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          {loading ? "Leyendo…" : "Actualizar"}
        </button>
        <div style={{ marginTop: 16 }}>
          <strong>Revisión de la mañana (6:00)</strong>
          {morning ? (
            <ul className="muted" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>
                {morning.businessDate} · {agoLabel(morning.ranAt, now)} ·{" "}
                {morning.ok ? "Todo listo para la jornada" : "Hay algo por revisar"}
              </li>
              {morning.items.map((item) => (
                <li key={item.label}>
                  {item.ok ? "OK" : "Revisar"} — {item.label}: {item.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Aún no ha corrido. Corre sola todos los días a las 6:00 a. m.
            </p>
          )}
        </div>
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="data list-grid">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Aparato</th>
                <th>Versión</th>
                <th>Última sincronización</th>
                <th>Sin subir</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    Aún no reporta ningún aparato. Aparecen al abrir la app con la versión nueva.
                  </td>
                </tr>
              ) : (
                devices.map((row) => {
                  const oldBuild = Boolean(servedBuild) && row.build !== servedBuild;
                  const stale = now - (Date.parse(row.lastPullAt) || 0) > STALE_MS;
                  const problems = [
                    oldBuild ? "Versión vieja: cerrar y abrir la app" : "",
                    !row.lastPullOk ? `No baja la nube${row.lastPullError ? ` (${row.lastPullError})` : ""}` : "",
                    row.pendingTotal > 0 ? `${row.pendingTotal} cambio(s) sin subir` : "",
                    row.healthIssues > 0
                      ? `Auto-revisión: ${row.healthSummary}${row.healthPersistent ? " (sigue tras reparar)" : " (reparando)"}`
                      : "",
                    stale ? "Sin sincronizar hace más de 10 min" : "",
                  ].filter(Boolean);
                  return (
                    <tr key={row.deviceId}>
                      <td>{row.userName || row.userRef || "—"}</td>
                      <td>{row.roleName || "—"}</td>
                      <td>
                        {deviceLabel(row.userAgent)} · {row.host}
                      </td>
                      <td>{row.build || "—"}</td>
                      <td>{agoLabel(row.lastPullAt, now)}</td>
                      <td>{row.pendingTotal}</td>
                      <td>{problems.length ? problems.join(" · ") : "Al día"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
