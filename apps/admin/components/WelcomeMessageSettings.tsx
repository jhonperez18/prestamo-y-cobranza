"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { homeDateLabel } from "@/lib/home-dashboard";
import { isoToDispatchLabel, todayIso } from "@/lib/daily-dispatch";
import { UI_FONT_OPTIONS } from "@/lib/ui-fonts";
import {
  DEFAULT_WELCOME_MESSAGE,
  readImageFile,
  readImageFromClipboard,
  readWelcomeMessage,
  WELCOME_ANIMATION_OPTIONS,
  WELCOME_PLACEHOLDERS,
  writeWelcomeMessage,
  type WelcomeMessageConfig,
} from "@/lib/welcome-message";

type Props = {
  adminName: string;
  onToast: (message?: string) => void;
};

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

function ImageSlot({
  label,
  value,
  onChange,
  onToast,
}: {
  label: string;
  value?: string;
  onChange: (value?: string) => void;
  onToast: (message?: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(file: File | null | undefined) {
    readImageFile(file, (dataUrl) => onChange(dataUrl));
  }

  function onPaste(event: React.ClipboardEvent) {
    const file = readImageFromClipboard(event);
    if (!file) return;
    event.preventDefault();
    onPick(file);
    onToast("Imagen pegada.");
  }

  return (
    <div className="welcome-image-slot">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="sr-only"
        onChange={(event) => onPick(event.target.files?.[0])}
      />
      <div className="welcome-image-slot-row">
        <button type="button" className="btn ghost compact" onClick={() => fileRef.current?.click()}>
          {label}
        </button>
        {value ? (
          <button type="button" className="btn ghost compact" onClick={() => onChange(undefined)}>
            Quitar
          </button>
        ) : null}
      </div>
      <div
        className={value ? "welcome-image-preview has-image" : "welcome-image-preview"}
        tabIndex={0}
        onPaste={onPaste}
        title="Pegue una imagen con Ctrl+V"
      >
        {value ? <img src={value} alt="" /> : <span>Pegar imagen</span>}
      </div>
    </div>
  );
}

export function WelcomeMessageSettings({ adminName, onToast }: Props) {
  const [draft, setDraft] = useState<WelcomeMessageConfig>(() => readWelcomeMessage());
  const previewDateLabel = useMemo(
    () => `${homeDateLabel()} · Operación del ${isoToDispatchLabel(todayIso())}`,
    [],
  );

  function update(next: WelcomeMessageConfig) {
    setDraft(next);
  }

  function saveWelcome(event: FormEvent) {
    event.preventDefault();
    writeWelcomeMessage(draft);
    onToast("Mensaje de bienvenida guardado.");
  }

  function restoreDefaults() {
    setDraft({ ...DEFAULT_WELCOME_MESSAGE });
    onToast("Vista previa restablecida. Guarde para aplicar.");
  }

  return (
    <form className="sheet settings-sheet" onSubmit={saveWelcome}>
      <div className="settings-split settings-welcome-split">
        <div className="settings-welcome-preview-wrap">
          <p className="settings-welcome-preview-label">Vista previa</p>
          <WelcomeBanner
            config={draft}
            adminName={adminName}
            dateLabel={previewDateLabel}
            preview
            className="settings-welcome-preview"
          />
        </div>

        <div className="sheet-fields settings-appearance-fields settings-welcome-fields">
          <div className="sheet-row">
            <span className="sheet-label">Título</span>
            <input
              value={draft.title}
              onChange={(event) => update({ ...draft, title: event.target.value })}
              placeholder="{saludo}, {nombre}"
            />
          </div>
          <div className="sheet-row">
            <span className="sheet-label">Subtítulo</span>
            <input
              value={draft.subtitle}
              onChange={(event) => update({ ...draft, subtitle: event.target.value })}
              placeholder="Vacío = fecha automática"
            />
          </div>
          <div className="sheet-row settings-welcome-hints">
            <span className="sheet-label">Variables</span>
            <span className="welcome-token-list">
              {WELCOME_PLACEHOLDERS.map((item) => (
                <code key={item.token}>{item.token}</code>
              ))}
            </span>
          </div>
          <div className="sheet-row split">
            <span className="sheet-label">Color título</span>
            <ColorControl
              value={draft.titleColor}
              onChange={(value) => update({ ...draft, titleColor: value })}
            />
            <span className="sheet-label">Color subtítulo</span>
            <ColorControl
              value={draft.subtitleColor}
              onChange={(value) => update({ ...draft, subtitleColor: value })}
            />
          </div>
          <div className="sheet-row split">
            <span className="sheet-label">Tamaño título</span>
            <SizeControl
              value={draft.titleSize}
              min={18}
              max={36}
              onChange={(value) => update({ ...draft, titleSize: value })}
            />
            <span className="sheet-label">Tamaño subtítulo</span>
            <SizeControl
              value={draft.subtitleSize}
              min={13}
              max={22}
              onChange={(value) => update({ ...draft, subtitleSize: value })}
            />
          </div>
          <div className="sheet-row split">
            <span className="sheet-label">Letra título</span>
            <select
              value={draft.titleFont}
              onChange={(event) => update({ ...draft, titleFont: event.target.value })}
            >
              {UI_FONT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="sheet-label">Letra subtítulo</span>
            <select
              value={draft.subtitleFont}
              onChange={(event) => update({ ...draft, subtitleFont: event.target.value })}
            >
              {UI_FONT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sheet-row split">
            <span className="sheet-label">Peso título</span>
            <select
              value={draft.titleWeight}
              onChange={(event) => update({ ...draft, titleWeight: Number(event.target.value) })}
            >
              <option value={600}>Seminegrita</option>
              <option value={700}>Negrita</option>
              <option value={800}>Extra negrita</option>
            </select>
            <span className="sheet-label">Animación</span>
            <select
              value={draft.animation}
              onChange={(event) =>
                update({ ...draft, animation: event.target.value as WelcomeMessageConfig["animation"] })
              }
            >
              {WELCOME_ANIMATION_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sheet-row split">
            <span className="sheet-label">Fondo</span>
            <ColorControl
              value={draft.bgColor}
              onChange={(value) => update({ ...draft, bgColor: value })}
            />
            <span className="sheet-label">Fondo imagen</span>
            <ImageSlot
              label="Elegir"
              value={draft.bgImage}
              onChange={(value) => update({ ...draft, bgImage: value })}
              onToast={onToast}
            />
          </div>
          <div className="sheet-row">
            <span className="sheet-label">Imagen lateral</span>
            <ImageSlot
              label="Elegir imagen"
              value={draft.sideImage}
              onChange={(value) => update({ ...draft, sideImage: value })}
              onToast={onToast}
            />
          </div>
        </div>
      </div>

      <div className="form-actions settings-form-actions">
        <button type="button" className="btn ghost" onClick={restoreDefaults}>
          Restablecer
        </button>
        <button type="submit" className="btn primary">
          Guardar bienvenida
        </button>
      </div>
    </form>
  );
}
