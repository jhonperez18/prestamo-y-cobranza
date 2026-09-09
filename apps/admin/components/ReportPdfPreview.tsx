"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  subtitle: string;
  fileName: string;
  buildBlob: () => Promise<Blob>;
  onDownload: () => Promise<void>;
  onClose: () => void;
};

/**
 * Genera el PDF una sola vez al abrir.
 * No depende de `buildBlob` en cada render (evita cancelar la carga
 * cuando el padre regenera datos / columnas en segundo plano).
 */
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
  const buildRef = useRef(buildBlob);
  buildRef.current = buildBlob;

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    setError(null);
    setPreviewUrl(null);

    const failTimer = window.setTimeout(() => {
      if (active && !url) {
        setError("No se pudo generar la vista previa a tiempo. Intente de nuevo.");
      }
    }, 12_000);

    void (async () => {
      try {
        const blob = await buildRef.current();
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } catch (err) {
        if (!active) return;
        const message =
          err instanceof Error && err.message
            ? err.message
            : "No se pudo generar la vista previa del PDF.";
        setError(message);
      } finally {
        window.clearTimeout(failTimer);
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(failTimer);
      if (url) URL.revokeObjectURL(url);
    };
    // Solo al montar el diálogo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
