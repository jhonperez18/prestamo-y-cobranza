import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "CA préstamo",
  description: "Sistema profesional de préstamos y cobranza",
  icons: {
    icon: "/logo-ca-prestamo.png",
    apple: "/logo-ca-prestamo.png",
  },
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
