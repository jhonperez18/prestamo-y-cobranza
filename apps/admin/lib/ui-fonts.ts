export type FontOption = {
  id: string;
  label: string;
  /** Variable CSS de next/font en layout.tsx */
  cssVar: string;
};

export const UI_FONT_OPTIONS: FontOption[] = [
  { id: "outfit", label: "Outfit", cssVar: "--font-ui" },
  { id: "inter", label: "Inter", cssVar: "--font-inter" },
  { id: "roboto", label: "Roboto", cssVar: "--font-roboto" },
  { id: "open-sans", label: "Open Sans", cssVar: "--font-open-sans" },
  { id: "lato", label: "Lato", cssVar: "--font-lato" },
  { id: "dm-sans", label: "DM Sans", cssVar: "--font-dm-sans" },
  { id: "nunito-sans", label: "Nunito Sans", cssVar: "--font-nunito-sans" },
  { id: "source-sans", label: "Source Sans 3", cssVar: "--font-source-sans" },
];

export const BAR_FONT_OPTIONS: FontOption[] = [
  { id: "ibm-plex", label: "IBM Plex Sans", cssVar: "--font-data" },
  { id: "inter", label: "Inter", cssVar: "--font-inter" },
  { id: "roboto", label: "Roboto", cssVar: "--font-roboto" },
  { id: "open-sans", label: "Open Sans", cssVar: "--font-open-sans" },
  { id: "lato", label: "Lato", cssVar: "--font-lato" },
  { id: "dm-sans", label: "DM Sans", cssVar: "--font-dm-sans" },
  { id: "outfit", label: "Outfit", cssVar: "--font-ui" },
  { id: "source-sans", label: "Source Sans 3", cssVar: "--font-source-sans" },
];

export function fontOptionById(id: string, role: "ui" | "bar"): FontOption {
  const list = role === "ui" ? UI_FONT_OPTIONS : BAR_FONT_OPTIONS;
  return list.find((row) => row.id === id) ?? list[0]!;
}

export function fontFamilyStack(id: string, role: "ui" | "bar"): string {
  const option = fontOptionById(id, role);
  return `var(${option.cssVar}), system-ui, sans-serif`;
}
