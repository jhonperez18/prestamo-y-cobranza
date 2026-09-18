/**
 * Canales PWA / futuros subdominios.
 *
 * Dominio futuro (Hostinger → Vercel):
 *   sistema.tudominio.com     → panel completo (admin)
 *   supervisor.tudominio.com  → app supervisor
 *   cobro.tudominio.com       → app cobrador (1–N cobradores, mismo canal)
 *
 * Hoy (un solo host Vercel):
 *   /?canal=sistema|supervisor|cobrador
 *   /instalar/sistema|supervisor|cobrador  → pantallas para “Agregar a inicio”
 */
export type PwaChannelId = "sistema" | "supervisor" | "cobrador";

export type PwaChannel = {
  id: PwaChannelId;
  /** Nombre largo (instalación / store-like). */
  name: string;
  /** Nombre corto bajo el ícono. */
  shortName: string;
  description: string;
  /** Query canónica de arranque. */
  startPath: string;
  /** Prefijo de host futuro (sin dominio). */
  hostPrefix: string;
  /** Color de barra / splash. */
  themeColor: string;
  backgroundColor: string;
  /** Texto en login. */
  loginEyebrow: string;
};

export const PWA_BRAND = {
  product: "CA préstamo",
  themeColor: "#0f766e",
  backgroundColor: "#0f766e",
  lang: "es-CO",
} as const;

export const PWA_CHANNELS: Record<PwaChannelId, PwaChannel> = {
  sistema: {
    id: "sistema",
    name: "CA préstamo · Sistema",
    shortName: "CA Sistema",
    description: "Panel completo de préstamos y cobranza",
    startPath: "/?canal=sistema",
    hostPrefix: "sistema",
    themeColor: PWA_BRAND.themeColor,
    backgroundColor: PWA_BRAND.backgroundColor,
    loginEyebrow: "Sistema completo",
  },
  supervisor: {
    id: "supervisor",
    name: "CA préstamo · Supervisor",
    shortName: "CA Superv.",
    description: "App de campo para supervisión de rutas y caja",
    startPath: "/?canal=supervisor",
    hostPrefix: "supervisor",
    themeColor: PWA_BRAND.themeColor,
    backgroundColor: PWA_BRAND.backgroundColor,
    loginEyebrow: "App supervisor",
  },
  cobrador: {
    id: "cobrador",
    name: "CA préstamo · Cobrador",
    shortName: "CA Cobro",
    description: "App de cobro en ruta (2–3 cobradores con su usuario)",
    startPath: "/?canal=cobrador",
    hostPrefix: "cobro",
    themeColor: PWA_BRAND.themeColor,
    backgroundColor: PWA_BRAND.backgroundColor,
    loginEyebrow: "App cobrador",
  },
};

export const PWA_ICON_192 = "/pwa/icons/icon-192.png";
export const PWA_ICON_512 = "/pwa/icons/icon-512.png";
export const PWA_ICON_MASKABLE = "/pwa/icons/maskable-512.png";
export const PWA_APPLE_TOUCH = "/pwa/icons/apple-touch-180.png";

export function isPwaChannelId(value: string | null | undefined): value is PwaChannelId {
  return value === "sistema" || value === "supervisor" || value === "cobrador";
}

/** Resuelve canal por host futuro o ?canal= (hoy). */
export function resolvePwaChannel(input: {
  host?: string | null;
  canalParam?: string | null;
}): PwaChannel {
  const host = (input.host || "").toLowerCase().split(":")[0];
  if (host.startsWith("supervisor.")) return PWA_CHANNELS.supervisor;
  if (host.startsWith("cobro.") || host.startsWith("cobrador.")) return PWA_CHANNELS.cobrador;
  if (host.startsWith("sistema.") || host.startsWith("admin.") || host.startsWith("app.")) {
    return PWA_CHANNELS.sistema;
  }
  if (isPwaChannelId(input.canalParam)) return PWA_CHANNELS[input.canalParam];
  return PWA_CHANNELS.sistema;
}

export function pwaManifestPath(channel: PwaChannelId) {
  return `/pwa/manifests/${channel}.webmanifest`;
}
