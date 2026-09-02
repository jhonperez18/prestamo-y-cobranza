"use client";

import { useEffect, useState } from "react";

type Props = {
  title: string;
  subtitle: string;
  fileName: string;
  buildBlob: () => Promise<Blob>;
  onDownload: () => Promise<void>;
  onClose: () => void;
};

export function ReportPdfPreview({
  title,
  subtitle,
  fileName,
  buildBlob,
  onDownload,
  onClose,
}: Props) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setError(null);
    setPreviewUrl(null);

    buildBlob()
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch(() => {
        if (active) setError("No se pudo generar la vista previa del PDF.");
      });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [buildBlob]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="loan-report-pdf-preview" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="loan-report-pdf-preview-backdrop" aria-label="Cerrar" onClick={onClose} />
      <div className="loan-report-pdf-preview-panel">
        <header className="loan-report-pdf-preview-head">
          <div>
            <strong>{title}</strong>
            <p>{subtitle}</p>
          </div>
          <div className="loan-report-pdf-preview-actions">
            <button
              type="button"
              className="btn primary"
              disabled={Boolean(error) || !previewUrl || downloading}
              onClick={() => void handleDownload()}
            >
              {downloading ? "Descargando…" : "Descargar PDF"}
            </button>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </header>
        <div className="loan-report-pdf-preview-body">
          {error ? <p className="loan-report-pdf-preview-empty">{error}</p> : null}
          {!error && !previewUrl ? (
            <div className="loan-report-pdf-preview-loading">
              <span className="loan-report-pdf-preview-spinner" aria-hidden />
              <p>Preparando borrador del informe…</p>
            </div>
          ) : null}
          {previewUrl ? (
            <iframe
              title={`Vista previa ${fileName}`}
              src={`${previewUrl}#toolbar=0&navpanes=0`}
              className="loan-report-pdf-preview-frame"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
