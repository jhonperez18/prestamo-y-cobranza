import { fontFamilyStack } from "@/lib/ui-fonts";

export const UI_PREFERENCES_KEY = "nexo-ui-preferences";

export type UiPreferences = {
  workspaceBg: string;
  paperBg: string;
  sidebarBg: string;
  topbarBg: string;
  barBg: string;
  barText: string;
  btnBg: string;
  btnText: string;
  uiFont: string;
  barFont: string;
  headTitleSize: number;
  barSize: number;
  asideGroupSize: number;
  asideItemSize: number;
  bodySize: number;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  workspaceBg: "#7ab0b0",
  paperBg: "#f2f9f9",
  sidebarBg: "#141c24",
  topbarBg: "#0b1014",
  barBg: "#426650",
  barText: "#ffffff",
  btnBg: "#141c24",
  btnText: "#ffffff",
  uiFont: "outfit",
  barFont: "ibm-plex",
  headTitleSize: 17,
  barSize: 17,
  asideGroupSize: 19,
  asideItemSize: 16,
  bodySize: 16,
};

export function readUiPreferences(): UiPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_UI_PREFERENCES };
  try {
    const raw = window.localStorage.getItem(UI_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_UI_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<UiPreferences>;
    return { ...DEFAULT_UI_PREFERENCES, ...parsed };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

export function writeUiPreferences(prefs: UiPreferences) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(prefs));
}

export function applyUiPreferences(prefs: UiPreferences = readUiPreferences()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--sage", prefs.workspaceBg);
  root.style.setProperty("--paper", prefs.paperBg);
  root.style.setProperty("--panel", prefs.paperBg);
  root.style.setProperty("--sidebar-bg", prefs.sidebarBg);
  root.style.setProperty("--topbar-bg", prefs.topbarBg);
  root.style.setProperty("--bar-bg", prefs.barBg);
  root.style.setProperty("--bar-text", prefs.barText);
  root.style.setProperty("--btn-bg", prefs.btnBg);
  root.style.setProperty("--btn-text", prefs.btnText);
  root.style.setProperty("--ui-font-family", fontFamilyStack(prefs.uiFont, "ui"));
  root.style.setProperty("--bar-font-family", fontFamilyStack(prefs.barFont, "bar"));
  root.style.setProperty("--head-title-size", `${prefs.headTitleSize}px`);
  root.style.setProperty("--bar-size", `${prefs.barSize}px`);
  root.style.setProperty("--aside-group-size", `${prefs.asideGroupSize}px`);
  root.style.setProperty("--aside-item-size", `${prefs.asideItemSize}px`);
  root.style.setProperty("--ui-body-size", `${prefs.bodySize}px`);
}

export function resetUiPreferences() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(UI_PREFERENCES_KEY);
  applyUiPreferences(DEFAULT_UI_PREFERENCES);
}
