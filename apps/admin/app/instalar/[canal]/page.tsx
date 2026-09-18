import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import {
  isPwaChannelId,
  PWA_APPLE_TOUCH,
  PWA_CHANNELS,
  PWA_ICON_192,
  pwaManifestPath,
  type PwaChannelId,
} from "@/lib/pwa-channels";
import { PwaInstallClient } from "@/components/PwaInstallClient";

type Props = {
  params: Promise<{ canal: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { canal } = await params;
  if (!isPwaChannelId(canal)) return {};
  const channel = PWA_CHANNELS[canal];
  return {
    title: `Instalar · ${channel.shortName}`,
    description: channel.description,
    applicationName: channel.shortName,
    manifest: pwaManifestPath(canal),
    icons: {
      icon: [{ url: PWA_ICON_192, sizes: "192x192", type: "image/png" }],
      apple: [{ url: PWA_APPLE_TOUCH, sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      title: channel.shortName,
      statusBarStyle: "default",
    },
    other: {
      "mobile-web-app-capable": "yes",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0f766e",
  colorScheme: "light",
};

export default async function InstalarCanalPage({ params }: Props) {
  const { canal } = await params;
  if (!isPwaChannelId(canal)) notFound();
  const channel = PWA_CHANNELS[canal as PwaChannelId];

  return (
    <main className="pwa-install-page">
      <PwaInstallClient channel={channel} />
    </main>
  );
}
