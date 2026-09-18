import type { Metadata, Viewport } from "next";
import {
  DM_Sans,
  IBM_Plex_Sans,
  Inter,
  Lato,
  Nunito_Sans,
  Open_Sans,
  Outfit,
  Roboto,
  Source_Sans_3,
} from "next/font/google";
import {
  PWA_APPLE_TOUCH,
  PWA_BRAND,
  PWA_CHANNELS,
  PWA_ICON_192,
  PWA_ICON_512,
} from "@/lib/pwa-channels";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-data",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  display: "swap",
});

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-lato",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito-sans",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});

const fontVars = [
  outfit.variable,
  plex.variable,
  inter.variable,
  roboto.variable,
  openSans.variable,
  lato.variable,
  dmSans.variable,
  nunitoSans.variable,
  sourceSans.variable,
].join(" ");

const sistema = PWA_CHANNELS.sistema;

export const metadata: Metadata = {
  title: {
    default: PWA_BRAND.product,
    template: `%s · ${PWA_BRAND.product}`,
  },
  description: "Sistema profesional de préstamos y cobranza",
  applicationName: sistema.shortName,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: PWA_ICON_192, sizes: "192x192", type: "image/png" },
      { url: PWA_ICON_512, sizes: "512x512", type: "image/png" },
      { url: "/logo-ca-prestamo.png", type: "image/png" },
    ],
    apple: [{ url: PWA_APPLE_TOUCH, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: sistema.shortName,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: PWA_BRAND.themeColor,
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${outfit.className} ${fontVars}`} suppressHydrationWarning>
      <body className={outfit.className} data-ui="v130" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
