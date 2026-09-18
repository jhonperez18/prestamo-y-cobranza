import type { Metadata } from "next";
import Link from "next/link";
import { PWA_CHANNELS } from "@/lib/pwa-channels";

export const metadata: Metadata = {
  title: "Instalar apps · CA préstamo",
  description: "Instale Sistema, Supervisor o Cobrador en la pantalla de inicio",
};

/** Hub de instalación PWA (tres canales listos para dominio futuro). */
export default function InstalarHubPage() {
  const channels = [PWA_CHANNELS.sistema, PWA_CHANNELS.supervisor, PWA_CHANNELS.cobrador];

  return (
    <main className="pwa-install-page">
      <div className="pwa-install-card pwa-install-hub">
        <img
          className="pwa-install-logo"
          src="/pwa/icons/icon-192.png"
          width={96}
          height={96}
          alt=""
        />
        <h1>Instalar CA préstamo</h1>
        <p className="pwa-install-lead">
          Elija el canal. Cada uno se instala como ícono aparte (sistema, supervisor o cobrador).
        </p>
        <ul className="pwa-install-hub-list">
          {channels.map((channel) => (
            <li key={channel.id}>
              <Link className="btn primary" href={`/instalar/${channel.id}`}>
                {channel.shortName}
              </Link>
              <span>{channel.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
