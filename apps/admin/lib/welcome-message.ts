import { homeDateLabel, homeGreeting } from "@/lib/home-dashboard";
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";

export const WELCOME_MESSAGE_KEY = "nexo-welcome-message";

export type WelcomeAnimation = "none" | "fade-in" | "slide-in" | "pulse" | "banner";

export type WelcomeMessageConfig = {
  title: string;
  subtitle: string;
  bgColor: string;
  bgImage?: string;
  titleColor: string;
  subtitleColor: string;
  titleSize: number;
  subtitleSize: number;
  titleFont: string;
  subtitleFont: string;
  titleWeight: number;
  animation: WelcomeAnimation;
  sideImage?: string;
};

export const DEFAULT_WELCOME_MESSAGE: WelcomeMessageConfig = {
  title: "{saludo}, {nombre}",
  subtitle: "",
  bgColor: "#eef5f1",
  titleColor: "#14201b",
  subtitleColor: "#5b7268",
  titleSize: 24,
  subtitleSize: 15,
  titleFont: "outfit",
  subtitleFont: "outfit",
  titleWeight: 700,
  animation: "fade-in",
};

export const WELCOME_PLACEHOLDERS = [
  { token: "{nombre}", label: "Nombre del usuario" },
  { token: "{saludo}", label: "Buenos días / tardes / noches" },
  { token: "{fecha}", label: "Fecha completa" },
  { token: "{operacion}", label: "Fecha de operación" },
];

export const WELCOME_ANIMATION_OPTIONS: { id: WelcomeAnimation; label: string }[] = [
  { id: "none", label: "Sin animación" },
  { id: "fade-in", label: "Aparecer suave" },
  { id: "slide-in", label: "Entrar deslizando" },
  { id: "pulse", label: "Pulso en título" },
  { id: "banner", label: "Banner deslizante" },
];

type WelcomeVars = {
  nombre: string;
  saludo: string;
  fecha: string;
  operacion: string;
};

export function welcomeVars(adminName: string, now = new Date()): WelcomeVars {
  return {
    nombre: adminName,
    saludo: homeGreeting(now),
    fecha: homeDateLabel(now),
    operacion: isoToDispatchLabel(todayIso(now)),
  };
}

export function applyWelcomeTemplate(template: string, vars: WelcomeVars) {
  return template
    .replaceAll("{nombre}", vars.nombre)
    .replaceAll("{saludo}", vars.saludo)
    .replaceAll("{fecha}", vars.fecha)
    .replaceAll("{operacion}", vars.operacion);
}

export function buildWelcomeLines(
  config: WelcomeMessageConfig,
  adminName: string,
  autoDateLabel: string,
  now = new Date(),
) {
  const vars = welcomeVars(adminName, now);
  const title = applyWelcomeTemplate(config.title.trim() || "{saludo}, {nombre}", vars);
  const subtitle = config.subtitle.trim()
    ? applyWelcomeTemplate(config.subtitle, vars)
    : autoDateLabel;
  return { title, subtitle };
}

export function readWelcomeMessage(): WelcomeMessageConfig {
  if (typeof window === "undefined") return { ...DEFAULT_WELCOME_MESSAGE };
  try {
    const raw = window.localStorage.getItem(WELCOME_MESSAGE_KEY);
    if (!raw) return { ...DEFAULT_WELCOME_MESSAGE };
    const parsed = JSON.parse(raw) as Partial<WelcomeMessageConfig>;
    return { ...DEFAULT_WELCOME_MESSAGE, ...parsed };
  } catch {
    return { ...DEFAULT_WELCOME_MESSAGE };
  }
}

export function writeWelcomeMessage(config: WelcomeMessageConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WELCOME_MESSAGE_KEY, JSON.stringify(config));
}

export function readImageFromClipboard(event: { clipboardData: DataTransfer | null }) {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (!file) continue;
      return file;
    }
  }
  return null;
}

export function readImageFile(file: File | null | undefined, onLoad: (dataUrl: string) => void) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => onLoad(String(reader.result));
  reader.readAsDataURL(file);
}
