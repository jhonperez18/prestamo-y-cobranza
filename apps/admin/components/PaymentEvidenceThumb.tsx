"use client";

import { useCallback, useEffect, useState } from "react";
import {
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
  size = 40,
  emptyLabel = "—",
  variant = "thumb",
}: Props) {
  const [openUrl, setOpenUrl] = useState<string | null>(null);
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

  if (!item || !previewUrl) {
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
