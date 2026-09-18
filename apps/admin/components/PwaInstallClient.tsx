"use client";

import type { PwaChannel } from "@/lib/pwa-channels";

type Props = {
  channel: PwaChannel;
};

/**
 * Instrucciones claras para instalar el canal como app (Android / iPhone).
 * El manifest correcto ya viene en el <head> de esta ruta.
 */
export function PwaInstallClient({ channel }: Props) {
  return (
    <div className="pwa-install-card">
      <img
        className="pwa-install-logo"
        src="/pwa/icons/icon-192.png"
        width={96}
        height={96}
        alt=""
      />
      <p className="pwa-install-eyebrow">{channel.loginEyebrow}</p>
      <h1>{channel.name}</h1>
      <p className="pwa-install-lead">{channel.description}</p>

      <ol className="pwa-install-steps">
        <li>
          En el celular, abra esta misma página con <strong>Chrome</strong> (Android) o{" "}
          <strong>Safari</strong> (iPhone).
        </li>
        <li>
          Android: menú ⋮ → <strong>Instalar aplicación</strong> /{" "}
          <strong>Agregar a pantalla de inicio</strong>.
        </li>
        <li>
          iPhone: compartir ↑ → <strong>Añadir a pantalla de inicio</strong>.
        </li>
        <li>
          Abra el ícono <strong>{channel.shortName}</strong> e inicie sesión con su usuario.
        </li>
      </ol>

      <a className="btn primary pwa-install-enter" href={channel.startPath}>
        Entrar a iniciar sesión
      </a>

      <p className="pwa-install-note">
        Más adelante: <code>{channel.hostPrefix}.tudominio.com</code> apuntará a este mismo canal.
      </p>
    </div>
  );
}
