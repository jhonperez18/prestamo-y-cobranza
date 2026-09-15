"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  buildReceiptEvidence,
  compressReceiptImage,
  formatEvidenceSize,
  primaryPaymentEvidence,
  resolvePaymentEvidencePreview,
  type PaymentEvidenceRef,
} from "@/lib/payment-evidence";

type Props = {
  evidence?: PaymentEvidenceRef[];
  /** Tamaño de la miniatura en px (solo variant thumb). */
  size?: number;
  emptyLabel?: string;
  /** thumb = celda de tabla; panel = ficha con imagen grande */
  variant?: "thumb" | "panel";
  /** Si no hay foto, permite subir el comprobante (Nequi sin evidencia en nube). */
  onAttach?: (evidence: PaymentEvidenceRef) => void;
};

function EvidenceLightbox({
  openUrl,
  sizeHint,
  isDemoPreview,
  title,
  onClose,
}: {
  openUrl: string;
  sizeHint: string;
  isDemoPreview: boolean;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="evidence-lightbox" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="evidence-lightbox-backdrop"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div className="evidence-lightbox-panel">
        <header>
          <strong>{title}</strong>
          {sizeHint !== "—" ? <span>{sizeHint}</span> : null}
          {isDemoPreview ? <span className="evidence-demo-tag">Demo</span> : null}
          <a
            className="btn ghost compact"
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
          >
            Abrir
          </a>
          <button type="button" className="btn ghost compact" onClick={onClose}>
            Cerrar
          </button>
        </header>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={openUrl} alt={`${title} ampliado`} />
      </div>
    </div>
  );
}

export function PaymentEvidenceThumb({
  evidence,
  size = 22,
  emptyLabel = "—",
  variant = "thumb",
  onAttach,
}: Props) {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const item = primaryPaymentEvidence(evidence);
  const previewUrl = item ? resolvePaymentEvidencePreview(item) : null;
  const isSignature = item?.kind === "firma";
  const label = isSignature ? "Firma del cliente" : "Comprobante de pago";

  const close = useCallback(() => setOpenUrl(null), []);

  useEffect(() => {
    if (!openUrl) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, openUrl]);

  async function onPhoto(file: File | undefined) {
    if (!file || !onAttach) return;
    setBusy(true);
    try {
      const compressed = await compressReceiptImage(file);
      onAttach(buildReceiptEvidence(compressed.dataUrl, compressed));
    } catch {
      // Silencioso: el padre puede mostrar toast; no tumbar la lista.
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!item || !previewUrl) {
    if (onAttach) {
      return (
        <span className="payment-evidence-attach">
          <input
            id={inputId}
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void onPhoto(event.target.files?.[0])}
          />
          <button
            type="button"
            className="payment-evidence-attach-btn"
            title="Subir comprobante"
            aria-label="Subir comprobante"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              fileRef.current?.click();
            }}
            style={{ width: Math.max(size, 28), height: Math.max(size, 28) }}
          >
            {busy ? "…" : "+"}
          </button>
        </span>
      );
    }
    return <span className="payment-evidence-empty">{emptyLabel}</span>;
  }

  const sizeHint = formatEvidenceSize(item.byteSize);
  const isDemoPreview = !item.previewUrl?.trim();
  const title = `Ver ${isSignature ? "firma" : "comprobante"} ampliado${sizeHint !== "—" ? ` · ${sizeHint}` : ""}`;

  if (variant === "panel") {
    return (
      <>
        <div className="payment-evidence-panel">
          <button
            type="button"
            className={
              isSignature
                ? "payment-evidence-panel-btn is-signature"
                : "payment-evidence-panel-btn"
            }
            title={title}
            aria-label={`Ampliar ${isSignature ? "firma" : "comprobante"}`}
            onClick={() => setOpenUrl(previewUrl)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt={label} />
          </button>
          <p className="payment-evidence-panel-hint">Clic en la imagen para verla a pantalla completa</p>
        </div>
        {openUrl ? (
          <EvidenceLightbox
            openUrl={openUrl}
            sizeHint={sizeHint}
            isDemoPreview={isDemoPreview}
            title={label}
            onClose={close}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={isSignature ? "payment-evidence-thumb is-signature" : "payment-evidence-thumb"}
        title={title}
        aria-label={`Ver ${isSignature ? "firma" : "comprobante"} ampliado`}
        onClick={(event) => {
          event.stopPropagation();
          setOpenUrl(previewUrl);
        }}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt={label} />
      </button>

      {openUrl ? (
        <EvidenceLightbox
          openUrl={openUrl}
          sizeHint={sizeHint}
          isDemoPreview={isDemoPreview}
          title={label}
          onClose={close}
        />
      ) : null}
    </>
  );
}
