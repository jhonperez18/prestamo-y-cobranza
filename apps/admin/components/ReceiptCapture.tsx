"use client";

import { useRef, useState } from "react";
import { CameraIcon } from "@/components/icons";
import {
  buildReceiptEvidence,
  compressReceiptImage,
  formatEvidenceSize,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";

type Props = {
  id: string;
  label?: string;
  hint?: string;
  required?: boolean;
  compact?: boolean;
  /** Oculta el título “Comprobante…”; deja solo las acciones de foto/archivo. */
  hideLabel?: boolean;
  value?: PaymentEvidenceRef;
  onChange: (evidence: PaymentEvidenceRef | undefined) => void;
};

export function ReceiptCapture({
  id,
  label = "Comprobante",
  hint = "Foto del recibo o captura desde WhatsApp / archivos",
  required,
  compact = false,
  hideLabel = false,
  value,
  onChange,
}: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const compressed = await compressReceiptImage(file);
      onChange(buildReceiptEvidence(compressed.dataUrl, compressed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la foto.");
      onChange(undefined);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearPhoto() {
    if (cameraRef.current) cameraRef.current.value = "";
    if (fileRef.current) fileRef.current.value = "";
    setError(null);
    onChange(undefined);
  }

  const preview = value?.previewUrl;
  const cameraId = `${id}-camera`;
  const galleryId = `${id}-gallery`;

  return (
    <div className="receipt-capture">
      {!hideLabel || value?.byteSize ? (
        <div className="receipt-capture-head">
          {!hideLabel ? (
            <p className="pay-choice-label">
              {label}
              {required ? " *" : null}
            </p>
          ) : (
            <span className="sr-only">{label}</span>
          )}
          {value?.byteSize ? (
            <span className="receipt-size-tag">{formatEvidenceSize(value.byteSize)}</span>
          ) : null}
        </div>
      ) : null}
      {!compact && !hideLabel && hint ? <p className="receipt-capture-hint">{hint}</p> : null}

      <input
        id={cameraId}
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={(event) => onPhoto(event.target.files?.[0])}
      />
      <input
        id={galleryId}
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={busy}
        onChange={(event) => onPhoto(event.target.files?.[0])}
      />

      {preview ? (
        <div className="receipt-upload has-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={label} />
        </div>
      ) : (
        <div className="receipt-upload-actions" aria-busy={busy}>
          <button
            type="button"
            className="receipt-upload-btn"
            disabled={busy}
            onClick={() => cameraRef.current?.click()}
          >
            <CameraIcon />
            {busy ? "Comprimiendo…" : "Tomar foto"}
          </button>
          <button
            type="button"
            className="receipt-upload-btn is-files"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <span className="receipt-upload-file-icon" aria-hidden>
              ▤
            </span>
            {busy ? "Comprimiendo…" : "Buscar archivo"}
          </button>
        </div>
      )}

      {preview ? (
        <div className="receipt-actions">
          <button type="button" className="btn-link" onClick={() => cameraRef.current?.click()}>
            Nueva foto
          </button>
          <button type="button" className="btn-link" onClick={() => fileRef.current?.click()}>
            Buscar archivo
          </button>
          <button type="button" className="btn-link danger" onClick={clearPhoto}>
            Quitar
          </button>
        </div>
      ) : compact ? null : (
        <p className="receipt-footnote">
          También podés elegir una imagen guardada (WhatsApp, galería). Se comprime (máx. 2 MB).
        </p>
      )}

      {error ? <p className="receipt-error">{error}</p> : null}
    </div>
  );
}
