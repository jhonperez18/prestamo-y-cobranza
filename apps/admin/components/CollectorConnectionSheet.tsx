"use client";

import { APP_BUILD } from "@/lib/app-build";
import {
  connectionAgoLabel,
  deviceKindLabel,
  type CollectorConnection,
} from "@/lib/collector-connection";

const LEVEL_LABEL: Record<CollectorConnection["level"], string> = {
  ok: "Conectado y al día",
  warn: "Revisar conexión",
  alert: "Atención",
  none: "Sin datos",
};

type Props = {
  routeName: string;
  collectorName: string;
  connection: CollectorConnection;
  now: number;
  loadedAt: number;
  loadError: string;
  onClose: () => void;
};

/** Detalle del punto de conexión (INICIO del supervisor). Solo lectura. */
export function CollectorConnectionSheet({
  routeName,
  collectorName,
  connection,
  now,
  loadedAt,
  loadError,
  onClose,
}: Props) {
  const { latest, devices, newDevice, pendingTotal, reasons, level } = connection;
  return (
    <div className="conn-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="conn-sheet"
        role="dialog"
        aria-label={`Conexión de ${collectorName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="conn-sheet-head">
          <div>
            <span className="conn-sheet-ruta">Ruta {routeName}</span>
            <strong>{collectorName}</strong>
          </div>
          <button type="button" className="conn-sheet-close" onClick={onClose}>
            cerrar
          </button>
        </header>

        <p className={`conn-sheet-state is-${level}`}>
          <span className={`conn-dot is-${level}`} aria-hidden />
          {LEVEL_LABEL[level]}
        </p>

        <dl className="conn-sheet-facts">
          <div>
            <dt>Última conexión</dt>
            <dd>{latest ? connectionAgoLabel(latest.reportedAt, now) : "—"}</dd>
          </div>
          <div>
            <dt>Internet</dt>
            <dd>
              {latest
                ? latest.lastPullOk
                  ? "OK"
                  : `Sin conexión${latest.lastPullError ? ` (${latest.lastPullError})` : ""}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Sin subir</dt>
            <dd>{pendingTotal}</dd>
          </div>
          <div>
            <dt>Versión</dt>
            <dd>
              {latest?.build || "—"}
              {latest?.build && APP_BUILD && latest.build !== APP_BUILD
                ? " · distinta: cerrar y abrir la app"
                : ""}
            </dd>
          </div>
        </dl>

        {reasons.length > 0 && level !== "ok" ? (
          <ul className="conn-sheet-reasons">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        <h4 className="conn-sheet-sub">Aparatos</h4>
        {devices.length === 0 ? (
          <p className="conn-sheet-muted">Este cobrador aún no reporta desde ningún aparato.</p>
        ) : (
          <ul className="conn-sheet-devices">
            {devices.map((device) => (
              <li key={device.deviceId} className={device === newDevice ? "is-new" : undefined}>
                <span>
                  {deviceKindLabel(device.userAgent)}
                  {device === newDevice ? <em> · nuevo</em> : null}
                </span>
                <b>{connectionAgoLabel(device.reportedAt, now)}</b>
              </li>
            ))}
          </ul>
        )}

        <p className="conn-sheet-muted">
          {loadError
            ? `No se pudo actualizar (${loadError}). Datos de ${loadedAt ? connectionAgoLabel(new Date(loadedAt).toISOString(), now) : "—"}.`
            : "Se actualiza solo cada minuto."}
        </p>
      </div>
    </div>
  );
}
