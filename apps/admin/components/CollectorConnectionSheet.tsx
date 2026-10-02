"use client";

import { Pill } from "@/components/ui";
import { APP_BUILD } from "@/lib/app-build";
import type { StatusKind } from "@/lib/mock-data";
import {
  connectionAgoLabel,
  deviceKindLabel,
  type CollectorConnection,
} from "@/lib/collector-connection";

const LEVEL_PILL: Record<CollectorConnection["level"], { label: string; kind: StatusKind }> = {
  ok: { label: "Conectado y al día", kind: "ok" },
  warn: { label: "Revisar conexión", kind: "warn" },
  alert: { label: "Atención", kind: "overdue" },
  none: { label: "Sin datos", kind: "closed" },
};

type Props = {
  routeName: string;
  collectorName: string;
  connection: CollectorConnection;
  now: number;
  loadedAt: number;
  loadError: string;
  onBack: () => void;
};

/** Detalle del punto de conexión: pantalla dentro de INICIO del supervisor. Solo lectura. */
export function CollectorConnectionSheet({
  routeName,
  collectorName,
  connection,
  now,
  loadedAt,
  loadError,
  onBack,
}: Props) {
  const { latest, devices, newDevice, pendingTotal, reasons, level } = connection;
  const pill = LEVEL_PILL[level];
  const versionOff = Boolean(latest?.build && APP_BUILD && latest.build !== APP_BUILD);
  return (
    <div className="conn-detail">
      <div className="supervisor-mobile-detail-head">
        <h3>
          Ruta {routeName} · {collectorName}
        </h3>
        <button type="button" className="collector-mobile-pay-link is-back" onClick={onBack}>
          volver
        </button>
      </div>
      <p className="supervisor-mobile-detail-meta conn-detail-meta">
        <span>Conexión del cobrador</span>
        <Pill label={pill.label} kind={pill.kind} />
      </p>

      <table className="supervisor-liq-table is-informe conn-detail-table">
        <thead>
          <tr>
            <th className="is-detalle">Detalle</th>
            <th className="is-num">Dato</th>
          </tr>
        </thead>
        <tbody>
          <tr className="is-informe-section">
            <td colSpan={2}>Estado</td>
          </tr>
          <tr>
            <td className="is-detalle">Última conexión</td>
            <td className="is-num">{latest ? connectionAgoLabel(latest.reportedAt, now) : "—"}</td>
          </tr>
          <tr className={latest && !latest.lastPullOk ? "is-warn" : undefined}>
            <td className="is-detalle">
              Internet
              {latest && !latest.lastPullOk && latest.lastPullError ? (
                <small className="conn-detail-note">{latest.lastPullError}</small>
              ) : null}
            </td>
            <td className="is-num">{latest ? (latest.lastPullOk ? "OK" : "Sin conexión") : "—"}</td>
          </tr>
          <tr className={pendingTotal > 0 ? "is-alert" : undefined}>
            <td className="is-detalle">Cambios sin subir</td>
            <td className="is-num">{pendingTotal}</td>
          </tr>
          <tr className={versionOff ? "is-warn" : undefined}>
            <td className="is-detalle">
              Versión de la app
              {versionOff ? (
                <small className="conn-detail-note">Distinta: cerrar y abrir la app</small>
              ) : null}
            </td>
            <td className="is-num">{latest?.build || "—"}</td>
          </tr>

          {level !== "ok" && reasons.length > 0 ? (
            <>
              <tr className="is-informe-section">
                <td colSpan={2}>Qué revisar</td>
              </tr>
              {reasons.map((reason) => (
                <tr key={reason} className={level === "alert" ? "is-alert" : "is-warn"}>
                  <td className="is-detalle" colSpan={2}>
                    {reason}
                  </td>
                </tr>
              ))}
            </>
          ) : null}

          <tr className="is-informe-section">
            <td colSpan={2}>Aparatos</td>
          </tr>
          {devices.length === 0 ? (
            <tr>
              <td className="is-detalle" colSpan={2}>
                Aún no reporta desde ningún aparato.
              </td>
            </tr>
          ) : (
            devices.map((device) => {
              const isNew = device === newDevice;
              return (
                <tr key={device.deviceId} className={isNew ? "is-alert" : undefined}>
                  <td className="is-detalle">
                    {deviceKindLabel(device.userAgent)}
                    {isNew ? <small className="conn-detail-note">Aparato nuevo</small> : null}
                  </td>
                  <td className="is-num">{connectionAgoLabel(device.reportedAt, now)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <p className="conn-detail-foot">
        {loadError
          ? `No se pudo actualizar (${loadError}). Datos de ${loadedAt ? connectionAgoLabel(new Date(loadedAt).toISOString(), now) : "—"}.`
          : "Se actualiza solo cada minuto."}
      </p>
    </div>
  );
}
