import type { MetadataRoute } from "next";
import {
  PWA_BRAND,
  PWA_CHANNELS,
  PWA_ICON_192,
  PWA_ICON_512,
  PWA_ICON_MASKABLE,
} from "@/lib/pwa-channels";

/** Manifest por defecto = sistema completo (admin). */
export default function manifest(): MetadataRoute.Manifest {
  const channel = PWA_CHANNELS.sistema;
  return {
    id: channel.startPath,
    name: channel.name,
    short_name: channel.shortName,
    description: channel.description,
    lang: PWA_BRAND.lang,
    start_url: channel.startPath,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: channel.backgroundColor,
    theme_color: channel.themeColor,
    categories: ["finance", "business"],
    icons: [
      { src: PWA_ICON_192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: PWA_ICON_512, sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: PWA_ICON_MASKABLE,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
