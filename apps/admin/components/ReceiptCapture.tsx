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
  value?: PaymentEvidenceRef;
  onChange: (evidence: PaymentEvidenceRef | undefined) => void;
};

export function ReceiptCapture({
  id,
  label = "Comprobante",
  hint = "Foto del recibo Nequi o transferencia",
  required,
  compact = false,
  value,
  onChange,
}: Props) {
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
    }
  }

  function clearPhoto() {
    if (fileRef.current) fileRef.current.value = "";
    setError(null);
    onChange(undefined);
  }

  const preview = value?.previewUrl;

  return (
    <div className="receipt-capture">
      <div className="receipt-capture-head">
        <p className="pay-choice-label">
          {label}
          {required ? " *" : null}
        </p>
        {value?.byteSize ? (
          <span className="receipt-size-tag">{formatEvidenceSize(value.byteSize)}</span>
        ) : null}
      </div>
      {!compact && hint ? <p className="receipt-capture-hint">{hint}</p> : null}

      <input
        id={id}
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={busy}
        onChange={(event) => onPhoto(event.target.files?.[0])}
      />

      <label
        htmlFor={id}
        className={preview ? "receipt-upload has-photo" : "receipt-upload"}
        aria-busy={busy}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} />
        ) : (
          <span>
            <CameraIcon />
            {busy ? "Comprimiendo…" : "Tomar foto"}
          </span>
        )}
      </label>

      {preview ? (
        <div className="receipt-actions">
          <button type="button" className="btn-link" onClick={() => fileRef.current?.click()}>
            Cambiar foto
          </button>
          <button type="button" className="btn-link danger" onClick={clearPhoto}>
            Quitar
          </button>
        </div>
      ) : compact ? null : (
        <p className="receipt-footnote">Se comprime automáticamente (máx. 2 MB).</p>
      )}

      {error ? <p className="receipt-error">{error}</p> : null}
    </div>
  );
}
