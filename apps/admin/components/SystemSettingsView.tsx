"use client";

import { useState, type FormEvent } from "react";
import {
  applyUiPreferences,
  DEFAULT_UI_PREFERENCES,
  readUiPreferences,
  writeUiPreferences,
  type UiPreferences,
} from "@/lib/ui-preferences";
import { BAR_FONT_OPTIONS, fontFamilyStack, UI_FONT_OPTIONS } from "@/lib/ui-fonts";

import { WelcomeMessageSettings } from "@/components/WelcomeMessageSettings";

type Section = "bienvenida" | "colores" | "tipografia";

type Props = {
  adminName: string;
  onToast: (message?: string) => void;
};

const TABS: { id: Section; label: string }[] = [
  { id: "bienvenida", label: "Bienvenida" },
  { id: "colores", label: "Colores" },
  { id: "tipografia", label: "Tipografía" },
];

function ColorControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="settings-color-row">
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}

function SizeControl({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-size-row">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="settings-size-value">{value}px</span>
    </div>
  );
}

const PREVIEW_ROWS = [
  { ref: "COD-0", name: "Carlos Pérez", phone: "300 555 0182", pending: "$ 2.160.000", status: "Activo" },
  { ref: "COD-1", name: "María Gómez", phone: "311 200 3302", pending: "$ 890.000", status: "Revisión" },
];

function previewThemeVars(prefs: UiPreferences): React.CSSProperties {
  const uiFont = fontFamilyStack(prefs.uiFont, "ui");
  const barFont = fontFamilyStack(prefs.barFont, "bar");

  return {
    background: prefs.workspaceBg,
    fontFamily: uiFont,
    fontSize: prefs.bodySize,
    ["--bar-bg" as string]: prefs.barBg,
    ["--table-head-bg" as string]: prefs.barBg,
    ["--table-head-text" as string]: "#14201b",
    ["--bar-size" as string]: `${prefs.barSize}px`,
    ["--bar-font-family" as string]: barFont,
    ["--row-a" as string]: "#f5fbfb",
    ["--row-b" as string]: "#ffffff",
  };
}

function SettingsAppearancePreview({ prefs }: { prefs: UiPreferences }) {
  const uiFont = fontFamilyStack(prefs.uiFont, "ui");
  const barFont = fontFamilyStack(prefs.barFont, "bar");

  return (
    <div className="settings-preview">
      <div className="settings-preview-topbar" style={{ background: prefs.topbarBg }}>
        Barra superior
      </div>
      <div className="settings-preview-body">
        <div className="settings-preview-sidebar" style={{ background: prefs.sidebarBg, fontFamily: uiFont }}>
          <div style={{ fontSize: prefs.asideGroupSize, fontWeight: 600 }}>Clientes</div>
          <div style={{ fontSize: prefs.asideItemSize, marginTop: 4 }}>Listado</div>
        </div>
        <div className="settings-preview-workspace settings-preview-theme" style={previewThemeVars(prefs)}>
          <div
            className="settings-preview-screen-head"
            style={{ fontSize: prefs.headTitleSize, color: "#14201b", fontFamily: uiFont }}
          >
            Listado
            <span className="settings-preview-count">2</span>
          </div>
          <div className="settings-preview-paper" style={{ background: prefs.paperBg }}>
            <div className="settings-preview-toolbar">
              <label className="settings-preview-filter" style={{ fontFamily: uiFont }}>
                Zona{" "}
                <select style={{ fontFamily: barFont }}>
                  <option>Todas</option>
                </select>
              </label>
              <button
                type="button"
                className="settings-preview-btn"
                style={{ background: prefs.btnBg, color: prefs.btnText, fontFamily: uiFont }}
              >
                Asignar
              </button>
            </div>
            <div className="table-wrap settings-preview-table-wrap">
              <table className="data list-grid">
                <thead>
                  <tr className="col-titles">
                    <th>Ref.</th>
                    <th>Cliente</th>
                    <th className="right">Pendiente</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row) => (
                    <tr key={row.ref}>
                      <td className="ref">{row.ref}</td>
                      <td>{row.name}</td>
                      <td className="money right">{row.pending}</td>
                      <td>
                        <span className={row.status === "Revisión" ? "pill warn" : "pill ok"}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SystemSettingsView({ adminName, onToast }: Props) {
  const [section, setSection] = useState<Section>("bienvenida");
  const [prefs, setPrefs] = useState<UiPreferences>(() => readUiPreferences());

  function previewTheme(next: UiPreferences) {
    setPrefs(next);
  }

  function saveAppearance(event: FormEvent) {
    event.preventDefault();
    writeUiPreferences(prefs);
    applyUiPreferences(prefs);
    onToast("Apariencia guardada.");
  }

  function restoreDefaults() {
    setPrefs({ ...DEFAULT_UI_PREFERENCES });
    onToast("Vista previa restablecida. Guarde para aplicar.");
  }

  return (
    <section className="panel settings-panel">
      <div className="head">
        <h1>Configuración</h1>
      </div>

      <nav className="tabs settings-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={section === tab.id ? "tab on" : "tab"}
            onClick={() => setSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="settings-main">
        {section === "bienvenida" ? (
          <WelcomeMessageSettings adminName={adminName} onToast={onToast} />
        ) : null}

        {section === "colores" ? (
          <form className="sheet settings-sheet" onSubmit={saveAppearance}>
            <div className="settings-split">
              <SettingsAppearancePreview prefs={prefs} />
              <div className="sheet-fields settings-appearance-fields">
                <div className="sheet-row split">
                  <span className="sheet-label">Fondo principal</span>
                  <ColorControl
                    value={prefs.workspaceBg}
                    onChange={(value) => previewTheme({ ...prefs, workspaceBg: value })}
                  />
                  <span className="sheet-label">Fondo tarjetas</span>
                  <ColorControl
                    value={prefs.paperBg}
                    onChange={(value) => previewTheme({ ...prefs, paperBg: value })}
                  />
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Barra superior</span>
                  <ColorControl
                    value={prefs.topbarBg}
                    onChange={(value) => previewTheme({ ...prefs, topbarBg: value })}
                  />
                  <span className="sheet-label">Menú lateral</span>
                  <ColorControl
                    value={prefs.sidebarBg}
                    onChange={(value) => previewTheme({ ...prefs, sidebarBg: value })}
                  />
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Barras tabla</span>
                  <ColorControl
                    value={prefs.barBg}
                    onChange={(value) => previewTheme({ ...prefs, barBg: value })}
                  />
                  <span className="sheet-label">Texto barras</span>
                  <ColorControl
                    value={prefs.barText}
                    onChange={(value) => previewTheme({ ...prefs, barText: value })}
                  />
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Botón</span>
                  <ColorControl
                    value={prefs.btnBg}
                    onChange={(value) => previewTheme({ ...prefs, btnBg: value })}
                  />
                  <span className="sheet-label">Texto botón</span>
                  <ColorControl
                    value={prefs.btnText}
                    onChange={(value) => previewTheme({ ...prefs, btnText: value })}
                  />
                </div>
              </div>
            </div>
            <div className="form-actions settings-form-actions">
              <button type="button" className="btn ghost" onClick={restoreDefaults}>
                Restablecer
              </button>
              <button type="submit" className="btn primary">
                Guardar colores
              </button>
            </div>
          </form>
        ) : null}

        {section === "tipografia" ? (
          <form className="sheet settings-sheet" onSubmit={saveAppearance}>
            <div className="settings-split">
              <SettingsAppearancePreview prefs={prefs} />
              <div className="sheet-fields settings-appearance-fields">
                <div className="sheet-row split">
                  <span className="sheet-label">Letra general</span>
                  <select
                    value={prefs.uiFont}
                    onChange={(event) => previewTheme({ ...prefs, uiFont: event.target.value })}
                  >
                    {UI_FONT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="sheet-label">Letra barras</span>
                  <select
                    value={prefs.barFont}
                    onChange={(event) => previewTheme({ ...prefs, barFont: event.target.value })}
                  >
                    {BAR_FONT_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Títulos</span>
                  <SizeControl
                    value={prefs.headTitleSize}
                    min={15}
                    max={24}
                    onChange={(value) => previewTheme({ ...prefs, headTitleSize: value })}
                  />
                  <span className="sheet-label">Texto general</span>
                  <SizeControl
                    value={prefs.bodySize}
                    min={14}
                    max={18}
                    onChange={(value) => previewTheme({ ...prefs, bodySize: value })}
                  />
                </div>
                <div className="sheet-row split">
                  <span className="sheet-label">Grupos menú</span>
                  <SizeControl
                    value={prefs.asideGroupSize}
                    min={15}
                    max={22}
                    onChange={(value) => previewTheme({ ...prefs, asideGroupSize: value })}
                  />
                  <span className="sheet-label">Opciones menú</span>
                  <SizeControl
                    value={prefs.asideItemSize}
                    min={14}
                    max={18}
                    onChange={(value) => previewTheme({ ...prefs, asideItemSize: value })}
                  />
                </div>
                <div className="sheet-row">
                  <span className="sheet-label">Columnas tabla</span>
                  <SizeControl
                    value={prefs.barSize}
                    min={14}
                    max={20}
                    onChange={(value) => previewTheme({ ...prefs, barSize: value })}
                  />
                </div>
              </div>
            </div>
            <div className="form-actions settings-form-actions">
              <button type="button" className="btn ghost" onClick={restoreDefaults}>
                Restablecer
              </button>
              <button type="submit" className="btn primary">
                Guardar tipografía
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}
